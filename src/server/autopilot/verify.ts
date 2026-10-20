import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as gg from '../git/goal-git.js';

/**
 * Test commands AgentRoom runs on its own (no approval) to check a reported failing test.
 * Only well-known test runners, split into arguments and run without a shell, so a bot can't
 * smuggle another command in.
 */
const RUNNERS: RegExp[] = [
  /^(npx|bunx|pnpm exec|yarn exec) (vitest|jest|mocha|ava|tap|playwright test|cypress run)\b/,
  /^(npx|bunx) (--yes )?(vitest|jest|mocha)\b/,
  /^(npm|pnpm|yarn|bun) (run )?(test|test:[\w:-]+)\b/,
  /^(npm|pnpm|yarn) test\b/,
  /^bun test\b/,
  /^node --test\b/,
  /^(python3? -m )?pytest\b/,
  /^(uv|poetry) run pytest\b/,
  /^go test\b/,
  /^cargo test\b/,
  /^(dart|flutter) test\b/,
  /^(bundle exec )?rspec\b/,
  /^(vendor\/bin\/|\.\/vendor\/bin\/)?(phpunit|pest)\b/,
  /^(mvn|\.\/mvnw) (-q )?test\b/,
  /^(gradle|\.\/gradlew) test\b/,
  /^swift test\b/,
  /^dotnet test\b/,
  /^mix test\b/,
];

const SHELL_META = /[;&|`$<>(){}\\\n\r*?!~]/;

/** Split a vetted test command into argv, or explain why it can't be run unattended. */
export function parseTestCommand(command: string): { argv: string[] } | { error: string } {
  const c = command.trim().replace(/\s+/g, ' ');
  if (!c) return { error: 'No test command.' };
  if (c.length > 300) return { error: 'The test command is too long.' };
  if (SHELL_META.test(c)) return { error: 'The test command may only be a test runner with arguments (no ; | & $ > or quotes).' };
  if (/["']/.test(c)) return { error: 'The test command may only be a test runner with arguments (no ; | & $ > or quotes).' };
  if (!RUNNERS.some((r) => r.test(c))) return { error: `"${c.split(' ').slice(0, 3).join(' ')}" isn't a known test runner, so AgentRoom won't run it on its own.` };
  const argv = c.split(' ');
  // No absolute paths or parent escapes in arguments.
  if (argv.some((a) => a.startsWith('/') || a.split('/').includes('..'))) return { error: 'Test arguments must be paths inside the project.' };
  return { argv };
}

/** A repo-relative test file path inside `root`, or an error. */
export function safeTestFile(root: string, file: string): { rel: string } | { error: string } {
  const rel = file.trim().replace(/^\.\//, '');
  if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return { error: 'The test file must be a path inside the project.' };
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep)) return { error: 'The test file must be a path inside the project.' };
  if (!fs.existsSync(abs)) return { error: `${rel} doesn't exist on the fix branch.` };
  return { rel };
}

export interface RunResult {
  /** Exit code, or null when it timed out / couldn't start. */
  code: number | null;
  tail: string;
}

export async function runTest(argv: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, shell: false, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: null, tail: (err as Error).message });
      return;
    }
    const lines: string[] = [];
    const keep = (b: Buffer) => {
      lines.push(...b.toString().split('\n').filter((l) => l.trim()));
      if (lines.length > 40) lines.splice(0, lines.length - 40);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', (err) => lines.push(err.message));
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: timedOut ? null : code, tail: (timedOut ? ['Timed out.', ...lines] : lines).slice(-8).join('\n').slice(0, 1200) });
    });
  });
}

export interface FailPassInput {
  root: string;
  /** The goal's folder (the fix). */
  head: string;
  /** Commit the goal started from. */
  baseRef: string;
  test: { file: string; command: string };
  /** Where the throwaway checkout of the starting commit goes. */
  scratchDir: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected in tests. */
  run?: typeof runTest;
}

export interface FailPass {
  failsOnBase: boolean | null;
  passesOnHead: boolean | null;
  detail: string;
}

/**
 * Proof the test catches the bug: copy the test file onto a checkout of the starting commit and run
 * it there (it must fail), then run it on the fix (it must pass).
 */
export async function verifyFailPass(input: FailPassInput): Promise<FailPass> {
  const cmd = parseTestCommand(input.test.command);
  if ('error' in cmd) return { failsOnBase: null, passesOnHead: null, detail: cmd.error };
  const file = safeTestFile(input.head, input.test.file);
  if ('error' in file) return { failsOnBase: null, passesOnHead: null, detail: file.error };
  const run = input.run ?? runTest;
  const timeout = input.timeoutMs ?? 5 * 60_000;

  const headRun = await run(cmd.argv, input.head, timeout, input.signal);
  const passesOnHead = headRun.code === null ? null : headRun.code === 0;

  let failsOnBase: boolean | null = null;
  let baseTail = '';
  const dir = input.scratchDir;
  try {
    await gg.createDetachedWorktree(input.root, dir, input.baseRef);
    const target = path.join(dir, file.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(input.head, file.rel), target);
    const baseRun = await run(cmd.argv, dir, timeout, input.signal);
    failsOnBase = baseRun.code === null ? null : baseRun.code !== 0;
    baseTail = baseRun.tail;
  } catch (err) {
    baseTail = (err as Error).message.split('\n')[0] ?? '';
  } finally {
    await gg.removeWorktree(input.root, dir).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
  }

  const word = (b: boolean | null, yes: string, no: string) => (b === null ? "couldn't run" : b ? yes : no);
  const detail = [
    `Starting commit: ${word(failsOnBase, 'fails', 'passes')}${failsOnBase === false ? ' (the test does not catch the bug)' : ''}`,
    `Fix: ${word(passesOnHead, 'passes', 'fails')}`,
    passesOnHead === false && headRun.tail ? `\nOn the fix:\n${headRun.tail}` : '',
    failsOnBase === null && baseTail ? `\nStarting commit: ${baseTail}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return { failsOnBase, passesOnHead, detail };
}
