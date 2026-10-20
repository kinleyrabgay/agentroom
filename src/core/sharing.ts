import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from '../shared/constants.js';

export type SharingMode = 'team' | 'private';

const MARK = '# agentroom (private)';
const LINE = `/${PROJECT_DIR}/`;

/**
 * Private mode keeps `.agentroom/` out of git for you only: it's listed in `.git/info/exclude`
 * (a local, never-committed ignore file), so teammates see nothing and `.gitignore` isn't touched.
 */
export function excludeFile(root: string): string | null {
  try {
    const rel = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return rel ? path.resolve(root, rel) : null;
  } catch {
    const dotGit = path.join(root, '.git');
    return fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory() ? path.join(dotGit, 'info', 'exclude') : null;
  }
}

export function sharingMode(root: string): SharingMode {
  const file = excludeFile(root);
  if (!file || !fs.existsSync(file)) return 'team';
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).some((l) => l.trim() === LINE) ? 'private' : 'team';
}

/** Add the exclude entry (idempotent). Returns false when this isn't a git repo. */
export function makePrivate(root: string): boolean {
  const file = excludeFile(root);
  if (!file) return false;
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (current.split(/\r?\n/).some((l) => l.trim() === LINE)) return true;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sep = current && !current.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(file, `${current}${sep}${MARK}\n${LINE}\n`);
  return true;
}

/** Remove the exclude entry and its marker (idempotent). */
export function removePrivate(root: string) {
  const file = excludeFile(root);
  if (!file || !fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const kept = lines.filter((l) => l.trim() !== LINE && l.trim() !== MARK);
  if (kept.length !== lines.length) fs.writeFileSync(file, kept.join('\n').replace(/\n*$/, '\n'));
}
