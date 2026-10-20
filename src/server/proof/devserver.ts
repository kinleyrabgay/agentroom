import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export interface AppCommand {
  /** Shell command line. */
  command: string;
  /** How the port is passed: env PORT always; plus a flag for frameworks that ignore it. */
  framework: 'next' | 'vite' | 'astro' | 'remix' | 'nuxt' | 'svelte' | 'cra' | 'other';
}

/** Which package manager the project uses (by lockfile). */
export function packageManager(dir: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** How to serve the app in `dir`: the configured command, else a `dev`/`start` script from package.json. Null = no web app. */
export function detectApp(dir: string, configured = ''): AppCommand | null {
  const pkgFile = path.join(dir, 'package.json');
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try {
    pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  } catch {
    if (!configured.trim()) return null;
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework: AppCommand['framework'] = deps.next
    ? 'next'
    : deps.astro
      ? 'astro'
      : deps['@remix-run/dev']
        ? 'remix'
        : deps.nuxt
          ? 'nuxt'
          : deps['@sveltejs/kit']
            ? 'svelte'
            : deps.vite
              ? 'vite'
              : deps['react-scripts']
                ? 'cra'
                : 'other';
  if (configured.trim()) return { command: configured.trim(), framework };
  const script = ['dev', 'start', 'serve'].find((s) => pkg.scripts?.[s]);
  if (!script) return null;
  // A "start" that runs a production server needs a build first; dev scripts are what we want.
  const pm = packageManager(dir);
  const run = pm === 'npm' ? `npm run ${script}` : pm === 'yarn' ? `yarn ${script}` : `${pm} run ${script}`;
  return { command: run, framework };
}

/** Extra CLI args that pin the port for frameworks that don't read $PORT. */
export function portArgs(framework: AppCommand['framework'], port: number, command: string): string {
  const sep = /^(npm|pnpm) run /.test(command) ? ' --' : '';
  switch (framework) {
    case 'next':
      return `${sep} -p ${port}`;
    case 'vite':
    case 'svelte':
    case 'astro':
      return `${sep} --port ${port} --strictPort --host 127.0.0.1`;
    case 'nuxt':
      return `${sep} --port ${port}`;
    default:
      return '';
  }
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export interface RunningApp {
  url: string;
  stop: () => Promise<void>;
  /** Last lines the server printed (for error messages). */
  log: () => string;
}

/** Start the app on a free port and wait until it answers HTTP. */
export async function startApp(cwd: string, app: AppCommand, opts: { timeoutSec: number; signal?: AbortSignal }): Promise<RunningApp> {
  const port = await freePort();
  const line = `${app.command}${portArgs(app.framework, port, app.command)}`;
  const child = spawn(line, {
    cwd,
    shell: true,
    detached: process.platform !== 'win32',
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none', NODE_ENV: 'development', CI: '1', FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tail: string[] = [];
  const keep = (b: Buffer) => {
    tail.push(...b.toString().split('\n').filter(Boolean));
    if (tail.length > 40) tail.splice(0, tail.length - 40);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  let exited: number | null = null;
  child.on('exit', (code) => (exited = code ?? -1));
  const stop = () => kill(child);
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + opts.timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) {
      await stop();
      throw new Error('Stopped.');
    }
    if (exited !== null) throw new Error(`\`${line}\` exited (code ${exited}).\n${tail.slice(-12).join('\n')}`);
    if (await answers(url)) return { url, stop, log: () => tail.join('\n') };
    await sleep(500);
  }
  await stop();
  throw new Error(`The app didn't answer on port ${port} within ${opts.timeoutSec}s (\`${line}\`).\n${tail.slice(-12).join('\n')}`);
}

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

function kill(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || !child.pid) return resolve();
    const done = setTimeout(() => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid!, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(done);
      resolve();
    });
    try {
      // The dev server spawns children (next, vite): end the whole process group.
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch {
      clearTimeout(done);
      resolve();
    }
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
