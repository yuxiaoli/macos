'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

// Test-only instrumentation, not an application option or a mutable production table.
module.exports = function syntheticLegacyStore(texts) {
    const source = fs.readFileSync(path.join(__dirname, '../../site/js/file-store.js'), 'utf8');
    const pattern = /var LEGACY_WELCOME_FINGERPRINTS = \[[^\n]*\];/;
    if (!pattern.test(source)) throw new Error('Expected private legacy fingerprint table');
    const entries = texts.map(text => ({characters: text.length, bytes: Buffer.byteLength(text, 'utf8'), sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex')}));
    let instrumented = source.replace(pattern, 'var LEGACY_WELCOME_FINGERPRINTS = ' + JSON.stringify(entries) + ';');
    if (!instrumented.includes('function sha256(text) {')) throw new Error('Expected internal digest helper');
    instrumented = instrumented.replace('function sha256(text) {', 'function sha256(text) { globalThis.__hashCalls += 1;');
    const sandbox = {module: {exports: {}}, JSON, __hashCalls: 0};
    vm.runInNewContext(instrumented, sandbox);
    return {Store: sandbox.module.exports, hashCalls: () => sandbox.__hashCalls};
};
