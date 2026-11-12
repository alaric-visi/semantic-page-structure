/**
 * Standalone production Node server for Semantic Page Structure.
 * Serves the built static assets from ./dist and handles POST /api/page-structure/analyze.
 *
 * Usage:
 *   npm run build
 *   npm start
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

register();

const { handleApiRequest } = await import('./src/lib/api-handler.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT || 8765);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];

  if (
    urlPath === '/api/page-structure/analyze' ||
    urlPath === '/api/analyze' ||
    urlPath === '/api/keywords/volume' ||
    urlPath === '/api/volume'
  ) {
    try {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const bodyBuf = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const webReq = new Request(`http://localhost:${PORT}${req.url}`, {
        method: req.method || 'GET',
        headers,
        body:
          req.method && !['GET', 'HEAD'].includes(req.method)
            ? bodyBuf
            : undefined,
      });
      const webRes = await handleApiRequest(webReq);
      res.statusCode = webRes.status;
      webRes.headers.forEach((val, key) => res.setHeader(key, val));
      res.end(await webRes.text());
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Internal server error',
        })
      );
    }
    return;
  }

  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(DIST_DIR)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.statusCode = 404;
    res.end('Not found. Run `npm run build` first.');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    MIME_TYPES[ext] || 'application/octet-stream'
  );
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Semantic Page Structure running at http://localhost:${PORT}`);
});
