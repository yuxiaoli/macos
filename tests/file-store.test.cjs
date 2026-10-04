'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const MacFileStore = require('../site/js/file-store.js');

class MemoryStorage {
    constructor(initial = null) {
        this.values = new Map();
        if (initial !== null) this.values.set(MacFileStore.STORAGE_KEY, initial);
        this.writes = 0;
        this.readError = null;
        this.writeError = null;
    }
    getItem(key) {
        if (this.readError) throw this.readError;
        return this.values.has(key) ? this.values.get(key) : null;
    }
    setItem(key, value) {
        if (this.writeError) throw this.writeError;
        this.writes += 1;
        this.values.set(key, value);
    }
    raw() { return this.values.get(MacFileStore.STORAGE_KEY); }
}

function fresh() {
    const storage = new MemoryStorage();
    return { storage, store: new MacFileStore(storage) };
}

function savedState() {
    return JSON.parse(fresh().storage.raw());
}

function code(expected) {
    return (error) => error instanceof Error && error.code === expected && error.message.length > 0;
}

function quota() {
    return Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' });
}

test('first run seeds and persists three home folders and usable text samples', () => {
    const { storage, store } = fresh();
    assert.equal(storage.writes, 1);
    assert.equal(store.storageWarning, null);
    assert.equal(store.readOnly, false);
    assert.deepEqual(store.list([]).map((entry) => entry.name), ['Desktop', 'Documents', 'Downloads']);
    assert.equal(store.read([]).name, '/');
    assert.equal(store.read(['Desktop', 'Project']).type, 'folder');
    assert.match(store.read(['Desktop', 'Welcome.txt']).content, /Welcome/);
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    assert.equal(store.read(['Downloads', 'Readme.txt']).type, 'text');
    assert.throws(() => store.read(['Downloads', 'image.jpg']), code('ENOENT'));
    const loaded = new MacFileStore(storage);
    assert.equal(storage.writes, 1, 'loading never rewrites valid saved data');
    assert.deepEqual(loaded.read([]), store.read([]));
});

test('UMD exports the constructor in a browser and uses localStorage by default', () => {
    const storage = new MemoryStorage();
    const sandbox = { localStorage: storage };
    vm.runInNewContext(fs.readFileSync(require.resolve('../site/js/file-store.js'), 'utf8'), sandbox);
    assert.equal(typeof sandbox.MacFileStore, 'function');
    const store = new sandbox.MacFileStore();
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    assert.ok(storage.raw());
});

test('creates nested folders and text, writes, renames and reloads persisted contents', () => {
    const { storage, store } = fresh();
    const folder = store.create(['Documents'], 'Work', 'folder');
    assert.deepEqual(folder, ['Documents', 'Work']);
    const path = store.create(folder, 'draft.txt', 'text', 'First line\nUnicode: 雨 🌧️');
    assert.deepEqual(path, ['Documents', 'Work', 'draft.txt']);
    store.write(path, '<script>literal text</script>\nSecond version');
    const renamed = store.rename(path, 'finished.txt');
    assert.deepEqual(renamed, ['Documents', 'Work', 'finished.txt']);
    assert.throws(() => store.read(path), code('ENOENT'));
    assert.equal(store.read(renamed).content, '<script>literal text</script>\nSecond version');
    assert.deepEqual(store.rename(folder, 'Archive'), ['Documents', 'Archive']);
    const loaded = new MacFileStore(storage);
    assert.equal(loaded.read(['Documents', 'Archive', 'finished.txt']).content, '<script>literal text</script>\nSecond version');
    assert.deepEqual(store.create(['Downloads'], 'empty.txt'), ['Downloads', 'empty.txt']);
    assert.equal(store.read(['Downloads', 'empty.txt']).content, '');
});

