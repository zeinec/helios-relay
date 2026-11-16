// HELIOS RELAY — tiny static dev server for local play-testing.
// Serves ./game on http://127.0.0.1:8080 (override with --port N).
// Node standard library only; refuses paths escaping the game directory.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const gameDir = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const portArg = process.argv.indexOf('--port');
const parsedPort = portArg >= 0 ? Number.parseInt(process.argv[portArg + 1], 10) : NaN;
// Reject out-of-range / non-numeric ports instead of silently serving on 8080.
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 8080;

const server = createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400, { 'cache-control': 'no-store' });
    res.end('bad url');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  const file = resolve(join(gameDir, pathname));
  if (!file.startsWith(gameDir + '/') && file !== gameDir) {
    res.writeHead(403, { 'cache-control': 'no-store' });
    res.end('forbidden');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'cache-control': 'no-store' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`HELIOS RELAY dev server: http://127.0.0.1:${port}`);
});
