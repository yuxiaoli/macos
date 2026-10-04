'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..', 'site');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const [index, match] of [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].entries()) {
    const source = match[1].match(/src="([^"]+)"/);
    if (source && !/^https?:/.test(source[1])) new vm.Script(fs.readFileSync(path.join(root, source[1]), 'utf8'), { filename: source[1] });
    else if (!source) new vm.Script(match[2], { filename: 'index-inline-' + index + '.js' });
}
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (!/^(?:https?:|data:)/.test(match[1]) && !match[1].includes('${') && !fs.existsSync(path.join(root, match[1]))) throw new Error('Missing asset: ' + match[1]);
}
console.log('All application JavaScript parses; referenced local assets exist.');
