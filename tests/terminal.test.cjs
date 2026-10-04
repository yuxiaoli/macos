'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const MacTerminal = require('../site/js/terminal.js');

// A small contract mock keeps command parsing independently testable.
// Production-store integration is covered separately below.
function mockStore() {
    const nodes = new Map([
        ['', { name: '/', type: 'folder' }],
        ['Documents', { name: 'Documents', type: 'folder' }],
        ['Desktop', { name: 'Desktop', type: 'folder' }],
        ['Documents/hello.txt', { name: 'hello.txt', type: 'text', content: 'Hello, world!' }],
        ['Documents/photo.png', { name: 'photo.png', type: 'image' }]
    ]);
    let writes = 0;
    const store = {
        get writes() { return writes; },
        resolve(input, cwd = []) {
            const result = /^(\/|~(?:\/|$))/.test(input) ? [] : cwd.slice();
            for (const part of input.replace(/^~(?=\/|$)/, '').split('/')) {
                if (!part || part === '.') continue;
                if (part === '..') result.pop();
                else result.push(part);
            }
            return result;
        },
        formatPath(parts) { return '/' + parts.join('/'); },
        read(parts) {
            const node = nodes.get(parts.join('/'));
            if (!node) throw new Error('No such file or directory: ' + store.formatPath(parts));
            return { ...node };
        },
        list(parts) {
            if (store.read(parts).type !== 'folder') throw new Error('Not a directory');
            const prefix = parts.length ? parts.join('/') + '/' : '';
            return Array.from(nodes.entries())
                .filter(([key]) => key && key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
                .map(([, node]) => ({ ...node }));
        },
        create(parent, name, type = 'text', content = '') {
            store.list(parent);
            const key = parent.concat(name).join('/');
            if (nodes.has(key)) throw new Error('File exists');
            nodes.set(key, { name, type, ...(type === 'text' ? { content } : {}) });
            writes += 1;
        },
        write(parts, content) {
            const node = store.read(parts);
            if (node.type !== 'text') throw new Error('Not a text file');
            nodes.set(parts.join('/'), { ...node, content });
            writes += 1;
        }
    };
    return store;
}

function fixture() {
    const store = mockStore();
    return { store, terminal: new MacTerminal(store) };
}

test('exports a browser global as well as a CommonJS constructor', () => {
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../site/js/terminal.js'), 'utf8'), context);
    assert.equal(typeof context.MacTerminal, 'function');
    assert.equal(new context.MacTerminal(mockStore()).run('whoami').output, 'guest');
});

test('lists the actual current folder and individual files', () => {
    const { terminal } = fixture();
    assert.equal(terminal.run('pwd').output, '/');
    assert.equal(terminal.run('ls').output, 'Documents/  Desktop/');
    assert.deepEqual(terminal.run('cd Documents'), { output: '' });
    assert.deepEqual(terminal.cwd, ['Documents']);
    assert.equal(terminal.run('ls .').output, 'hello.txt  photo.png');
    assert.equal(terminal.run('ls hello.txt').output, 'hello.txt');
    assert.equal(terminal.run('cat hello.txt').output, 'Hello, world!');
});

test('normalizes relative, absolute, parent and home paths', () => {
    const { terminal } = fixture();
    terminal.run('cd Documents');
    terminal.run('mkdir nested');
    terminal.run('cd ./nested');
    assert.equal(terminal.run('pwd').output, '/Documents/nested');
    terminal.run('cd ../..');
    assert.equal(terminal.run('pwd').output, '/');
    terminal.run('cd /Documents/nested');
    terminal.run('cd ~/Desktop');
    assert.equal(terminal.run('pwd').output, '/Desktop');
    terminal.run('cd');
    assert.deepEqual(terminal.cwd, []);
});

test('supports quoted Unicode names, apostrophes and escaped spaces', () => {
    const { terminal, store } = fixture();
    terminal.run('cd Documents');
    assert.deepEqual(terminal.run('mkdir "项目 笔记"'), { output: '' });
    terminal.run('cd 项目\\ 笔记');
    assert.deepEqual(terminal.run('touch "Ada\'s draft.txt"'), { output: '' });
    assert.equal(store.read(['Documents', '项目 笔记', "Ada's draft.txt"]).content, '');
    assert.deepEqual(terminal.run('touch draft" two"\'.txt\''), { output: '' });
    assert.equal(store.read(['Documents', '项目 笔记', 'draft two.txt']).content, '');
});

test('touch never overwrites an existing file', () => {
    const { terminal, store } = fixture();
    assert.deepEqual(terminal.run('touch /Documents/hello.txt'), { output: '' });
    assert.equal(store.read(['Documents', 'hello.txt']).content, 'Hello, world!');
    assert.equal(store.writes, 0);
    assert.deepEqual(terminal.run('touch /Documents/new.txt'), { output: '' });
    assert.equal(store.read(['Documents', 'new.txt']).content, '');
    assert.equal(store.writes, 1);
});

test('failed commands preserve cwd and report filesystem errors', () => {
    const { terminal } = fixture();
    terminal.run('cd Documents');
    assert.match(terminal.run('cd missing').output, /^cd: No such file/);
    assert.deepEqual(terminal.cwd, ['Documents']);
    assert.match(terminal.run('cd hello.txt').output, /^cd: Not a directory/);
    assert.deepEqual(terminal.cwd, ['Documents']);
    assert.match(terminal.run('cat missing').output, /^cat: No such file/);
    assert.match(terminal.run('cat .').output, /^cat: Is a directory/);
    assert.match(terminal.run('cat photo.png').output, /^cat: Not a text file/);
    assert.match(terminal.run('mkdir hello.txt').output, /^mkdir: File exists/);
    assert.match(terminal.run('touch missing/file.txt').output, /^touch: No such file/);
});

test('open returns a verified path without changing the current directory', () => {
    const { terminal } = fixture();
    terminal.run('cd Documents');
    const result = terminal.run('open ./hello.txt');
    assert.deepEqual(result, { output: '', action: 'open', path: ['Documents', 'hello.txt'] });
    result.path.pop();
    assert.deepEqual(terminal.cwd, ['Documents']);
    assert.deepEqual(terminal.run('open /'), { output: '', action: 'open', path: [] });
    assert.match(terminal.run('open missing').output, /^open: No such file/);
    assert.equal(terminal.run('open missing').action, undefined);
});

test('echo safely creates, appends and overwrites actual file contents', () => {
    const { terminal, store } = fixture();
    terminal.run('cd Documents');
    assert.deepEqual(terminal.run('echo "first line" > "draft note.txt"'), { output: '' });
    assert.equal(store.read(['Documents', 'draft note.txt']).content, 'first line\n');
    assert.deepEqual(terminal.run('echo second>>"draft note.txt"'), { output: '' });
    assert.equal(terminal.run('cat "draft note.txt"').output, 'first line\nsecond\n');
    terminal.run('echo replaced > "draft note.txt"');
    assert.equal(terminal.run('cat "draft note.txt"').output, 'replaced\n');
    terminal.run('echo created >> appended.txt');
    assert.equal(terminal.run('cat appended.txt').output, 'created\n');
    terminal.run('echo "" > empty.txt');
    assert.equal(terminal.run('cat empty.txt').output, '\n');
});

test('echo respects quoted redirection symbols and literal text', () => {
    const { terminal, store } = fixture();
    assert.equal(terminal.run('echo "a > b" \'c >> d\'').output, 'a > b c >> d');
    assert.equal(terminal.run('echo a\\>b').output, 'a>b');
    assert.equal(terminal.run('echo tail\\ ').output, 'tail ');
    assert.equal(terminal.run('echo "a\\nb"').output, 'a\\nb');
    assert.equal(terminal.run("echo '$HOME $(date) `whoami`'").output, '$HOME $(date) `whoami`');
    assert.equal(store.writes, 0);
});

test('rejects malformed or unsupported redirection without any file writes', () => {
    const { terminal, store } = fixture();
    const invalid = [
        'echo hi >', 'echo hi > >', 'echo hi > Documents/a > Documents/b',
        'echo hi > Documents/a extra', 'echo hi >>> Documents/a',
        'cat Documents/hello.txt > Documents/a', '> Documents/a',
        'echo hi > ""', 'echo hi > Documents/photo.png',
        'echo hi > Documents', 'echo hi >> /', 'echo hi > missing/a'
    ];
    for (const command of invalid) {
        assert.ok(terminal.run(command).output, command);
    }
    assert.equal(store.writes, 0);
    assert.equal(store.read(['Documents', 'hello.txt']).content, 'Hello, world!');
});

test('reports missing, empty and extra arguments without accidental mutations', () => {
    const { terminal, store } = fixture();
    for (const command of ['cat', 'mkdir', 'touch', 'open', 'pwd extra', 'ls a b', 'cd a b', 'clear extra', 'matrix extra']) {
        assert.match(terminal.run(command).output, /usage:/, command);
    }
    for (const command of ['cat', 'mkdir', 'touch', 'open', 'ls', 'cd']) {
        assert.match(terminal.run(command + ' ""').output, /path must not be empty/, command);
    }
    assert.equal(store.writes, 0);
});

test('reports parsing errors, invalid input and arbitrary store failures without throwing', () => {
    const { terminal } = fixture();
    assert.match(terminal.run('echo "unterminated').output, /unclosed quote/);
    assert.match(terminal.run("echo 'unterminated").output, /unclosed quote/);
    assert.match(terminal.run('echo trailing\\').output, /unfinished escape/);
    assert.match(terminal.run(null).output, /command must be text/);
    assert.match(terminal.run({}).output, /command must be text/);
    const broken = new MacTerminal({ resolve() { throw new Error('Storage quota exceeded'); } });
    assert.equal(broken.run('cat a').output, 'cat: Storage quota exceeded');
    broken.store.resolve = () => { throw 'unexpected failure'; };
    assert.equal(broken.run('cat a').output, 'cat: Command failed');
});

test('keeps command history across clear and ignores whitespace-only commands', () => {
    const { terminal } = fixture();
    assert.deepEqual(terminal.run('   '), { output: '' });
    terminal.run('  echo one  ');
    terminal.run('cat missing');
    terminal.run('clear');
    assert.deepEqual(terminal.history, ['  echo one  ', 'cat missing', 'clear']);
    assert.equal(terminal.run('echo two').output, 'two');
    terminal.run('echo tail\\ ');
    assert.equal(terminal.run(terminal.history.at(-1)).output, 'tail ');
});

test('preserves utility commands and reports unknown commands', () => {
    const { terminal } = fixture();
    assert.match(terminal.run('help').output, /ls \[path\]/);
    assert.match(terminal.run('help').output, /echo text >> file/);
    assert.equal(terminal.run('whoami').output, 'guest');
    assert.equal(terminal.run('WHOAMI').output, 'guest');
    assert.equal(Number.isNaN(Date.parse(terminal.run('date').output)), false);
    assert.match(terminal.run('sudo anything').output, /you have no power here/);
    assert.deepEqual(terminal.run('clear'), { output: '', action: 'clear' });
    assert.deepEqual(terminal.run('matrix'), { output: '', action: 'matrix' });
    assert.equal(terminal.run('not-a-command').output, 'zsh: command not found: not-a-command');
});

test('HTML-like input and file contents remain plain text with no evaluation', () => {
    const { terminal, store } = fixture();
    const payload = '<img src=x onerror="globalThis.injected=true"><script>alert(1)</script>';
    assert.equal(terminal.run("echo '" + payload + "'").output, payload);
    store.create(['Documents'], '<img onerror=alert(1)>', 'text', payload);
    assert.equal(terminal.run("cat 'Documents/<img onerror=alert(1)>'").output, payload);
    assert.match(terminal.run('ls Documents').output, /<img onerror=alert\(1\)>/);
    assert.equal(globalThis.injected, undefined);
});

function persistentFixture() {
    const MacFileStore = require('../site/js/file-store.js');
    const values = new Map();
    const storage = {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); }
    };
    const store = new MacFileStore(storage);
    return { MacFileStore, storage, values, store, terminal: new MacTerminal(store) };
}

