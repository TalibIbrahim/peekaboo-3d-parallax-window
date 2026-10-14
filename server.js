import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'application/json',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse path
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);
  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const safePath = path.normalize(path.join(__dirname, pathname));
  if (!safePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`404 Not Found: ${pathname}`);
      console.log(`[404] ${req.method} ${pathname}`);
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size
    });

    const stream = fs.createReadStream(safePath);
    stream.pipe(res);
    console.log(`[200] ${req.method} ${pathname} (${stats.size} bytes)`);
  });
});

async function ensureAssets() {
  const tokyoPath = path.join(__dirname, 'assets', 'models', 'LittlestTokyo.glb');
  if (!fs.existsSync(tokyoPath)) {
    console.log('[Assets] 3D models not found. Automatically running scripts/fetch-assets.mjs...');
    try {
      const { spawnSync } = await import('child_process');
      spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'fetch-assets.mjs')], { stdio: 'inherit' });
    } catch (e) {
      console.warn('[Assets] Automatic asset fetch failed:', e.message);
    }
  }
}

ensureAssets().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n=================================================`);
    console.log(` Peekaboo 3D Living Window running on port ${PORT}`);
    console.log(` -> http://localhost:${PORT}`);
    console.log(` -> http://127.0.0.1:${PORT}`);
    console.log(`=================================================\n`);
  });
});