test('lists folders first then names case-insensitively with a deterministic tie break', () => {
    const { store } = fresh();
    const base = store.create(['Documents'], 'Sort', 'folder');
    store.create(base, 'zebra', 'folder');
    store.create(base, 'Alpha', 'folder');
    store.create(base, 'beta.txt');
    store.create(base, 'apple.txt');
    store.create(base, 'Apple.txt');
    assert.deepEqual(store.list(base).map((entry) => entry.name), ['Alpha', 'zebra', 'Apple.txt', 'apple.txt', 'beta.txt']);
    assert.equal(store.list(base)[0].type, 'folder');
    assert.equal(store.list(base)[2].content, '');
});

test('read, list, returned paths and Bin entries are defensive copies', () => {
    const { store } = fresh();
    const root = store.read([]);
    root.children.Documents.children['notes.txt'].content = 'mutated';
    const listed = store.list(['Documents']);
    listed[0].content = 'mutated';
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    const path = store.create(['Documents'], 'new.txt');
    path[0] = 'Downloads';
    assert.equal(store.read(['Documents', 'new.txt']).type, 'text');
    const sourcePath = ['Documents', 'notes.txt'];
    const id = store.trash(sourcePath);
    sourcePath[1] = 'different.txt';
    const trash = store.listTrash();
    trash[0].node.content = 'mutated';
    trash[0].originalPath[0] = 'Downloads';
    trash.push({});
    assert.deepEqual(store.restore(id), ['Documents', 'notes.txt']);
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
});

test('normalizes absolute, relative, home and parent paths without requiring existence', () => {
    const { store } = fresh();
    const cwd = ['Desktop', 'Project'];
    const examples = [
        ['', cwd], ['.', cwd], ['..', ['Desktop']], ['../../../../', []],
        ['../Welcome.txt', ['Desktop', 'Welcome.txt']], ['/Documents//./notes.txt', ['Documents', 'notes.txt']],
        ['~/Downloads/new file.txt', ['Downloads', 'new file.txt']], ['~', []], ['/', []],
        ['unknown/future.txt', ['Desktop', 'Project', 'unknown', 'future.txt']]
    ];
    for (const [input, expected] of examples) assert.deepEqual(store.resolve(input, cwd), expected);
    assert.deepEqual(cwd, ['Desktop', 'Project']);
    assert.equal(store.formatPath([]), '/');
    assert.equal(store.formatPath(['Desktop', 'Project', 'new file.txt']), '/Desktop/Project/new file.txt');
});

test('invalid names, paths, content and node types cannot change saved state', () => {
    const { storage, store } = fresh();
    const before = storage.raw();
    for (const name of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a\n', '\0', 'a\x7F', 'a\x85', 'x'.repeat(121), '__proto__', 'constructor', 'prototype', 'CONSTRUCTOR', null, 10]) {
        assert.throws(() => store.create(['Documents'], name));
        assert.throws(() => store.rename(['Documents', 'notes.txt'], name));
    }
    for (const path of [null, 'Documents', [undefined], Array(1), ['..'], ['__proto__'], ['a/b']]) {
        assert.throws(() => store.read(path));
        assert.throws(() => store.list(path));
        assert.throws(() => store.formatPath(path));
    }
    for (const input of [null, {}, 'Documents\\file', 'Documents/\0x', '/Documents/__proto__']) assert.throws(() => store.resolve(input));
    assert.throws(() => store.create(['Documents'], 'image', 'img'));
    assert.throws(() => store.create(['Documents'], 'object.txt', 'text', {}));
    assert.throws(() => store.write(['Documents', 'notes.txt'], null));
    assert.throws(() => store.subscribe(null));
    assert.equal(storage.raw(), before);
    assert.equal({}.polluted, undefined);
});

test('case-sensitive names and safely shadowed Object method names remain usable', () => {
    const { store } = fresh();
    const path = store.create(['Documents'], 'toString', 'text', 'safe');
    assert.equal(store.read(path).content, 'safe');
    const id = store.trash(path);
    assert.deepEqual(store.restore(id), path);
    store.create(['Documents'], 'hasOwnProperty');
    store.create(['Documents'], 'Notes.txt');
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    assert.equal(store.read(['Documents', 'Notes.txt']).content, '');
});

