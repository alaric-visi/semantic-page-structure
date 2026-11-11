import { defineConfig, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleAnalyzeRequest } from './src/lib/api-handler';

function pageStructureApiPlugin(): Plugin {
  return {
    name: 'page-structure-api',
    configureServer(server) {
      server.middlewares.use(
        async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          const url = req.url?.split('?')[0] ?? '';
          if (
            url !== '/api/page-structure/analyze' &&
            url !== '/api/analyze'
          ) {
            return next();
          }

          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            const bodyBuf = Buffer.concat(chunks);

            const headers = new Headers();
            for (const [k, v] of Object.entries(req.headers)) {
              if (typeof v === 'string') headers.set(k, v);
              else if (Array.isArray(v)) headers.set(k, v.join(', '));
            }

            const webReq = new Request(`http://localhost${req.url}`, {
              method: req.method || 'GET',
              headers,
              body:
                req.method && !['GET', 'HEAD'].includes(req.method)
                  ? bodyBuf
                  : undefined,
            });

            const webRes = await handleAnalyzeRequest(webReq);
            res.statusCode = webRes.status;
            webRes.headers.forEach((val, key) => {
              res.setHeader(key, val);
            });
            const text = await webRes.text();
            res.end(text);
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(
              JSON.stringify({
                error:
                  err instanceof Error ? err.message : 'Internal server error',
              })
            );
          }
        }
      );
    },
  };
}

export default defineConfig({
  plugins: [pageStructureApiPlugin()],
  css: {
    postcss: {
      plugins: [],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
