'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'site');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
function asset(reference, owner) {
    if (/^(?:https?:|data:|blob:|#)/.test(reference) || reference.includes('${')) return;
    const relative = reference.split(/[?#]/)[0];
    if (!relative) return;
    const file = path.resolve(path.dirname(owner), relative);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error('Missing or unsafe asset: ' + reference + ' in ' + path.relative(root, owner));
}
for (const file of files(path.join(root, 'js'))) {
    if (file.endsWith('.js')) new vm.Script(fs.readFileSync(file, 'utf8'), { filename: path.relative(root, file) });
}
for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].entries()) {
    const source = match[1].match(/src="([^"]+)"/);
    if (source && /^https?:/.test(source[1])) throw new Error('Core scripts must be local: ' + source[1]);
    if (source) new vm.Script(fs.readFileSync(path.join(root, source[1].split(/[?#]/)[0]), 'utf8'), { filename: source[1] });
    else new vm.Script(match[2], { filename: 'index-inline-' + index + '.js' });
}
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) asset(match[1], path.join(root, 'index.html'));
for (const file of files(path.join(root, 'css'))) {
    if (!file.endsWith('.css')) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (/@import\s+(?:url\()?['"]?https?:/i.test(source)) throw new Error('Core CSS imports must be local: ' + file);
    for (const match of source.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/g)) {
        if (/^https?:/.test(match[1])) throw new Error('Core CSS assets must be local: ' + match[1]);
        asset(match[1], file);
    }
}
for (const app of ['finder', 'safari', 'terminal', 'textedit', 'sketch', 'calculator', 'settings', 'trash']) asset('assets/icons/' + app + '.svg', path.join(root, 'index.html'));
for (const license of ['vendor/jquery.LICENSE.txt', 'assets/LICENSE.txt']) {
    if (!fs.existsSync(path.join(root, license))) throw new Error('Missing resource license: ' + license);
}
console.log('All application JavaScript parses; local HTML/CSS/icon assets and licenses exist.');
