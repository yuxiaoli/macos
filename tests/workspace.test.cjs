'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(t) {
    const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
    const dom = new JSDOM(html, { url: 'https://macos.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, $ = require('jquery')(w);
    w.$ = w.jQuery = $; $.fx.off = true;
    $.fn.draggable = $.fn.resizable = function () { return this; };
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
    ['file-store.js', 'terminal.js', 'workspace.js'].forEach(file => w.eval(fs.readFileSync(path.join(root, 'site/js', file), 'utf8')));
    const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]).find(source => source.includes('class WindowManager'));
    w.eval(inline + '\nwindow.app = {wm, workspace, fileStore};');
    $('#boot-screen').remove(); w.app.wm.openApp('finder');
    t.after(() => dom.window.close());
    return { w, $, ...w.app };
}
function click($, text, scope = 'body') {
    const button = $(scope).find('button').filter((_, e) => $(e).text() === text).first();
    assert.ok(button.length, 'Button exists: ' + text); button.trigger('click');
}
function type($, text) { $('#text-area').val(text).trigger('input'); }
async function create($, label, name) {
    click($, label, '#content-finder'); $('dialog input').val(name); click($, 'Create', 'dialog'); await tick();
}

test('Finder creates, searches, renames, navigates and renders filenames as literal text', async t => {
    const { $, fileStore, workspace } = setup(t);
    await create($, 'New Folder', 'Research');
    assert.equal(fileStore.read(['Desktop', 'Research']).type, 'folder');
    $('#finder-grid .file-item').filter((_, e) => $(e).attr('aria-label') === 'Research').trigger('dblclick');
    assert.deepEqual(Array.from(workspace.path), ['Desktop', 'Research']);
    await create($, 'New Text File', '<img onerror=alert(1)>.txt');
    assert.equal($('#finder-grid img').length, 0);
    assert.equal($('#finder-grid .file-name').text(), '<img onerror=alert(1)>.txt');
    click($, 'Rename', '#content-finder'); $('dialog input').val('Renamed.txt'); click($, 'Rename', 'dialog'); await tick();
    assert.equal(fileStore.read(['Desktop', 'Research', 'Renamed.txt']).content, '');
    $('#finder-search').val('missing').trigger('input'); assert.equal($('#finder-grid .file-item').length, 0);
    $('#finder-search').val('RENAMED').trigger('input'); assert.equal($('#finder-grid .file-item').length, 1);
    $('[aria-label="Back"]').trigger('click'); assert.deepEqual(Array.from(workspace.path), ['Desktop']);
    $('[aria-label="Forward"]').trigger('click'); assert.deepEqual(Array.from(workspace.path), ['Desktop', 'Research']);
});

test('TextEdit saves through Finder and survives a fresh store, with safe close cancellation', async t => {
    const { $, w, wm, fileStore, workspace } = setup(t);
    await create($, 'New Text File', 'Test.txt'); click($, 'Open', '#content-finder'); await tick();
    type($, 'Persistent note\n你好 <script>alert(1)</script>');
    assert.equal(workspace.editor.dirty, true);
    $('#text-area').trigger($.Event('keydown', { key: 's', ctrlKey: true })); await tick();
    const saved = fileStore.read(['Desktop', 'Test.txt']).content;
    assert.equal(saved, 'Persistent note\n你好 <script>alert(1)</script>');
    assert.equal(new w.MacFileStore(w.localStorage).read(['Desktop', 'Test.txt']).content, saved);
    type($, 'Unsaved replacement'); const closing = wm.closeWindow('textedit'); await tick();
    assert.equal($('dialog h2').text(), 'Save your changes?'); click($, 'Cancel', 'dialog'); await closing;
    assert.equal($('#text-area').val(), 'Unsaved replacement'); assert.ok(wm.windows.textedit);
    const discard = wm.closeWindow('textedit'); await tick(); click($, 'Discard Changes', 'dialog'); await discard;
    assert.equal($('#win-textedit').length, 0); assert.equal(workspace.editor.dirty, false);
    await workspace.openPath(['Desktop', 'Test.txt']); assert.equal($('#text-area').val(), saved);
});

test('new documents use Save As, conflicts do not overwrite files, and cancel preserves dirty content', async t => {
    const { $, wm, workspace, fileStore } = setup(t); wm.openApp('textedit'); type($, 'A new draft');
    click($, 'Save', '#content-textedit'); await tick();
    $('dialog input').val('Welcome.txt'); click($, 'Save', 'dialog'); await tick();
    assert.ok($('dialog .dialog-error').text().length); assert.notEqual(fileStore.read(['Desktop', 'Welcome.txt']).content, 'A new draft');
    click($, 'Cancel', 'dialog'); await tick(); assert.equal(workspace.editor.dirty, true);
    click($, 'Save', '#content-textedit'); await tick(); $('dialog input').val('Saved draft.txt'); click($, 'Save', 'dialog'); await tick();
    assert.equal(workspace.editor.dirty, false); assert.equal(fileStore.read(['Desktop', 'Saved draft.txt']).content, 'A new draft');
});

test('opening another file respects Cancel, Discard and Save choices without leaking stale content', async t => {
    const { $, workspace, fileStore } = setup(t);
    await workspace.openPath(['Desktop', 'Welcome.txt']); type($, 'keep me');
    let opening = workspace.openPath(['Documents', 'notes.txt']); await tick(); click($, 'Cancel', 'dialog'); await opening;
    assert.equal($('#text-area').val(), 'keep me');
    opening = workspace.openPath(['Documents', 'notes.txt']); await tick(); click($, 'Save', 'dialog'); await opening;
    assert.equal(fileStore.read(['Desktop', 'Welcome.txt']).content, 'keep me');
    assert.equal($('#text-area').val(), fileStore.read(['Documents', 'notes.txt']).content);
});

