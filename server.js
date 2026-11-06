// Minimal static file server for local development.
//   node server.js            -> http://localhost:8000
//   PORT=9000 HOST=0.0.0.0 node server.js
// Webcams only work in a secure context: http://localhost is fine, but other
// machines on your LAN will need HTTPS (e.g. a tunnel) to use the camera.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream'
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method Not Allowed');

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.join(ROOT, pathname);
  const rel = path.relative(ROOT, filePath);
  // Stay inside the project, and never serve dotfiles (.git, .env, …).
  if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep).some((seg) => seg.startsWith('.') || seg === 'node_modules')) {
    return send(res, 404, 'Not Found');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      console.log(`[404] ${pathname}`);
      return send(res, 404, `Not Found: ${pathname}`);
    }

    const lastModified = stats.mtime.toUTCString();
    const headers = {
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stats.size,
      'Last-Modified': lastModified,
      // Revalidate every time, but let the browser reuse unchanged files (the GLBs are 4 MB).
      'Cache-Control': 'no-cache'
    };
    if (req.headers['if-modified-since'] === lastModified) {
      res.writeHead(304, headers);
      return res.end();
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

// Fetch the 3D models on first run so the Tiny World scene isn't a placeholder.
if (!fs.existsSync(path.join(ROOT, 'assets', 'models', 'LittlestTokyo.glb'))) {
  console.log('[assets] 3D models not found; running scripts/fetch-assets.mjs …');
  spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'fetch-assets.mjs')], { stdio: 'inherit' });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=8080 node server.js`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '127.0.0.1' ? 'localhost' : HOST;
  console.log(`\n  Peekaboo is running at  http://${shown}:${PORT}\n`);
});
