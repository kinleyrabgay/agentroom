import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from '../../shared/constants.js';
import type { ChangedFile, ChangedFileStatus } from '../../shared/types/index.js';
import { newFileDiff } from '../security/diff.js';

const MAX_BUFFER = 64 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
/** Per-file diff kept for the Changes tab. */
const FILE_DIFF_LIMIT = 80_000;
/** Untracked files larger than this aren't inlined. */
const UNTRACKED_LIMIT = 512 * 1024;
/** Folders whose node_modules are linked into a goal's folder (monorepo layouts). */
const NESTED_PARENTS = ['apps', 'packages', 'libs', 'services'];
const EXCLUDE_MARK = '# agentroom: dependency links inside goal folders';

export class GitError extends Error {}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a git (or gh) command without a shell. */
export function run(cmd: string, args: string[], cwd: string): Promise<Out> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      const raw = (err as { code?: unknown } | null)?.code;
      const code = !err ? 0 : typeof raw === 'number' ? raw : 1;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? (err ? err.message : '')), code });
    });
  });
}

async function git(cwd: string, args: string[]): Promise<string> {
  const out = await run('git', args, cwd);
  if (out.code !== 0) throw new GitError((out.stderr || out.stdout).trim().split('\n').slice(-3).join(' ') || `git ${args[0]} failed`);
  return out.stdout;
}

const tryGit = (cwd: string, args: string[]) => git(cwd, args).catch(() => null);

export async function isRepo(cwd: string): Promise<boolean> {
  return (await tryGit(cwd, ['rev-parse', '--is-inside-work-tree']))?.trim() === 'true';
}

export async function head(cwd: string): Promise<string | null> {
  return (await tryGit(cwd, ['rev-parse', 'HEAD']))?.trim() || null;
}

export const goalBranch = (goalId: string) => `agentroom/${goalId.toLowerCase()}`;

/**
 * Create the goal's own folder on its own branch, starting at `base`. Re-uses the branch if it exists.
 * Dependencies (node_modules) are linked in from the project so builds and tests run without installing.
 */
export async function createWorktree(root: string, dir: string, branch: string, base: string): Promise<void> {
  if (fs.existsSync(path.join(dir, '.git'))) return;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const exists = !!(await tryGit(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]));
  await git(root, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, base]);
  linkDependencies(root, dir);
  await excludeLinks(root, dir);
}

/**
 * A throwaway folder at `ref` with no branch (the "before" side of proof and quality checks).
 * Dependencies are linked in like a goal's folder. Remove it with removeWorktree.
 */
export async function createDetachedWorktree(root: string, dir: string, ref: string): Promise<void> {
  if (fs.existsSync(dir)) await removeWorktree(root, dir).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  await git(root, ['worktree', 'add', '--detach', dir, ref]);
  linkDependencies(root, dir);
  await excludeLinks(root, dir);
}

/** Relative paths of node_modules folders linked into the goal folder. */
function dependencyDirs(root: string): string[] {
  const out: string[] = [];
  if (fs.existsSync(path.join(root, 'node_modules'))) out.push('node_modules');
  for (const parent of NESTED_PARENTS) {
    const p = path.join(root, parent);
    if (!fs.existsSync(p)) continue;
    for (const name of safeReaddir(p)) {
      if (fs.existsSync(path.join(p, name, 'node_modules'))) out.push(path.join(parent, name, 'node_modules'));
    }
  }
  return out;
}

function linkDependencies(root: string, dir: string) {
  for (const rel of dependencyDirs(root)) {
    const target = path.join(dir, rel);
    if (fs.existsSync(target) || !fs.existsSync(path.dirname(target))) continue;
    try {
      fs.symlinkSync(path.join(root, rel), target, 'dir');
    } catch {
      // Not fatal: the bot can install dependencies itself.
    }
  }
}

/**
 * `node_modules/` in .gitignore doesn't match a symlink, so list the links in the repo's
 * info/exclude (shared by all worktrees) to keep them out of commits.
 */
async function excludeLinks(root: string, dir: string) {
  const common = (await tryGit(dir, ['rev-parse', '--git-common-dir']))?.trim();
  if (!common) return;
  const file = path.resolve(dir, common, 'info', 'exclude');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const wanted = dependencyDirs(root).map((rel) => `/${rel.split(path.sep).join('/')}`);
  const missing = wanted.filter((l) => !current.split('\n').includes(l));
  if (!missing.length) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = (current.includes(EXCLUDE_MARK) ? '' : `${current.endsWith('\n') || !current ? '' : '\n'}${EXCLUDE_MARK}\n`) + missing.join('\n') + '\n';
  fs.appendFileSync(file, block);
}

/** Commit everything in the folder (if anything changed). Returns the new commit, or null. */
export async function commitAll(cwd: string, message: string): Promise<string | null> {
  await git(cwd, ['add', '-A', '--', '.', `:(exclude)${PROJECT_DIR}`]);
  const staged = await run('git', ['diff', '--cached', '--quiet'], cwd);
  if (staged.code === 0) return null;
  await git(cwd, ['commit', '--no-verify', '-q', '-m', message]);
  return head(cwd);
}

