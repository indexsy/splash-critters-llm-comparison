// Serves the built client (Vite dist) with SPA fallback to index.html. Hashed assets are cached
// for a year; index.html is always revalidated so deploys take effect immediately.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type Express } from 'express';

const IMMUTABLE = 'public, max-age=31536000, immutable';
/** Paths the SPA fallback must never answer (API, socket, health). */
const RESERVED = /^\/(api|ws|health)(\/|$)/;
/** A missing file (e.g. a stale hashed asset) is a 404, never the HTML shell. */
const FILE_LIKE = /\.[a-z0-9]+$/i;

/** Mounts the client; returns false (and serves a plain 404 page) when the client is not built. */
export function mountClient(app: Express, clientDist: string): boolean {
  const indexHtml = join(clientDist, 'index.html');
  if (!existsSync(indexHtml)) {
    app.get(/.*/, (req, res, next) => {
      if (RESERVED.test(req.path)) return next();
      res.status(404).type('text/plain').send('Client not built. Run "npm run build" (or use the Vite dev server on :5173).');
    });
    return false;
  }
  const assetsDir = join(clientDist, 'assets');
  app.use(
    express.static(clientDist, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', filePath.startsWith(assetsDir) ? IMMUTABLE : 'no-cache');
      },
    }),
  );
  app.get(/.*/, (req, res, next) => {
    if (RESERVED.test(req.path)) return next();
    if (FILE_LIKE.test(req.path)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
  return true;
}