test('fixed home folders cannot be added, renamed or trashed', () => {
    const { storage, store } = fresh();
    const before = storage.raw();
    assert.throws(() => store.create([], 'Extra', 'folder'), code('EPERM'));
    for (const path of [[], ['Desktop'], ['Documents'], ['Downloads']]) {
        assert.throws(() => store.rename(path, 'Other'), code('EPERM'));
        assert.throws(() => store.trash(path), code('EPERM'));
    }
    assert.equal(storage.raw(), before);
});

test('missing files, non-folders, conflicts and writing a folder produce useful errors', () => {
    const { storage, store } = fresh();
    const before = storage.raw();
    assert.throws(() => store.read(['Desktop', 'missing.txt']), code('ENOENT'));
    assert.throws(() => store.list(['Documents', 'notes.txt']), code('ENOTDIR'));
    assert.throws(() => store.read(['Documents', 'notes.txt', 'child']), code('ENOTDIR'));
    assert.throws(() => store.create(['Documents', 'notes.txt'], 'child'), code('ENOTDIR'));
    assert.throws(() => store.create(['Documents', 'missing'], 'child'), code('ENOENT'));
    assert.throws(() => store.create(['Documents'], 'notes.txt'), code('EEXIST'));
    assert.throws(() => store.rename(['Desktop', 'Welcome.txt'], 'Project'), code('EEXIST'));
    assert.throws(() => store.write(['Desktop'], 'text'), code('EISDIR'));
    assert.throws(() => store.write(['Desktop', 'missing'], 'text'), code('ENOENT'));
    assert.throws(() => store.trash(['Desktop', 'missing']), code('ENOENT'));
    assert.throws(() => store.restore('trash-missing'), code('ENOENT'));
    assert.equal(storage.raw(), before);
    assert.deepEqual(store.rename(['Documents', 'notes.txt'], 'notes.txt'), ['Documents', 'notes.txt']);
});

test('moving folders to Bin and restoring preserves the full subtree across reloads', () => {
    const { storage, store } = fresh();
    store.create(['Desktop', 'Project'], 'code.txt', 'text', 'hello');
    const id = store.trash(['Desktop', 'Project']);
    const entry = store.listTrash()[0];
    assert.equal(entry.id, id);
    assert.equal(entry.name, 'Project');
    assert.deepEqual(entry.originalPath, ['Desktop', 'Project']);
    assert.equal(entry.node.children['code.txt'].content, 'hello');
    assert.ok(Number.isFinite(Date.parse(entry.deletedAt)));
    assert.throws(() => store.read(['Desktop', 'Project']), code('ENOENT'));
    const loaded = new MacFileStore(storage);
    assert.deepEqual(loaded.restore(id), ['Desktop', 'Project']);
    assert.equal(loaded.read(['Desktop', 'Project', 'code.txt']).content, 'hello');
    assert.deepEqual(loaded.listTrash(), []);
    assert.throws(() => loaded.restore(id), code('ENOENT'));
});

test('Bin is newest first and IDs stay unique after restores and reloads', () => {
    const { storage, store } = fresh();
    const first = store.trash(['Desktop', 'Welcome.txt']);
    const second = store.trash(['Documents', 'notes.txt']);
    assert.deepEqual(store.listTrash().map((entry) => entry.id), [second, first]);
    store.restore(first);
    const loaded = new MacFileStore(storage);
    const third = loaded.trash(['Desktop', 'Welcome.txt']);
    assert.notEqual(third, first);
    assert.notEqual(third, second);
});

