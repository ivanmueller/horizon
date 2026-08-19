/* Minimal static file server for the Playwright booking test.
   No dependencies on purpose — the site itself has none, and the test
   should not be the reason a build tool arrives. Resolves directory
   requests to index.html the way Cloudflare Pages does. */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8788);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
};

createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Block traversal outside the repo.
    let filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

    let s = await stat(filePath).catch(() => null);
    if (s && s.isDirectory()) { filePath = join(filePath, 'index.html'); s = await stat(filePath).catch(() => null); }
    if (!s) { res.writeHead(404).end('not found'); return; }

    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
}).listen(PORT, () => console.log(`static server on http://localhost:${PORT}`));
