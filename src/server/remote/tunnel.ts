import { spawn, type ChildProcess } from 'node:child_process';

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 30_000;

export class TunnelError extends Error {
  constructor(
    message: string,
    readonly missingBinary = false,
  ) {
    super(message);
  }
}

export interface Tunnel {
  url: string;
  stop(): void;
  /** Called if the tunnel process exits on its own. */
  onExit(fn: () => void): void;
}

export type StartTunnel = (port: number) => Promise<Tunnel>;

/** A Cloudflare quick tunnel (`cloudflared tunnel --url …`) to the local server. No account needed. */
export const startCloudflared: StartTunnel = (port) =>
  new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return reject(new TunnelError((err as Error).message));
    }
    let done = false;
    const exitHandlers: (() => void)[] = [];
    const finish = (v: Tunnel | Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (v instanceof Error) {
        child.kill();
        reject(v);
      } else resolve(v);
    };
    const timer = setTimeout(() => finish(new TunnelError('cloudflared did not report a URL within 30 seconds.')), START_TIMEOUT_MS);
    const scan = (chunk: Buffer) => {
      const m = URL_RE.exec(chunk.toString());
      if (m) finish({ url: m[0], stop: () => child.kill(), onExit: (fn) => exitHandlers.push(fn) });
    };
    child.stdout?.on('data', scan);
    child.stderr?.on('data', scan);
    child.on('error', (err: NodeJS.ErrnoException) =>
      finish(err.code === 'ENOENT' ? new TunnelError('cloudflared is not installed.', true) : new TunnelError(err.message)),
    );
    child.on('exit', (code) => {
      if (!done) finish(new TunnelError(`cloudflared exited (${code ?? 'signal'}).`));
      else for (const fn of exitHandlers) fn();
    });
  });
