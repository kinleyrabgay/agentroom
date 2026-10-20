import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Locate the package's templates/ dir whether running from dist/ (bundled) or src/. */
export function templatesDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'templates');
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('agentroom templates not found');
}

/** Copy a tree, skipping files that already exist. Returns the paths created. `skip`: top-level names to leave out. */
export function copyTreeIfMissing(src: string, dest: string, created: string[] = [], skip: string[] = []): string[] {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTreeIfMissing(s, d, created);
    else if (!fs.existsSync(d)) {
      fs.copyFileSync(s, d);
      created.push(d);
    }
  }
  return created;
}
