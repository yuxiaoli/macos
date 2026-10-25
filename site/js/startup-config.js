/* URL configuration selects bundled apps only. It never executes code or writes storage. */
(function (root, factory) {
    'use strict';
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.MacStartupConfig = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const MAX_JSON_BYTES = 8192;
    const MAX_HOMEPAGE_LENGTH = 2048;
    const MAX_QUERY_LENGTH = 32768;
    const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    function invalid() { throw new Error('Invalid startup configuration'); }
    function record(value, allowed) {
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).some(key => !allowed.includes(key))) invalid();
    }
    function safeHomepage(value) {
        if (typeof value !== 'string' || !value || value.length > MAX_HOMEPAGE_LENGTH ||
            !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f\\]/.test(value)) invalid();
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) invalid();
        return url.href;
    }
    function parse(search, registeredIds) {
        const fallback = () => ({ supplied: true, config: null, warning: 'Startup configuration was ignored because it is invalid or unsupported. Default apps and the saved workspace were loaded.' });
        if (typeof search !== 'string' || search.length > MAX_QUERY_LENGTH) return fallback();
        const params = new URLSearchParams(search);
        if (!params.has('config')) return { supplied: false, config: null, warning: null };
        try {
            // Bound the config value before further decoding and JSON parsing.
            const encodedValues = String(search).replace(/^\?/, '').split('&').filter(part => {
                try { return decodeURIComponent(part.split('=')[0].replace(/\+/g, ' ')) === 'config'; }
                catch (_) { return false; }
            });
            if (params.getAll('config').length !== 1 || encodedValues.length !== 1 ||
                encodedValues[0].length > MAX_JSON_BYTES * 3 + 7) invalid();
            const rawText = params.get('config');
            // URLSearchParams tolerates malformed escapes; our contract does not.
            const encoded = encodedValues[0].slice(encodedValues[0].indexOf('=') + 1);
            decodeURIComponent(encoded.replace(/\+/g, ' '));
            if (new TextEncoder().encode(rawText).length > MAX_JSON_BYTES) invalid();
            const raw = JSON.parse(rawText);
            record(raw, ['version', 'apps']);
            if (raw.version !== 1) invalid();
            let apps = null;
            if (has(raw, 'apps')) {
                record(raw.apps, registeredIds);
                apps = {};
                for (const id of Object.keys(raw.apps)) {
                    // Reserved object keys cannot be registered app IDs.
                    if (['__proto__', 'prototype', 'constructor'].includes(id)) invalid();
                    record(raw.apps[id], id === 'safari' ? ['homepage'] : []);
                    apps[id] = id === 'safari' && has(raw.apps[id], 'homepage') ? { homepage: safeHomepage(raw.apps[id].homepage) } : {};
                }
            }
            return { supplied: true, config: { version: 1, apps }, warning: null };
        } catch (_) {
            return fallback();
        }
    }
    return { parse, MAX_JSON_BYTES, MAX_HOMEPAGE_LENGTH, MAX_QUERY_LENGTH };
}));