test('restore falls back to Documents when the original parent is missing or a text file', () => {
    for (const replacedByText of [false, true]) {
        const { store } = fresh();
        store.create(['Desktop', 'Project'], 'plan.txt', 'text', 'Plan');
        const id = store.trash(['Desktop', 'Project', 'plan.txt']);
        store.trash(['Desktop', 'Project']);
        if (replacedByText) store.create(['Desktop'], 'Project', 'text');
        assert.deepEqual(store.restore(id), ['Documents', 'plan.txt']);
        assert.equal(store.read(['Documents', 'plan.txt']).content, 'Plan');
    }
});

test('restore safely suffixes file and folder conflicts and keeps text extensions', () => {
    const { store } = fresh();
    const file = store.trash(['Documents', 'notes.txt']);
    store.create(['Documents'], 'notes.txt', 'text', 'replacement');
    store.create(['Documents'], 'notes (restored 1).txt', 'folder');
    assert.deepEqual(store.restore(file), ['Documents', 'notes (restored 2).txt']);
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'replacement');
    const folder = store.trash(['Desktop', 'Project']);
    store.create(['Desktop'], 'Project', 'folder');
    assert.deepEqual(store.restore(folder), ['Desktop', 'Project (restored 1)']);
});

test('fallback restore also handles conflicts and maximal names without exceeding limits', () => {
    const { store } = fresh();
    const name = 'x.' + 'e'.repeat(118);
    const base = ['Desktop', 'Project'];
    store.create(base, name, 'text', 'original');
    const id = store.trash(base.concat(name));
    store.trash(base);
    store.create(['Documents'], name, 'text', 'replacement');
    const restored = store.restore(id);
    assert.equal(restored[0], 'Documents');
    assert.ok(restored[1].length <= 120);
    assert.match(restored[1], / \(restored 1\)/);
    assert.equal(store.read(restored).content, 'original');
});

test('text size is bounded in UTF-8 bytes, including astral characters and lone surrogates', () => {
    const { storage, store } = fresh();
    const limit = MacFileStore.MAX_CONTENT_BYTES;
    store.create(['Documents'], 'limit.txt', 'text', 'x'.repeat(limit));
    const before = storage.raw();
    assert.throws(() => store.write(['Documents', 'limit.txt'], 'x'.repeat(limit + 1)), code('EFBIG'));
    assert.throws(() => store.create(['Documents'], 'large.txt', 'text', '雨'.repeat(Math.floor(limit / 3) + 1)), code('EFBIG'));
    assert.throws(() => store.create(['Documents'], 'large.txt', 'text', '🌧'.repeat(Math.floor(limit / 4) + 1)), code('EFBIG'));
    assert.throws(() => store.create(['Documents'], 'large.txt', 'text', '\uD800'.repeat(Math.floor(limit / 3) + 1)), code('EFBIG'));
    assert.equal(storage.raw(), before);
    store.write(['Documents', 'limit.txt'], '🌧'.repeat(limit / 4));
    assert.equal(store.read(['Documents', 'limit.txt']).content.length, limit / 2);
});

test('overall serialized store size is bounded without losing existing files', () => {
    const { storage, store } = fresh();
    const content = 'x'.repeat(MacFileStore.MAX_CONTENT_BYTES);
    for (let i = 0; i < 3; i += 1) store.create(['Downloads'], `large-${i}.txt`, 'text', content);
    const before = storage.raw();
    assert.throws(() => store.create(['Downloads'], 'too-large.txt', 'text', content), code('ENOSPC'));
    assert.equal(storage.raw(), before);
    assert.throws(() => store.read(['Downloads', 'too-large.txt']), code('ENOENT'));
});

test('deep paths and excessive saved node counts are bounded', () => {
    const { storage, store } = fresh();
    let path = ['Documents'];
    for (let i = 1; i < 64; i += 1) path = store.create(path, `level-${i}`, 'folder');
    const before = storage.raw();
    assert.throws(() => store.create(path, 'too-deep'), code('EDEPTH'));
    assert.throws(() => store.resolve('/' + Array(65).fill('folder').join('/')), code('EDEPTH'));
    assert.equal(storage.raw(), before);
    const state = savedState();
    for (let i = 0; i < 5000; i += 1) state.root.children.Downloads.children[`file-${i}`] = { type: 'text', content: '' };
    const oversized = new MemoryStorage(JSON.stringify(state));
    const loaded = new MacFileStore(oversized);
    assert.equal(loaded.readOnly, true);
    assert.match(loaded.storageWarning, /too many files/);
});

