'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Store = require('../site/js/file-store.js');
const syntheticStore = require('./helpers/synthetic-legacy-store.cjs');
const sourcePath = path.join(__dirname, '../site/js/file-store.js');

test('production legacy recognition keeps only exact length and SHA256 metadata', () => {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const match = source.match(/var LEGACY_WELCOME_FINGERPRINTS = (\[[^\n]*\]);/);
    assert.ok(match, 'private fingerprint metadata table is required');
    assert.deepEqual(JSON.parse(match[1]), [
        {characters:137, bytes:137, sha256:'674026d96aa033112d460086ef815de53f03d3412eca0391100c9af74f598f72'},
        {characters:369, bytes:369, sha256:'9b9a506e17e6266ab78194b07f512e598c1cb2a10deadcc14990ab19fdb5cf3e'},
        {characters:725, bytes:731, sha256:'7c70312c5a1edb947fa2238de34f32a00a191d86c1778abb9da9e163f36a824a'}
    ]);
    assert.equal(source.includes('LEGACY_WELCOME_TEXTS'), false, 'plaintext allowlist must be absent');
});


function savedState(text) {
    let raw = null;
    new Store({getItem() {return raw;}, setItem(key, value) {raw = value;}});
    const state = JSON.parse(raw);
    state.root.children.Desktop.children['Welcome.txt'].content = text;
    state.root.children.Documents.children['notes.txt'].content = 'Saved notes remain untouched.';
    return state;
}
function storageFor(state) {
    return {raw:JSON.stringify(state), writes:0, getItem() {return this.raw;}, setItem(key, value) {this.writes++;this.raw=value;}};
}

test('malformed UTF-16 user edits stay valid readable saved data and never migrate', () => {
    for (const surrogate of ['\ud800','\udc00']) {
        const text = 'x'.repeat(720) + '\u2014'.repeat(2) + surrogate + 'xx';
        assert.equal(text.length, 725);
        assert.equal(Buffer.byteLength(text, 'utf8'), 731, 'exercise the eligible length/byte guard');
        const storage = storageFor(savedState(text));
        const before = storage.raw, store = new Store(storage);
        assert.equal(store.readOnly, false);
        assert.equal(store.storageWarning, null);
        assert.equal(store.read(['Desktop','Welcome.txt']).content === text, true);
        assert.equal(storage.raw === before, true);
        assert.equal(storage.writes, 0);
    }
});

test('startup length guards avoid hashing arbitrary large or ineligible saved documents', () => {
    const eligible = 'Synthetic eligible default.'.padEnd(137, '.');
    for (const text of ['unrecognized short note', 'x'.repeat(Store.MAX_CONTENT_BYTES), '\u00e9'.repeat(137)]) {
        const instrumented = syntheticStore([eligible]);
        const storage = storageFor(savedState(text));
        const before = storage.raw, store = new instrumented.Store(storage);
        assert.equal(store.readOnly, false);
        assert.equal(storage.raw === before, true);
        assert.equal(storage.writes, 0);
        assert.equal(instrumented.hashCalls(), 0);
    }
});

test('migration uses the private synchronous digest rather than a mutable exported property', () => {
    const eligible = 'Synthetic eligible default.'.padEnd(137, '.');
    const instrumented = syntheticStore([eligible]);
    instrumented.Store.sha256 = () => {throw new Error('Mutable public property must not be used.');};
    const storage = storageFor(savedState(eligible));
    const store = new instrumented.Store(storage);
    const canonical = fs.readFileSync(path.join(__dirname,'fixtures/canonical-welcome.txt'),'utf8');
    assert.equal(store.read(['Desktop','Welcome.txt']).content, canonical);
    assert.equal(storage.writes, 1);
    assert.equal(instrumented.hashCalls(), 1);
});
