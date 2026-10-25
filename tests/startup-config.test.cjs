'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Config = require('../site/js/startup-config.js');
const ids = ['finder', 'safari', 'terminal', 'textedit', 'sketch', 'calculator', 'settings', 'trash'];
const query = value => '?config=' + encodeURIComponent(JSON.stringify(value));

test('absent config preserves defaults; versioned apps select exact registered apps and nested Safari homepage', () => {
    assert.deepEqual(Config.parse('', ids), { supplied: false, config: null, warning: null });
    const parsed = Config.parse(query({version: 1, apps: {finder: {}, safari: {homepage: 'https://vectorindex.cloud'}}}), ids);
    assert.equal(parsed.warning, null);
    assert.equal(parsed.supplied, true);
    assert.deepEqual(Object.keys(parsed.config.apps), ['finder', 'safari']);
    assert.equal(parsed.config.apps.safari.homepage, 'https://vectorindex.cloud/');
    assert.deepEqual(Config.parse(query({version: 1}), ids).config, {version: 1, apps: null});
});

test('invalid, oversized, ambiguous or unsafe configs fall back without exposing values or polluting prototypes', () => {
    const invalid = [
        '?config=', '?config=%7B', '?config=%E0%A4%A', '?config=%FF',
        query({version: 1}) + '&config=' + encodeURIComponent('{"version":1}'),
        query(null), query([]), query({}), query({version: 2}), query({version: '1'}),
        query({version: 1, unknown: true}), query({version: 1, apps: []}), query({version: 1, apps: null}),
        query({version: 1, apps: {browser: {}}}), query({version: 1, apps: {finder: {homepage: 'https://example.com'}}}),
        query({version: 1, apps: {safari: {homepage: null}}}), query({version: 1, apps: {safari: {unknown: true}}}),
        '?config=' + encodeURIComponent('{"version":1,"apps":{"__proto__":{"polluted":true}}}'),
        '?config=' + encodeURIComponent('{"version":1,"apps":{"constructor":{}}}'),
        '?config=' + encodeURIComponent('{"version":1,"apps":{"safari":{"prototype":{}}}}'),
        query({version: 1, apps: {safari: {homepage: 'https://example.com/' + 'x'.repeat(2048)}}}),
        '?config=' + encodeURIComponent(' '.repeat(8193)),
        '?config=' + '%20'.repeat(8193), '?unused=' + 'x'.repeat(32768)
    ];
    for (const homepage of ['javascript:alert(1)', 'data:text/html,bad', 'file:///a', '//example.com', 'example.com',
        'https://user:password@example.com', 'https://example.com\\evil', 'https://exa\nmple.com', 'https://', 'https://bad host']) {
        invalid.push(query({version: 1, apps: {safari: {homepage}}}));
    }
    for (const search of invalid) {
        const result = Config.parse(search, ids);
        assert.equal(result.supplied, true);
        assert.equal(result.config, null);
        assert.match(result.warning, /ignored/);
        assert.ok(!result.warning.includes('password'));
    }
    assert.equal({}.polluted, undefined);
    assert.deepEqual(Config.parse(query({version: 1, apps: {}}), ids).config.apps, {});
});
