#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency static dev server with live reload.
 *
 *   node server.js [--port 3000]
 *
 * Serves this directory over http://localhost:<port> and reloads open browser
 * tabs whenever a file changes. Nothing here is meant for production.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const ROOT = __dirname;
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg !== -1 ? process.argv[portArg + 1] : 0) || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Injected into every HTML response. Reconnects on its own if the server
// restarts, so you don't have to touch the tab.
const LIVE_RELOAD = `
<script>
(function () {
  var es = new EventSource('/__livereload');
  es.onmessage = function () { location.reload(); };
  es.onerror = function () {
    es.close();
    setTimeout(function () { location.reload(); }, 1000);
  };
})();
</script>
`;

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();

function broadcastReload() {
  for (const res of clients) res.write('data: reload\n\n');
}

// --- file watching ---

let reloadTimer = null;
fs.watch(ROOT, { recursive: true }, (_event, filename) => {
  // Editors write temp/swap files; ignore anything that isn't served.
  if (filename && /(^\.|~$|\.swp$|node_modules)/.test(filename)) return;
  clearTimeout(reloadTimer); // Debounce: one save can fire several events.
  reloadTimer = setTimeout(() => {
    console.log(`  reload  ${filename || 'change'}`);
    broadcastReload();
  }, 50);
});

// --- request handling ---

function resolveSafe(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const target = path.join(ROOT, decoded);
  const resolved = path.resolve(target);
  // Reject anything that escapes ROOT via ../ or a symlinked path.
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

const server = http.createServer(async (req, res) => {
  if (req.url.split('?')[0] === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let filePath = resolveSafe(req.url);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    let stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fsp.stat(filePath);
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      let html = await fsp.readFile(filePath, 'utf8');
      html = html.includes('</body>')
        ? html.replace('</body>', LIVE_RELOAD + '</body>')
        : html + LIVE_RELOAD;
      res.writeHead(200, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
      });
      res.end(html);
    } else {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-store', // Always see the file you just saved.
      });
      fs.createReadStream(filePath).pipe(res);
    }

    console.log(`  ${res.statusCode}  ${req.method} ${req.url}`);
  } catch (err) {
    const code = err.code === 'ENOENT' || err.code === 'ENOTDIR' ? 404 : 500;
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(code === 404 ? 'Not found' : 'Server error');
    console.log(`  ${code}  ${req.method} ${req.url}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use. Try: node server.js --port ${PORT + 1}`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n  To-do list dev server`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  live reload on — Ctrl+C to stop\n`);
});