test('Trash restores file contents and folder rename follows the open editor', async t => {
    const { $, workspace, fileStore, wm } = setup(t);
    fileStore.create(['Desktop', 'Project'], 'Inside.txt', 'text', 'Original');
    await workspace.openPath(['Desktop', 'Project', 'Inside.txt']);
    workspace.navigate(['Desktop']); workspace.selected = 'Project'; workspace.updateFinder();
    click($, 'Rename', '#content-finder'); $('dialog input').val('New Project'); click($, 'Rename', 'dialog'); await tick();
    assert.deepEqual(Array.from(workspace.editor.path), ['Desktop', 'New Project', 'Inside.txt']);
    type($, 'New content'); await workspace.saveEditor();
    await workspace.trashSelected(); assert.equal(fileStore.listTrash().length, 1); assert.equal(workspace.editor.path, null);
    wm.openApp('trash'); click($, 'Restore', '#content-trash');
    assert.equal(fileStore.read(['Desktop', 'New Project', 'Inside.txt']).content, 'New content'); assert.equal(fileStore.listTrash().length, 0);
});

test('storage failures keep an editor dirty and preserve the saved document', async t => {
    const { $, workspace, fileStore } = setup(t); await workspace.openPath(['Documents', 'notes.txt']);
    const original = fileStore.read(['Documents', 'notes.txt']).content;
    fileStore._storage = { getItem: () => fileStore._raw, setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } };
    type($, 'Unsaved because full'); assert.equal(await workspace.saveEditor(), false);
    assert.equal(workspace.editor.dirty, true); assert.equal(fileStore.read(['Documents', 'notes.txt']).content, original);
    assert.match($('#text-status').text(), /storage is full/i);
});

test('Terminal connects file writes, safe output, command history and open actions to desktop', async t => {
    const { $, wm, fileStore, workspace } = setup(t); wm.openApp('terminal');
    async function command(text) { $('#term-input').val(text).trigger($.Event('keydown', { key: 'Enter' })); await tick(); }
    await command('echo "<img src=x onerror=alert(1)>" > /Documents/terminal.txt');
    assert.equal(fileStore.read(['Documents', 'terminal.txt']).content, '<img src=x onerror=alert(1)>\n');
    await command('cat /Documents/terminal.txt'); assert.equal($('#term-history img').length, 0);
    assert.match($('#term-history').text(), /<img src=x onerror=alert\(1\)>/);
    $('#term-input').trigger($.Event('keydown', { key: 'ArrowUp' })); assert.equal($('#term-input').val(), 'cat /Documents/terminal.txt');
    await command('open /Documents/terminal.txt'); assert.deepEqual(Array.from(workspace.editor.path), ['Documents', 'terminal.txt']);
    assert.equal($('#text-area').val(), '<img src=x onerror=alert(1)>\n');
});

test('File menu and new desktop buttons expose accessible native controls', t => {
    const { $, wm } = setup(t); assert.equal($('#dock-textedit')[0].tagName, 'BUTTON');
    assert.equal($('#win-finder .close-btn').attr('aria-label'), 'Close Finder');
    $('#file-menu-button').trigger('click'); assert.equal($('#workspace-file-menu').attr('role'), 'menu');
    assert.equal($('#file-menu-button').attr('aria-expanded'), 'true');
    wm.openApp('textedit'); $('#workspace-file-menu').remove(); $('#file-menu-button').trigger('click');
    assert.match($('#workspace-file-menu').text(), /Save As/);
});

test('keyboard focus chooses the correct file for Enter and Delete rather than a stale selection', async t => {
    const { $, workspace, fileStore } = setup(t);
    const project = $('#finder-grid [aria-label="Project"]'); project.trigger('click');
    const welcome = $('#finder-grid [aria-label="Welcome.txt"]'); welcome.trigger('focus');
    assert.equal(workspace.selected, 'Welcome.txt');
    welcome.trigger($.Event('keydown', { key: 'Enter' })); await tick();
    assert.deepEqual(Array.from(workspace.editor.path), ['Desktop', 'Welcome.txt']);
    welcome.trigger('focus').trigger($.Event('keydown', { key: 'Delete' })); await tick();
    assert.equal(fileStore.listTrash()[0].name, 'Welcome.txt');
    assert.equal(fileStore.read(['Desktop', 'Project']).type, 'folder');
});

test('keyboard focus activates TextEdit for save shortcut and Terminal recovers a removed cwd', async t => {
    const { $, wm, workspace, fileStore } = setup(t);
    await workspace.openPath(['Documents', 'notes.txt']); wm.openApp('finder');
    $('#text-area').trigger('focus'); assert.equal(wm.activeApp, 'TextEdit');
    type($, 'Keyboard saved'); $('#text-area').trigger($.Event('keydown', { key: 's', ctrlKey: true })); await tick();
    assert.equal(fileStore.read(['Documents', 'notes.txt']).content, 'Keyboard saved');
    wm.openApp('terminal'); $('#term-input').val('cd /Desktop/Project').trigger($.Event('keydown', { key: 'Enter' })); await tick();
    fileStore.rename(['Desktop', 'Project'], 'Renamed');
    assert.match($('.term-input-line .term-prompt').text(), /\/Desktop %/);
    assert.match($('#term-history').text(), /Current folder is no longer available/);
    $('#term-input').val('echo tail\\ ').trigger($.Event('keydown', { key: 'Enter' })); await tick();
    assert.equal($('#term-history .term-line').last().text(), 'tail ');
});
