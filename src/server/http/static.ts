import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Hono } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** Find the built UI (`dist/ui`) from either dist/cli.js or src/. */
export function findUiDir(): string | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    for (const candidate of [path.join(dir, 'ui'), path.join(dir, 'dist', 'ui')]) {
      if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/** Serve the static UI, falling back to index.html. Paths can't escape the UI folder. */
export function serveUi(app: Hono, uiDir: string | null) {
  app.get('*', (c) => {
    if (!uiDir) return c.text('UI not built. Run `npm run build:web`.', 500);
    const rel = decodeURIComponent(new URL(c.req.url).pathname).replace(/^\/+/, '');
    let file = path.resolve(uiDir, rel || 'index.html');
    if (!file.startsWith(uiDir + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(uiDir, 'index.html');
    return new Response(fs.readFileSync(file), { headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' } });
  });
}
