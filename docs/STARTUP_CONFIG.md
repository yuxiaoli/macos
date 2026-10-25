# Configured startup URLs

Pass one URL-encoded JSON object in the config query parameter. This selects bundled apps, not remote modules. Schema and example: [startup-config.schema.json](../data/startup-config.schema.json), [startup-config.example.json](../data/startup-config.example.json).

```js
const config = {version: 1, apps: {finder: {}, safari: {homepage: 'https://vectorindex.cloud'}, textedit: {}, terminal: {}}};
const url = new URL('https://yuxiaoli.github.io/macos/');
url.searchParams.set('config', JSON.stringify(config));
console.log(url.href);
```

Compact example (Safari and TextEdit):

<https://yuxiaoli.github.io/macos/?config=%7B%22version%22%3A1%2C%22apps%22%3A%7B%22safari%22%3A%7B%22homepage%22%3A%22https%3A%2F%2Fvectorindex.cloud%22%7D%2C%22textedit%22%3A%7B%7D%7D%7D>

Alternatively append `'?config=' + encodeURIComponent(JSON.stringify(config))`. Encode once; URLSearchParams already encodes. Shared URLs are public and may appear in history, logs or referrers. Never include secrets, credentials, tokens or private information.

## Version 1 behavior

- Root accepts only version (number 1) and apps. No config keeps normal defaults. Omitting apps enables all eight. Supplying apps is an exact allowlist; an empty object enables none. Every app value is an object.
- Registered IDs: finder, safari, terminal, textedit, sketch, calculator, settings, trash. Safari accepts homepage; other apps accept only empty options in v1. Selecting apps does not auto-launch them. With no saved layout, Finder opens Desktop if enabled; otherwise there are no initial windows.
- Availability applies before Dock and saved-window restoration. Disabled saved windows are skipped. Spotlight lists enabled apps. App launch menu entries and Control Center settings launcher are disabled when their target is unavailable. Desktop files remain visible; opening a file/folder requiring disabled TextEdit/Finder reports unavailable and retains the file.
- apps.safari.homepage overrides initial page and Home, including restored Safari windows. Omitted homepage defaults to https://vectorindex.cloud. Normal address-bar navigation still works. Saved-link bookmarks open external tabs.
- Valid config is temporary for this page session, including Restart Desktop. Saved preferences provide initial settings. Later preference/window-layout edits work in memory without overwriting the normal saved settings/session. Remove config and reload to restore that normal workspace. Files and Sketch drafts continue saving through their usual user edits; startup config never replaces documents.
- Normal TextEdit launch opens existing Documents/notes.txt, including saved edits. Explicit New Document stays blank. Deleted notes are never recreated.
- App selection controls presentation, not security. All built-in code is public; other enabled apps can access local files. Selection does not delete files or change permissions.

## Validation and fallback

The full query is capped at 32768 characters before query parsing; JSON at 8192 UTF-8 bytes; the encoded config value is also bounded. Malformed escaping/JSON, duplicate config parameters, unsupported versions, unknown IDs/options and reserved prototype keys are rejected. The closed schema limits nesting. There are no configurable code/HTML/module execution fields.

Homepage must be absolute HTTP(S), at most 2048 UTF-16 code units, with a valid hostname and no credentials, whitespace, controls or backslashes. Runtime URL parsing validates and normalizes it. Browser, site and iframe policies still apply; Open Externally remains available.

Invalid config is ignored as a whole: normal apps/saved data/layout load, then a generic warning appears without echoing the JSON. Valid config displays a temporary-session notice. Startup config does not write normal preferences or workspace.

## Validation commands

```sh
npm run check
node --test tests/startup-config.test.cjs tests/startup-integration.test.cjs
npm run test:browser -- tests/e2e/startup-config.spec.cjs --project=chromium
```

Unit/integration coverage includes unsafe/oversized/malformed configs, exact allowlists, unavailable apps, Safari Home precedence and preserved notes/settings/session. Browser journeys use explicit homepage fixtures; they do not certify external-site embedding.
