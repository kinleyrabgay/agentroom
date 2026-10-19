import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FILES_LIMIT_MAX } from '../config/constants.js';

const listGitFiles = (root: string): Promise<string[]> =>
  new Promise((resolve, reject) => {
    execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(new Error('Not a git repository, so files can\'t be listed.')) : resolve(stdout.split('\n').filter(Boolean)),
    );
  });

const isMarkdown = (f: string) => /\.(md|mdx|markdown)$/i.test(f);

/** Rank: markdown first, then path starts-with, then shorter paths. Pure, for tests. */
export function rankFiles(files: string[], query: string, limit: number): string[] {
  const q = query.trim().toLowerCase();
  const matches = q ? files.filter((f) => f.toLowerCase().includes(q)) : files;
  const score = (f: string) => {
    const lower = f.toLowerCase();
    const base = path.basename(lower);
    return (isMarkdown(f) ? 0 : 100) + (q && base.startsWith(q) ? 0 : q && lower.startsWith(q) ? 10 : 20) + Math.min(f.length, 99) / 100;
  };
  return [...matches].sort((a, b) => score(a) - score(b)).slice(0, Math.max(1, Math.min(limit, FILES_LIMIT_MAX)));
}

/** Repo files for `@` suggestions (tracked + untracked, respecting .gitignore). */
export async function searchRepoFiles(root: string, query: string, limit: number): Promise<string[]> {
  return rankFiles(await listGitFiles(root), query, limit);
}

/** Validate repo-relative paths: inside the repo, existing files. Throws on traversal. */
export function resolveRepoFiles(root: string, files: string[]): string[] {
  const base = path.resolve(root);
  return files.map((f) => {
    const rel = String(f).trim();
    const abs = path.resolve(base, rel);
    if (!rel || path.isAbsolute(rel) || (abs !== base && !abs.startsWith(base + path.sep))) throw new Error(`"${rel}" is outside the repository.`);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`"${rel}" doesn't exist in the repository.`);
    return path.relative(base, abs);
  });
}