test('subscriptions fire after successful persistence and unsubscribe is idempotent', () => {
    const { storage, store } = fresh();
    const events = [];
    const observedSnapshots = [];
    const off = store.subscribe((event) => {
        events.push(event.type);
        observedSnapshots.push([JSON.parse(storage.raw()).root.children, store.read([]).children]);
    });
    store.subscribe(() => { throw new Error('broken observer'); });
    store.create(['Downloads'], 'new.txt');
    store.write(['Downloads', 'new.txt'], 'saved');
    const path = store.rename(['Downloads', 'new.txt'], 'renamed.txt');
    const id = store.trash(path);
    store.restore(id);
    assert.deepEqual(events, ['create', 'write', 'rename', 'trash', 'restore']);
    for (const [persisted, inMemory] of observedSnapshots) assert.deepEqual(persisted, inMemory);
    off();
    off();
    store.write(path, 'saved again');
    assert.equal(events.length, 5);
    assert.equal(store.read(path).content, 'saved again');
});

test('every mutating method preserves memory, storage and observer silence on quota errors', async (t) => {
    const actions = {
        create: (store) => () => store.create(['Documents'], 'new.txt'),
        write: (store) => () => store.write(['Documents', 'notes.txt'], 'lost?'),
        rename: (store) => () => store.rename(['Documents', 'notes.txt'], 'renamed.txt'),
        trash: (store) => () => store.trash(['Documents', 'notes.txt']),
        restore: (store) => {
            const id = store.trash(['Documents', 'notes.txt']);
            return () => store.restore(id);
        }
    };
    for (const [name, prepare] of Object.entries(actions)) await t.test(name, () => {
        const { storage, store } = fresh();
        const act = prepare(store);
        const root = store.read([]);
        const trash = store.listTrash();
        const before = storage.raw();
        let notifications = 0;
        store.subscribe(() => { notifications += 1; });
        storage.writeError = quota();
        assert.throws(act, code('ENOSPC'));
        assert.deepEqual(store.read([]), root);
        assert.deepEqual(store.listTrash(), trash);
        assert.equal(storage.raw(), before);
        assert.equal(notifications, 0);
        assert.match(store.storageWarning, /not saved.*full/);
        storage.writeError = null;
        act();
        assert.equal(store.storageWarning, null);
        assert.equal(notifications, 1);
    });
});

test('write permission failures and read failures preserve unsaved data and can be retried', () => {
    const { storage, store } = fresh();
    const before = storage.raw();
    storage.readError = new Error('Access denied');
    assert.throws(() => store.write(['Documents', 'notes.txt'], 'new'), code('EIO'));
    storage.readError = null;
    storage.writeError = new Error('Access denied');
    assert.throws(() => store.write(['Documents', 'notes.txt'], 'new'), code('EIO'));
    assert.equal(storage.raw(), before);
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    storage.writeError = null;
    store.write(['Documents', 'notes.txt'], 'new');
    assert.equal(store.read(['Documents', 'notes.txt']).content, 'new');
    assert.equal(store.storageWarning, null);
});

test('first-run write failure leaves samples usable and retries persistence on mutation', () => {
    const storage = new MemoryStorage();
    storage.writeError = quota();
    const store = new MacFileStore(storage);
    assert.equal(store.readOnly, false);
    assert.match(store.storageWarning, /not saved/);
    assert.equal(storage.raw(), undefined);
    storage.writeError = null;
    store.create(['Documents'], 'new.txt');
    assert.ok(storage.raw());
    assert.equal(store.storageWarning, null);
});

