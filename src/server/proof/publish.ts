import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

export const PROOF_BRANCH = 'agentroom/proof';

interface Out {
  stdout: string;
  code: number;
  stderr: string;
}

function gitIn(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string): Promise<Out> {
  return new Promise((resolve) => {
    const child = execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      const raw = (err as { code?: unknown } | null)?.code;
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: !err ? 0 : typeof raw === 'number' ? raw : 1 });
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

async function must(cwd: string, args: string[], env?: NodeJS.ProcessEnv, input?: string): Promise<string> {
  const out = await gitIn(cwd, args, env, input);
  if (out.code !== 0) throw new Error((out.stderr || out.stdout).trim().split('\n').slice(-2).join(' ') || `git ${args[0]} failed`);
  return out.stdout.trim();
}

/**
 * Put the files under `<folder>/` on the proof branch and push it, without touching any working copy:
 * blobs and a tree are written with plumbing into a temporary index on top of the branch's current tip
 * (from origin when it exists), so other goals' proof stays. Returns the commit sha.
 */
export async function publishProof(repo: string, folder: string, files: { name: string; path: string }[], message: string, opts: { push?: boolean; remote?: string } = {}): Promise<string> {
  const remote = opts.remote ?? 'origin';
  const push = opts.push ?? true;
  if (!/^[A-Za-z0-9._-]+$/.test(folder)) throw new Error(`bad proof folder "${folder}"`);
  let parent: string | null = null;
  if (push) {
    const fetched = await gitIn(repo, ['fetch', '--quiet', remote, `+refs/heads/${PROOF_BRANCH}:refs/remotes/${remote}/${PROOF_BRANCH}`]);
    if (fetched.code === 0) parent = (await gitIn(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}/${PROOF_BRANCH}`])).stdout.trim() || null;
  }
  parent ??= (await gitIn(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${PROOF_BRANCH}`])).stdout.trim() || null;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-proof-'));
  const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
  try {
    if (parent) await must(repo, ['read-tree', parent], env);
    else await must(repo, ['read-tree', '--empty'], env);
    // Replace this goal's folder entirely (a re-run shouldn't leave stale frames).
    await gitIn(repo, ['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', `${folder}/`], env);
    for (const f of files) {
      if (!/^[A-Za-z0-9._-]+$/.test(f.name)) continue;
      const blob = await must(repo, ['hash-object', '-w', f.path]);
      await must(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${folder}/${f.name}`], env);
    }
    if (!parent) {
      const readme = await must(repo, ['hash-object', '-w', '--stdin'], undefined, '# AgentRoom proof\n\nScreenshots and recordings that AgentRoom attaches to pull requests. Safe to delete.\n');
      await must(repo, ['update-index', '--add', '--cacheinfo', `100644,${readme},README.md`], env);
    }
    const tree = await must(repo, ['write-tree'], env);
    const commit = await must(repo, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'AgentRoom',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'agentroom@localhost',
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'AgentRoom',
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'agentroom@localhost',
    });
    await must(repo, ['update-ref', `refs/heads/${PROOF_BRANCH}`, commit]);
    if (push) await must(repo, ['push', '--quiet', remote, `${commit}:refs/heads/${PROOF_BRANCH}`]);
    return commit;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** URL GitHub serves a file from a commit at (works in PR bodies, including private repos for members). */
export function rawUrl(ownerRepo: string, sha: string, file: string): string {
  return `https://github.com/${ownerRepo}/blob/${sha}/${file.split('/').map(encodeURIComponent).join('/')}?raw=true`;
}
