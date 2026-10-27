'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Store = require('../site/js/file-store.js');

test('synchronous SHA256 matches native crypto for standard, padding-boundary and strict Unicode inputs', () => {
    assert.equal(typeof Store.sha256, 'function');
    const inputs = ['', 'abc', 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
        '\u0000', 'A\u0000B', '\u00e9', 'e\u0301', '\u4e2d\u6587', '\u{1f680}', '\u{1f680}\u00e9\u0000'];
    for (const size of [1, 54, 55, 56, 63, 64, 65, 119, 120, 127, 128, 129, 731, 1024, 1000000]) inputs.push('a'.repeat(size));
    for (const text of inputs) assert.equal(Store.sha256(text), crypto.createHash('sha256').update(text, 'utf8').digest('hex'));
    assert.notEqual(Store.sha256('\u00e9'), Store.sha256('e\u0301'), 'normalization must never be applied');
    for (const bad of ['\ud800', '\udc00', 'x\ud800', '\ud800x', '\ud800\ud800', '\udc00\ud800', null, 123, {}]) {
        assert.equal(Store.sha256(bad), null, 'malformed UTF-16 and non-strings fail closed');
    }
});