test('unreadable storage and unavailable localStorage produce preserved read-only samples', () => {
    const state = JSON.stringify(savedState());
    const storage = new MemoryStorage(state);
    storage.readError = new Error('Access denied');
    const store = new MacFileStore(storage);
    assert.equal(store.readOnly, true);
    assert.match(store.storageWarning, /could not be read/);
    assert.match(store.read(['Desktop', 'Welcome.txt']).content, /Welcome/);
    storage.readError = null;
    assert.throws(() => store.create(['Documents'], 'new.txt'), code('EROFS'));
    assert.equal(storage.raw(), state);
    assert.equal(new MacFileStore(null).readOnly, true);
    assert.equal(new MacFileStore({}).readOnly, true);
});

test('malformed saved data is never silently reset or overwritten', async (t) => {
    const invalidStates = {
        invalidJson: '{broken',
        nullState: 'null',
        emptyObject: '{}',
        wrongVersion: (s) => { s.version = 99; },
        unknownFields: (s) => { s.extra = true; },
        missingRoot: (s) => { delete s.root.children.Documents; },
        extraRoot: (s) => { s.root.children.Extra = { type: 'folder', children: {} }; },
        rootText: (s) => { s.root = { type: 'text', content: '' }; },
        invalidType: (s) => { s.root.children.Documents.children.photo = { type: 'img', src: '' }; },
        invalidContent: (s) => { s.root.children.Documents.children['notes.txt'].content = 42; },
        arrayChildren: (s) => { s.root.children.Documents.children = []; },
        invalidName: (s) => { s.root.children.Documents.children['../escape'] = { type: 'text', content: '' }; },
        prototypePollution: (s) => { s.root.children.Documents.children = JSON.parse('{"__proto__":{"type":"text","content":"unsafe"}}'); },
        excessiveContent: (s) => { s.root.children.Documents.children['notes.txt'].content = 'x'.repeat(MacFileStore.MAX_CONTENT_BYTES + 1); },
        invalidCounter: (s) => { s.nextTrashId = 0; },
        invalidTrash: (s) => { s.trash = {}; },
        invalidTrashDate: (s) => { s.nextTrashId = 2; s.trash = [{ id: 'trash-1', name: 'file.txt', originalPath: ['Documents', 'file.txt'], node: { type: 'text', content: '' }, deletedAt: 'invalid' }]; },
        invalidTrashPath: (s) => { s.nextTrashId = 2; s.trash = [{ id: 'trash-1', name: 'Documents', originalPath: ['Documents'], node: { type: 'folder', children: {} }, deletedAt: '2026-01-01T00:00:00.000Z' }]; },
        invalidTrashId: (s) => { s.nextTrashId = 2; s.trash = [{ id: 'trash-2', name: 'file.txt', originalPath: ['Documents', 'file.txt'], node: { type: 'text', content: '' }, deletedAt: '2026-01-01T00:00:00.000Z' }]; },
        duplicateTrashId: (s) => { s.nextTrashId = 2; const entry = { id: 'trash-1', name: 'file.txt', originalPath: ['Documents', 'file.txt'], node: { type: 'text', content: '' }, deletedAt: '2026-01-01T00:00:00.000Z' }; s.trash = [entry, entry]; }
    };
    for (const [name, edit] of Object.entries(invalidStates)) await t.test(name, () => {
        const state = savedState();
        if (typeof edit === 'function') edit(state);
        const raw = typeof edit === 'string' ? edit : JSON.stringify(state);
        const storage = new MemoryStorage(raw);
        const store = new MacFileStore(storage);
        assert.equal(store.readOnly, true);
        assert.match(store.storageWarning, /preserved/);
        assert.equal(store.list([]).length, 3);
        assert.throws(() => store.write(['Documents', 'notes.txt'], 'new'), code('EROFS'));
        assert.equal(storage.raw(), raw);
        assert.equal(storage.writes, 0);
        assert.equal({}.polluted, undefined);
    });
});

