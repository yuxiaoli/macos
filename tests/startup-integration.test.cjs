'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const configQuery = apps => '?config=' + encodeURIComponent(JSON.stringify({version: 1, apps}));
function desktop(search, saved = {}) {
    const dom = new JSDOM(fs.readFileSync('site/index.html', 'utf8'), {runScripts: 'outside-only', url: 'https://desktop.test/' + search, pretendToBeVisual: true});
    const w = dom.window;
    Object.entries(saved).forEach(([k, v]) => w.localStorage.setItem(k, v));
    w.TextEncoder = TextEncoder;
    w.matchMedia = () => ({matches: true, addEventListener() {}});
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
    w.jQuery = require('jquery')(w);
    for (const file of ['file-store', 'terminal', 'workspace', 'apps', 'menus', 'startup-config', 'desktop']) w.eval(fs.readFileSync('site/js/' + file + '.js', 'utf8'));
    w.startDesktop();
    return {w, wm: w.wm, close() {w.clearInterval(w.menus.clockTimer); w.clearTimeout(w.wm.saveTimer); w.workspace.dispose(); w.wm.listWindows().forEach(r => r.controller?.dispose?.()); w.close();}};
}

test('configured app allowlist filters Dock, saved sessions and Spotlight and reports unavailable app opens', () => {
    const saved = {'macos.web.session.v1': JSON.stringify({version: 1, windows: [{appId: 'terminal', state: {}}, {appId: 'calculator', state: {}}]})};
    const x = desktop(configQuery({calculator: {}, safari: {}}), saved);
    try {
        assert.deepEqual(Array.from(x.wm.apps, app => app.id), ['safari', 'calculator']);
        assert.deepEqual(Array.from(x.w.document.querySelectorAll('#dock [data-app]'), el => el.dataset.app), ['safari', 'calculator']);
        assert.deepEqual(Array.from(x.wm.listWindows(), r => r.appId), ['calculator']);
        let message = '';
        x.w.workspace.report = text => { message = text; };
        assert.equal(x.wm.openApp('terminal'), null);
        assert.match(message, /not enabled/);
        x.w.menus.spotlight();
        x.w.menus.search('terminal');
        assert.equal(x.w.document.querySelector('.spotlight-results').textContent, 'No matches');
        const menus = x.w.menus.registry(null, {});
        assert.equal(menus.Apple.find(c => c.id === 'settings').enabled(), false);
        assert.equal(menus.File.find(c => c.id === 'newFinder').enabled(), false);
        assert.equal(menus.Go.find(c => c.id === 'go-Documents').enabled(), false);
    } finally {x.close();}
});

test('normal TextEdit launch opens existing starter notes, explicit New Document stays blank and deleted notes are not reseeded', async () => {
    const x = desktop('');
    try {
        x.w.fileStore.write(['Documents', 'notes.txt'], 'My own saved notes.');
        const notes = x.wm.openApp('textedit');
        assert.equal(notes.controller.editor.content, 'My own saved notes.');
        assert.deepEqual(Array.from(notes.controller.editor.path), ['Documents', 'notes.txt']);
        const blank = x.wm.openApp('textedit', {newWindow: true});
        assert.equal(blank.controller.editor.content, '');
        assert.equal(blank.controller.editor.path, null);
        await x.wm.closeApp('textedit');
        x.w.fileStore.trash(['Documents', 'notes.txt']);
        assert.equal(x.wm.openApp('textedit').controller.editor.content, '');
        assert.throws(() => x.w.fileStore.read(['Documents', 'notes.txt']));
    } finally {x.close();}
});

test('URL config is temporary: saved documents/settings/session survive; configured Safari home wins restored URL', async () => {
    let fileRaw = null;
    const files = new (require('../site/js/file-store.js'))({getItem() {return fileRaw;}, setItem(key, value) {fileRaw = value;}});
    files.write(['Documents', 'notes.txt'], 'My edited notes stay mine.');
    const saved = {
        'macos.web.filesystem.v1': fileRaw,
        'macos.web.settings.v1': JSON.stringify({version: 1, settings: {appearance: 'light'}}),
        'macos.web.session.v1': JSON.stringify({version: 1, windows: [{appId: 'safari', state: {url: 'https://old.example/'}}]})
    };
    const x = desktop(configQuery({safari: {homepage: 'https://example.com/new'}, textedit: {}}), saved);
    try {
        assert.equal(x.wm.settings.appearance, 'light');
        assert.equal(x.w.document.querySelector('.safari-address-input').value, 'https://example.com/new');
        assert.equal(x.w.document.querySelector('.safari-external').href, 'https://example.com/new');
        const safari = x.wm.activeWindow;
        x.w.document.querySelector('.safari-address-input').value = 'https://elsewhere.example/';
        x.w.document.querySelector('.safari-address-form').dispatchEvent(new x.w.Event('submit', {bubbles: true, cancelable: true}));
        safari.controller.commands.home.run();
        assert.equal(x.w.document.querySelector('.safari-address-input').value, 'https://example.com/new');
        x.wm.updateSettings({appearance: 'dark'});
        x.wm.openApp('textedit', {newWindow: true});
        x.wm.saveSession();
        assert.equal(x.w.fileStore.read(['Documents', 'notes.txt']).content, 'My edited notes stay mine.');
        for (const [key, value] of Object.entries(saved)) assert.equal(x.w.localStorage.getItem(key), value);
        assert.equal(x.wm.settings.appearance, 'dark', 'settings still work in this temporary session');
        assert.equal(await x.wm.restart(), true);
        for (const [key, value] of Object.entries(saved)) assert.equal(x.w.localStorage.getItem(key), value);
    } finally {x.close();}
});
