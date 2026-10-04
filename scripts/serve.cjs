'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..', 'site');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
http.createServer(async (req, res) => {
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!target.startsWith(root + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
        const file = await fs.readFile(target);
        res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' }); res.end(file);
    } catch (_) { res.writeHead(404).end('Not Found'); }
}).listen(Number(process.env.PORT) || 3000, () => console.log('macOS desktop: http://localhost:' + (process.env.PORT || 3000)));