test('oversized persisted JSON is preserved in read-only recovery mode', () => {
    const raw = ' '.repeat(MacFileStore.MAX_STORE_BYTES + 1);
    const storage = new MemoryStorage(raw);
    const store = new MacFileStore(storage);
    assert.equal(store.readOnly, true);
    assert.match(store.storageWarning, /size limit/);
    assert.equal(storage.raw(), raw);
    assert.equal(storage.writes, 0);
});

test('every mutation refuses stale-tab writes and preserves the other tab data', async (t) => {
    const actions = {
        create: (store) => () => store.create(['Downloads'], 'new.txt'),
        write: (store) => () => store.write(['Documents', 'notes.txt'], 'stale'),
        rename: (store) => () => store.rename(['Documents', 'notes.txt'], 'renamed.txt'),
        trash: (store) => () => store.trash(['Documents', 'notes.txt']),
        restore: (store) => {
            const id = store.trash(['Documents', 'notes.txt']);
            return () => store.restore(id);
        }
    };
    for (const [name, prepare] of Object.entries(actions)) await t.test(name, () => {
        const { storage, store } = fresh();
        const act = prepare(store);
        const root = store.read([]);
        const trash = store.listTrash();
        let notifications = 0;
        store.subscribe(() => { notifications += 1; });
        const other = new MacFileStore(storage);
        other.create(['Downloads'], 'other-tab.txt', 'text', 'Do not lose this');
        const before = storage.raw();
        assert.throws(act, code('ESTALE'));
        assert.match(store.storageWarning, /another tab.*Reload/);
        assert.equal(storage.raw(), before);
        assert.deepEqual(store.read([]), root);
        assert.deepEqual(store.listTrash(), trash);
        assert.equal(notifications, 0);
        const reloaded = new MacFileStore(storage);
        assert.equal(reloaded.read(['Downloads', 'other-tab.txt']).content, 'Do not lose this');
        reloaded.create(['Downloads'], 'after-reload.txt');
    });
});

test('external deletion or corrupt replacement also blocks stale writes', () => {
    for (const replacement of [null, '{corrupt']) {
        const { storage, store } = fresh();
        if (replacement === null) storage.values.delete(MacFileStore.STORAGE_KEY);
        else storage.values.set(MacFileStore.STORAGE_KEY, replacement);
        assert.throws(() => store.create(['Documents'], 'new.txt'), code('ESTALE'));
        assert.equal(storage.getItem(MacFileStore.STORAGE_KEY), replacement);
    }
});


test('node count limit also rejects mutations transactionally at the exact boundary', () => {
    const state = savedState();
    // The seed contains the root plus seven folder/file nodes.
    for (let i = 0; i < 4992; i += 1) state.root.children.Downloads.children[`file-${i}`] = { type: 'text', content: '' };
    const storage = new MemoryStorage(JSON.stringify(state));
    const store = new MacFileStore(storage);
    assert.equal(store.readOnly, false);
    const before = storage.raw();
    assert.throws(() => store.create(['Documents'], 'one-too-many'), code('ENOSPC'));
    assert.equal(storage.raw(), before);
    assert.throws(() => store.read(['Documents', 'one-too-many']), code('ENOENT'));
    // Moving to or from Bin does not increase the node count.
    const id = store.trash(['Documents', 'notes.txt']);
    assert.deepEqual(store.restore(id), ['Documents', 'notes.txt']);
});

test('a denied browser localStorage getter does not crash application startup', () => {
    const sandbox = {};
    Object.defineProperty(sandbox, 'localStorage', { get() { throw new Error('SecurityError'); } });
    vm.runInNewContext(fs.readFileSync(require.resolve('../site/js/file-store.js'), 'utf8'), sandbox);
    const store = new sandbox.MacFileStore();
    assert.equal(store.readOnly, true);
    assert.match(store.storageWarning, /could not be read/);
    assert.equal(store.list([]).length, 3);
});