/** Commits on the branch after `from` (oldest first). */
export async function commitsSince(cwd: string, from: string): Promise<string[]> {
  const out = await tryGit(cwd, ['rev-list', '--reverse', `${from}..HEAD`]);
  return (out ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Undo commits (newest first) with new revert commits. Returns the revert commits. */
export async function revertCommits(cwd: string, commits: string[]): Promise<string[]> {
  if (!commits.length) return [];
  const before = await head(cwd);
  const newestFirst = [...commits].reverse();
  const out = await run('git', ['revert', '--no-edit', ...newestFirst], cwd);
  if (out.code !== 0) {
    await run('git', ['revert', '--abort'], cwd);
    throw new GitError(`Couldn't revert cleanly (later changes touch the same lines): ${(out.stderr || out.stdout).trim().split('\n').slice(-1)[0]}`);
  }
  return before ? commitsSince(cwd, before) : [];
}

/** Files changed in the folder relative to `base`, including uncommitted and untracked files. */
export async function changedFiles(cwd: string, base: string): Promise<ChangedFile[]> {
  const uncommitted = new Set(
    ((await tryGit(cwd, ['diff', '--name-only', 'HEAD'])) ?? '').split('\n').filter(Boolean),
  );
  const status = new Map<string, ChangedFileStatus>();
  for (const line of ((await tryGit(cwd, ['diff', '--name-status', '--no-renames', base])) ?? '').split('\n')) {
    const [code, p] = line.split('\t');
    if (!code || !p) continue;
    status.set(p, code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified');
  }
  const counts = new Map<string, [number, number]>();
  for (const line of ((await tryGit(cwd, ['diff', '--numstat', '--no-renames', base])) ?? '').split('\n')) {
    const [add, del, ...rest] = line.split('\t');
    if (!rest.length) continue;
    counts.set(rest.join('\t'), [Number(add) || 0, Number(del) || 0]);
  }
  const files: ChangedFile[] = [];
  for (const [p, st] of status) {
    if (p.startsWith(`${PROJECT_DIR}/`)) continue;
    const diff = (await tryGit(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-renames', base, '--', p])) ?? '';
    const [additions, deletions] = counts.get(p) ?? [0, 0];
    files.push({ path: p, status: st, additions, deletions, ...bounded(diff), uncommitted: uncommitted.has(p) });
  }
  for (const rel of ((await tryGit(cwd, ['ls-files', '--others', '--exclude-standard'])) ?? '').split('\n').filter(Boolean)) {
    if (rel.startsWith(`${PROJECT_DIR}/`) || status.has(rel)) continue;
    try {
      const abs = path.join(cwd, rel);
      const stat = fs.lstatSync(abs);
      if (!stat.isFile() || stat.size > UNTRACKED_LIMIT) continue;
      const text = fs.readFileSync(abs, 'utf8');
      files.push({ path: rel, status: 'added', additions: text.split('\n').length, deletions: 0, ...bounded(newFileDiff(rel, text)), uncommitted: true });
    } catch {
      // unreadable: skip
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Files a commit touched. */
export async function filesOf(cwd: string, commit: string): Promise<string[]> {
  return ((await tryGit(cwd, ['show', '--name-only', '--format=', commit])) ?? '').split('\n').filter(Boolean);
}

/** Commits on the branch since `base` with their subjects (oldest first). */
export async function logSince(cwd: string, base: string): Promise<{ sha: string; subject: string }[]> {
  const out = (await tryGit(cwd, ['log', '--reverse', '--format=%H%x09%s', `${base}..HEAD`])) ?? '';
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [sha, ...rest] = l.split('\t');
      return { sha: sha!, subject: rest.join('\t') };
    });
}

function bounded(diff: string): { diff: string; truncated: boolean } {
  return diff.length > FILE_DIFF_LIMIT ? { diff: diff.slice(0, FILE_DIFF_LIMIT), truncated: true } : { diff, truncated: false };
}

/** Push the branch to origin (sets upstream). */
export async function push(cwd: string, branch: string): Promise<void> {
  await git(cwd, ['push', '-u', 'origin', branch]);
}

/** Open a pull request with the gh CLI. Returns its URL and number. */
export async function createPr(cwd: string, input: { title: string; body: string; head: string; draft?: boolean }): Promise<{ url: string; number?: number }> {
  const args = ['pr', 'create', '--title', input.title, '--body', input.body, '--head', input.head];
  if (input.draft) args.push('--draft');
  const out = await run('gh', args, cwd);
  if (out.code !== 0) throw new GitError((out.stderr || out.stdout).trim().split('\n').slice(-2).join(' ') || 'gh pr create failed');
  const url = out.stdout.trim().split('\n').reverse().find((l) => /^https?:\/\//.test(l.trim()))?.trim() ?? out.stdout.trim();
  const n = /\/pull\/(\d+)/.exec(url)?.[1];
  return { url, ...(n ? { number: Number(n) } : {}) };
}

/**
 * Merge the goal's branch into the branch checked out in the project root (`--no-ff`).
 * Refuses when the human has uncommitted changes there (AgentRoom's own files don't count).
 */
export async function mergeInto(root: string, branch: string, message: string): Promise<string> {
  const dirty = ((await tryGit(root, ['status', '--porcelain'])) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3))
    .filter((p) => !p.startsWith(`${PROJECT_DIR}/`) && !p.startsWith(`"${PROJECT_DIR}/`));
  if (dirty.length) throw new GitError(`Your working copy has uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? '…' : ''}). Commit or stash them first.`);
  const out = await run('git', ['merge', '--no-ff', '-m', message, branch], root);
  if (out.code !== 0) {
    await run('git', ['merge', '--abort'], root);
    throw new GitError(`Merge conflict; nothing was changed. Merge ${branch} by hand or open a PR instead.`);
  }
  return (await head(root)) ?? '';
}

/** Remove the goal's folder (the branch stays). */
export async function removeWorktree(root: string, dir: string): Promise<void> {
  if (!fs.existsSync(dir)) {
    await run('git', ['worktree', 'prune'], root);
    return;
  }
  await git(root, ['worktree', 'remove', '--force', dir]);
}

/** The branch checked out in a folder. */
export async function currentBranch(cwd: string): Promise<string | null> {
  return (await tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || null;
}

function safeReaddir(p: string): string[] {
  try {
    return fs.readdirSync(p).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}
