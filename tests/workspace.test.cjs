'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));
function setup(t, raw) {
    const dom = new JSDOM('<!doctype html><body><div id="desktop-files"></div></body>', { url: 'https://macos.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, $ = require('jquery')(w);
    w.$ = w.jQuery = $; $.fx.off = true;
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    ['file-store.js', 'terminal.js', 'workspace.js'].forEach(file => w.eval(fs.readFileSync(path.join(root, 'site/js', file), 'utf8')));
    if (raw) w.localStorage.setItem(w.MacFileStore.STORAGE_KEY, raw);
    const store = new w.MacFileStore(w.localStorage);
    const wm = {
        windows: [], activeWindow: null, sequence: 0,
        listWindows() { return this.windows; },
        openApp(appId, options = {}) {
            let existing = !options.newWindow && this.windows.find(r => r.appId === appId);
            if (existing) { this.focusWindow(existing.id); if (options.path && existing.controller.navigate) existing.controller.navigate(options.path); return existing; }
            const element = $('<section class="window"><span class="window-title"></span><div class="window-content"></div></section>').appendTo('body')[0];
            const record = { id: 'window-' + (++this.sequence), appId, name: appId, element, content: $(element).find('.window-content')[0], controller: null };
            this.windows.push(record); record.controller = workspace.createController(appId, record.content, record, options); this.focusWindow(record.id); return record;
        },
        focusWindow(id) { this.activeWindow = this.windows.find(r => r.id === id); this.activeApp = this.activeWindow.appId; },
        focusDesktop() { this.activeWindow = null; this.activeApp = 'Finder'; },
        setTitle(id, title) { const record = this.windows.find(r => r.id === id); record.title = title; $(record.element).find('.window-title').text(title); },
        async requestClose(id) { const record = this.windows.find(r => r.id === id); if (!await record.controller.beforeClose()) return false; record.controller.dispose(); $(record.element).remove(); this.windows = this.windows.filter(r => r.id !== id); return true; }
    };
    const workspace = new w.MacWorkspace(store, wm); workspace.createDesktop($('#desktop-files'));
    t.after(() => { workspace.dispose(); dom.window.close(); });
    return { w, $, wm, store, workspace, finder: options => wm.openApp('finder', { newWindow: true, ...options }) };
}
function click($, text, scope = 'body') {
    const button = $(scope).find('button').filter((_, e) => $(e).text() === text).first();
    assert.ok(button.length, 'Button exists: ' + text); button.trigger('click');
}
function type(controller, text) { controller.textarea.val(text).trigger('input'); }
async function create($, record, label, name) { click($, label, record.content); await tick(); $('dialog input').val(name); click($, 'Create', 'dialog'); await tick(); }

test('Finder creates, searches, renames and renders hostile filenames as literal text', async t => {
    const { $, store, finder } = setup(t), record = finder(), c = record.controller;
    await create($, record, 'New Folder', 'Research');
    assert.equal(store.read(['Desktop', 'Research']).type, 'folder');
    c.grid.find('[aria-label="Research"]').trigger('dblclick');
    assert.deepEqual(plain(c.path), ['Desktop', 'Research']);
    await create($, record, 'New Text File', '<img onerror=alert(1)>.txt');
    assert.equal(c.grid.find('img').length, 0); assert.equal(c.grid.find('.file-name').text(), '<img onerror=alert(1)>.txt');
    const renaming = c.renameSelected(); await tick(); $('dialog input').val('Renamed.txt'); click($, 'Rename', 'dialog'); await renaming;
    assert.equal(store.read(['Desktop', 'Research', 'Renamed.txt']).content, '');
    c.search.val('missing').trigger('input'); assert.equal(c.grid.find('.file-item').length, 0);
    c.search.val('RENAMED').trigger('input'); assert.equal(c.grid.find('.file-item').length, 1);
    c.travel(-1); assert.deepEqual(plain(c.path), ['Desktop']); c.travel(1); assert.deepEqual(plain(c.path), ['Desktop', 'Research']);
});

test('two Finder windows retain independent paths, history, search and selected files', t => {
    const { finder } = setup(t), a = finder().controller, b = finder({ path: ['Documents'] }).controller;
    a.navigate(['Desktop', 'Project']); b.selected = 'notes.txt'; b.query = 'notes'; b.update();
    assert.deepEqual(plain(a.path), ['Desktop', 'Project']); assert.deepEqual(plain(b.path), ['Documents']);
    a.travel(-1); assert.equal(b.selected, 'notes.txt'); assert.equal(b.query, 'notes'); assert.equal(b.history.length, 1);
});

test('TextEdit persists correct per-window document and close cancellation preserves draft', async t => {
    const { $, w, wm, store, workspace } = setup(t);
    const first = await workspace.openPath(['Desktop', 'Welcome.txt']), second = await workspace.openPath(['Documents', 'notes.txt']);
    type(first.controller, 'Persistent note\n你好 <script>alert(1)</script>'); type(second.controller, 'Different draft');
    assert.equal(await first.controller.save(), true);
    assert.equal(new w.MacFileStore(w.localStorage).read(['Desktop', 'Welcome.txt']).content, first.controller.editor.content);
    assert.equal(second.controller.editor.dirty, true); assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    const closing = wm.requestClose(second.id); await tick(); click($, 'Cancel', 'dialog'); assert.equal(await closing, false);
    assert.equal(second.controller.editor.content, 'Different draft');
    const discard = wm.requestClose(second.id); await tick(); click($, 'Discard Changes', 'dialog'); assert.equal(await discard, true);
    assert.equal(wm.listWindows().length, 1); assert.equal(first.controller.disposed, false);
});

test('opening another text file creates a new document without replacing a dirty draft and dedupes saved paths', async t => {
    const { workspace, wm } = setup(t), first = await workspace.openPath(['Desktop', 'Welcome.txt']); type(first.controller, 'keep me');
    const second = await workspace.openPath(['Documents', 'notes.txt']);
    assert.notEqual(first.id, second.id); assert.equal(first.controller.editor.content, 'keep me');
    assert.equal((await workspace.openPath(['Desktop', 'Welcome.txt'])).id, first.id);
    assert.equal(wm.activeWindow.id, first.id); assert.equal(wm.listWindows().length, 2);
});

test('new documents use Save As; collision and Cancel retain the draft', async t => {
    const { $, wm, workspace, store } = setup(t), c = wm.openApp('textedit').controller; type(c, 'A new draft');
    let saving = c.save(); await tick(); $('dialog input').val('notes.txt'); click($, 'Save', 'dialog'); await tick();
    assert.match($('dialog .dialog-error').text(), /already exists/); assert.equal(store.read(['Documents', 'notes.txt']).content, 'Buy milk\nFinish code');
    click($, 'Cancel', 'dialog'); assert.equal(await saving, false); assert.equal(c.editor.dirty, true);
    saving = c.save(); await tick(); $('dialog input').val('Saved draft.txt'); click($, 'Save', 'dialog'); assert.equal(await saving, true);
    assert.equal(c.editor.dirty, false); assert.equal(store.read(['Documents', 'Saved draft.txt']).content, 'A new draft');
    assert.deepEqual(plain(c.snapshot()).path, ['Documents', 'Saved draft.txt']);
    const draft = wm.openApp('textedit', { newWindow: true }).controller; type(draft, 'not persisted'); assert.equal(draft.snapshot(), null);
});

test('clean editors refresh on Terminal write and dirty editors retain drafts with conflict protection', async t => {
    const { wm, workspace, store } = setup(t), record = await workspace.openPath(['Documents', 'notes.txt']), editor = record.controller;
    const terminal = wm.openApp('terminal').controller;
    await terminal.run('echo fresh > /Documents/notes.txt'); assert.equal(editor.editor.content, 'fresh\n'); assert.equal(editor.editor.dirty, false);
    type(editor, 'my draft'); await terminal.run('echo external > /Documents/notes.txt');
    assert.equal(editor.editor.content, 'my draft'); assert.equal(editor.editor.conflict, true); assert.match(editor.status.text(), /draft is preserved/);
    assert.equal(await editor.save(), false); assert.equal(store.read(['Documents', 'notes.txt']).content, 'external\n'); assert.equal(editor.editor.dirty, true);
});

test('folder rename remaps both Finder histories, TextEdit paths and Terminal cwd', async t => {
    const { store, wm, workspace, finder } = setup(t); const file = store.create(['Desktop', 'Project'], 'Inside.txt', 'text', 'Original');
    const a = finder({ path: ['Desktop', 'Project'] }).controller, b = finder().controller; b.navigate(['Desktop', 'Project']); b.travel(-1);
    const editor = (await workspace.openPath(file)).controller, terminal = wm.openApp('terminal', { path: ['Desktop', 'Project'] }).controller;
    store.rename(['Desktop', 'Project'], 'New Project');
    assert.deepEqual(plain(a.path), ['Desktop', 'New Project']); b.travel(1); assert.deepEqual(plain(b.path), ['Desktop', 'New Project']);
    assert.deepEqual(plain(editor.editor.path), ['Desktop', 'New Project', 'Inside.txt']); assert.deepEqual(plain(terminal.cwd), ['Desktop', 'New Project']);
    type(editor, 'New content'); assert.equal(await editor.save(), true); assert.equal(store.read(['Desktop', 'New Project', 'Inside.txt']).content, 'New content');
});

test('folder trash preflights all dirty editors and a later Cancel preserves every draft and file', async t => {
    const { $, store, workspace } = setup(t);
    const a = store.create(['Desktop', 'Project'], 'a.txt', 'text', 'a'), b = store.create(['Desktop', 'Project'], 'b.txt', 'text', 'b');
    const first = (await workspace.openPath(a)).controller, second = (await workspace.openPath(b)).controller; type(first, 'draft a'); type(second, 'draft b');
    const deleting = workspace.requestTrash(['Desktop', 'Project']); await tick(); click($, 'Discard Changes', 'dialog'); await tick();
    assert.match($('dialog p').first().text(), /b.txt/); click($, 'Cancel', 'dialog'); assert.equal(await deleting, false);
    assert.equal(store.listTrash().length, 0); assert.equal(first.editor.content, 'draft a'); assert.equal(first.editor.dirty, true); assert.equal(second.editor.content, 'draft b');
    assert.equal(store.read(a).content, 'a'); assert.equal(store.read(b).content, 'b');
});

test('trash saves affected drafts when requested, preserves open copies and restores complete folder', async t => {
    const { $, store, workspace, wm } = setup(t), path = store.create(['Desktop', 'Project'], 'Inside.txt', 'text', 'Old');
    const editor = (await workspace.openPath(path)).controller; type(editor, 'Saved before deletion');
    const deleting = workspace.requestTrash(['Desktop', 'Project']); await tick(); click($, 'Save', 'dialog'); assert.equal(await deleting, true);
    assert.equal(store.listTrash()[0].node.children['Inside.txt'].content, 'Saved before deletion');
    assert.equal(editor.editor.path, null); assert.equal(editor.editor.content, 'Saved before deletion');
    const trash = wm.openApp('trash').controller; trash.selected = store.listTrash()[0].id; assert.equal(trash.restore(), true);
    assert.equal(store.read(path).content, 'Saved before deletion'); assert.equal(store.listTrash().length, 0);
});

test('Empty Trash requires confirmation, Cancel preserves items, storage failure preserves all data', async t => {
    const { $, store, workspace } = setup(t); store.trash(['Documents', 'notes.txt']);
    let emptying = workspace.emptyTrash(); await tick(); click($, 'Cancel', 'dialog'); assert.equal(await emptying, false); assert.equal(store.listTrash().length, 1);
    const before = store._raw; store._storage = { getItem: () => before, setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
    emptying = workspace.emptyTrash(); await tick(); click($, 'Empty Trash', 'dialog'); assert.equal(await emptying, false); assert.equal(store.listTrash().length, 1); assert.equal(store._raw, before);
    store._storage = { getItem: () => before, setItem: () => {} }; emptying = workspace.emptyTrash(); await tick(); click($, 'Empty Trash', 'dialog'); assert.equal(await emptying, true); assert.equal(store.listTrash().length, 0);
});

test('storage failures keep editor dirty and preserve saved document', async t => {
    const { workspace, store } = setup(t), editor = (await workspace.openPath(['Documents', 'notes.txt'])).controller;
    const original = store.read(['Documents', 'notes.txt']).content;
    store._storage = { getItem: () => store._raw, setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } };
    type(editor, 'Unsaved because full'); assert.equal(await editor.save(), false); assert.equal(editor.editor.dirty, true);
    assert.equal(store.read(['Documents', 'notes.txt']).content, original); assert.match(editor.status.text(), /storage is full/i);
});

test('two Terminals have independent cwd/history; writes, literal output and open connect to desktop', async t => {
    const { wm, workspace, store } = setup(t), a = wm.openApp('terminal').controller, b = wm.openApp('terminal', { newWindow: true }).controller;
    await a.run('cd /Documents'); await b.run('cd /Downloads'); await a.run('echo "<img src=x onerror=alert(1)>" > terminal.txt'); await a.run('cat terminal.txt');
    assert.equal(store.read(['Documents', 'terminal.txt']).content, '<img src=x onerror=alert(1)>\n'); assert.equal(a.historyElement.find('img').length, 0);
    assert.match(a.historyElement.text(), /<img src=x onerror=alert\(1\)>/); assert.deepEqual(plain(b.cwd), ['Downloads']); assert.equal(b.history.length, 1);
    a.input.trigger(require('jquery')(a.input[0].ownerDocument.defaultView).Event('keydown', { key: 'ArrowUp' })); assert.equal(a.input.val(), 'cat terminal.txt');
    await a.run('open terminal.txt'); assert.equal(wm.activeWindow.controller.editor.content, '<img src=x onerror=alert(1)>\n');
    const count = workspace.controllers.size; const record = wm.listWindows().find(r => r.controller === a); await wm.requestClose(record.id); assert.equal(workspace.controllers.size, count - 1); assert.equal(b.disposed, false);
});

test('Terminal recovers a removed cwd and preserves escaped command whitespace', async t => {
    const { store, wm } = setup(t), terminal = wm.openApp('terminal', { path: ['Desktop', 'Project'] }).controller;
    store.trash(['Desktop', 'Project']); assert.deepEqual(plain(terminal.cwd), ['Desktop']); assert.match(terminal.historyElement.text(), /Current folder is no longer available/);
    await terminal.run('echo tail\\ '); assert.equal(terminal.historyElement.find('.term-line').last().text(), 'tail ');
});

test('desktop file controller shares mutations, single-selection, context menu and keyboard target', async t => {
    const { $, workspace, store, wm } = setup(t), desktop = workspace.desktop;
    desktop.grid.find('[aria-label="Project"]').trigger('click'); const welcome = desktop.grid.find('[aria-label="Welcome.txt"]'); welcome.trigger('focus');
    assert.equal(desktop.selected, 'Welcome.txt'); assert.equal(wm.activeWindow, null);
    welcome.trigger($.Event('keydown', { key: 'Enter' })); await tick(); assert.deepEqual(plain(wm.activeWindow.controller.editor.path), ['Desktop', 'Welcome.txt']);
    desktop.grid.find('[aria-label="Welcome.txt"]').trigger($.Event('contextmenu', { clientX: 80, clientY: 100 })); assert.equal($('.workspace-context-menu').attr('role'), 'menu'); assert.match($('.workspace-context-menu').text(), /Get Info/);
    workspace.closeContextMenu(); desktop.grid.find('[aria-label="Welcome.txt"]').trigger($.Event('keydown', { key: 'Delete' })); await tick();
    assert.equal(store.listTrash()[0].name, 'Welcome.txt'); assert.equal(store.read(['Desktop', 'Project']).type, 'folder');
});

test('read-only recovery disables file mutations without hiding files or export', async t => {
    const { finder, wm, workspace } = setup(t, '{broken'); const c = finder().controller; c.selected = 'Welcome.txt'; c.updateSelection();
    assert.equal(c.commands.newFolder.enabled(), false); assert.equal(c.commands.rename.enabled(), false); assert.equal(c.commands.trash.enabled(), false); assert.equal(c.commands.open.enabled(), true);
    const editor = (await workspace.openPath(['Desktop', 'Welcome.txt'])).controller; assert.equal(editor.commands.save.enabled(), false); assert.equal(editor.commands.export.enabled(), true);
    assert.equal(await workspace.command('newFolder', wm.listWindows().find(r => r.controller === c)), false);
});

test('editor undo/redo and display style are per-window; snapshots exclude draft contents', async t => {
    const { wm, workspace } = setup(t), a = (await workspace.openPath(['Documents', 'notes.txt'])).controller, b = wm.openApp('textedit', { newWindow: true }).controller;
    type(a, 'first'); type(a, 'second'); type(b, 'independent'); a.undo(-1); assert.equal(a.editor.content, 'first'); assert.equal(b.editor.content, 'independent'); a.undo(1); assert.equal(a.editor.content, 'second');
    a.fontSelect.val('monospace').trigger('change'); a.sizeSelect.val('24').trigger('change'); assert.equal(b.font, 'sans-serif'); assert.equal(b.size, 14);
    assert.deepEqual(Object.keys(plain(a.snapshot())).sort(), ['font', 'path', 'size']); assert.equal(b.snapshot(), null);
});

test('dialogs serialize and restore input selection without duplicate IDs', async t => {
    const { $, wm, workspace } = setup(t), a = wm.openApp('textedit').controller, b = wm.openApp('textedit', { newWindow: true }).controller;
    type(a, 'abcdef'); a.textarea[0].focus(); a.textarea[0].setSelectionRange(1, 4);
    const first = workspace.dialog('First', '', null, [{ label: 'Done', value: true }]); const second = workspace.dialog('Second', '', null, [{ label: 'Done', value: true }]);
    await tick(); assert.equal($('dialog').length, 1); assert.equal($('dialog h2').text(), 'First'); click($, 'Done', 'dialog'); await first; await tick();
    assert.equal($('dialog').length, 1); assert.equal($('dialog h2').text(), 'Second'); click($, 'Done', 'dialog'); await second;
    assert.equal(a.textarea[0].selectionStart, 1); assert.equal(a.textarea[0].selectionEnd, 4);
    const ids = [...$.find('[id]')].map(e => e.id); assert.equal(new Set(ids).size, ids.length); assert.notEqual(a.textarea[0], b.textarea[0]);
});

test('invalid restored paths safely fall back and saved documents reopen their saved baseline', t => {
    const { wm } = setup(t);
    const finder = wm.openApp('finder', { restore: { path: ['Missing'] } }).controller, terminal = wm.openApp('terminal', { restore: { path: ['Missing'] } }).controller;
    const editor = wm.openApp('textedit', { restore: { path: ['Documents', 'notes.txt'], content: 'must not restore', dirty: true, font: 'monospace', size: 18 } }).controller;
    assert.deepEqual(plain(finder.path), ['Desktop']); assert.deepEqual(plain(terminal.cwd), []); assert.equal(editor.editor.content, 'Buy milk\nFinish code'); assert.equal(editor.editor.dirty, false); assert.equal(editor.size, 18);
});


test('Trash sort commands are real actions and restoring by button clears stale selection', t => {
    const { $, wm, store } = setup(t); store.trash(['Documents', 'notes.txt']); store.trash(['Desktop', 'Project']);
    const trash = wm.openApp('trash').controller;
    trash.commands.sortType.run(); assert.equal(trash.commands.sortType.checked(), true);
    assert.equal(trash.container.find('.trash-row').first().attr('aria-label'), 'Project');
    trash.commands.sortName.run(); assert.equal(trash.container.find('.trash-row').first().attr('aria-label'), 'notes.txt');
    click($, 'Restore', trash.container); assert.equal(trash.selected, null); assert.equal(trash.commands.restore.enabled(), false);
});