test('integrates with MacFileStore and persists quoted Unicode file workflows', () => {
    const { terminal, store, storage, MacFileStore } = persistentFixture();
    assert.match(terminal.run('ls').output, /Desktop\/.*Documents\/.*Downloads\//);
    assert.deepEqual(terminal.run('cd ~/Documents'), { output: '' });
    assert.deepEqual(terminal.run('mkdir "项目 notes"'), { output: '' });
    assert.deepEqual(terminal.run('cd "项目 notes"'), { output: '' });
    assert.deepEqual(terminal.run('touch "计划 draft.txt"'), { output: '' });
    assert.deepEqual(terminal.run('echo "第一行" > "计划 draft.txt"'), { output: '' });
    assert.deepEqual(terminal.run('echo "second line" >> "计划 draft.txt"'), { output: '' });
    assert.equal(terminal.run('cat "计划 draft.txt"').output, '第一行\nsecond line\n');
    assert.equal(store.read(['Documents', '项目 notes', '计划 draft.txt']).content, '第一行\nsecond line\n');
    const reloaded = new MacTerminal(new MacFileStore(storage));
    assert.equal(reloaded.run('cat "/Documents/项目 notes/计划 draft.txt"').output, '第一行\nsecond line\n');
    assert.deepEqual(reloaded.run('open "/Documents/项目 notes"'), {
        output: '', action: 'open', path: ['Documents', '项目 notes']
    });
});

test('uses live shared store data and keeps terminal instances independent', () => {
    const { store, terminal } = persistentFixture();
    const second = new MacTerminal(store);
    terminal.run('cd Documents');
    store.create(['Documents'], 'from-finder.txt', 'text', 'Finder content');
    assert.equal(terminal.run('cat from-finder.txt').output, 'Finder content');
    assert.deepEqual(second.cwd, []);
    second.run('echo "TextEdit can read this" > /Documents/shared.txt');
    assert.equal(terminal.run('cat shared.txt').output, 'TextEdit can read this\n');
    store.rename(['Documents', 'shared.txt'], 'renamed.txt');
    assert.equal(terminal.run('cat renamed.txt').output, 'TextEdit can read this\n');
    assert.match(terminal.run('cat shared.txt').output, /not found/);
    store.trash(['Documents', 'renamed.txt']);
    assert.match(terminal.run('cat renamed.txt').output, /not found/);
});

test('touch on a persisted text file is a true non-destructive no-op', () => {
    const { terminal, store, values } = persistentFixture();
    const original = store.read(['Documents', 'notes.txt']).content;
    const before = Array.from(values.entries());
    assert.deepEqual(terminal.run('touch /Documents/notes.txt'), { output: '' });
    assert.equal(store.read(['Documents', 'notes.txt']).content, original);
    assert.deepEqual(Array.from(values.entries()), before);
});

test('surfaces storage failures without changing file contents', () => {
    const { terminal, store, storage, values } = persistentFixture();
    const original = store.read(['Documents', 'notes.txt']).content;
    const before = Array.from(values.entries());
    storage.setItem = () => {
        const error = new Error('No space');
        error.name = 'QuotaExceededError';
        throw error;
    };
    assert.match(terminal.run('echo lost > /Documents/notes.txt').output, /storage is full/);
    assert.match(terminal.run('touch /Documents/lost.txt').output, /storage is full/);
    assert.equal(terminal.run('cat /Documents/notes.txt').output, original);
    assert.deepEqual(Array.from(values.entries()), before);
});

test('respects protected root folders and rejected path names', () => {
    const { terminal, values } = persistentFixture();
    const before = Array.from(values.entries());
    assert.match(terminal.run('mkdir /Unexpected').output, /Create files inside Desktop, Documents or Downloads/);
    assert.match(terminal.run('touch /Unexpected.txt').output, /Create files inside Desktop, Documents or Downloads/);
    assert.match(terminal.run('echo nope > /Documents').output, /Is a directory/);
    assert.match(terminal.run('touch /Documents/__proto__').output, /reserved/);
    assert.match(terminal.run('touch "Documents/control\u0001.txt"').output, /control characters/);
    assert.deepEqual(Array.from(values.entries()), before);
    assert.deepEqual(terminal.cwd, []);
});

test('persists HTML-like filenames and contents as inert strings', () => {
    const { terminal, storage, MacFileStore } = persistentFixture();
    const file = '<img src=x onerror=alert(1)>.txt';
    const content = '<script>globalThis.injected=true</script>';
    assert.deepEqual(terminal.run("echo '" + content + "' > 'Documents/" + file + "'"), { output: '' });
    const reloaded = new MacTerminal(new MacFileStore(storage));
    assert.equal(reloaded.run("cat 'Documents/" + file + "'").output, content + '\n');
    assert.ok(reloaded.run('ls Documents').output.includes(file));
    assert.equal(globalThis.injected, undefined);
});
