import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import type { RunnerStatus } from '../../shared/types/index.js';

/**
 * Background mode: a macOS LaunchAgent that keeps `agentroom start --no-open` running for one repo,
 * so schedules fire while the AgentRoom tab (or terminal) is closed. Other platforms: not yet.
 */
export const BACKGROUND_SUPPORTED = process.platform === 'darwin';
export const UNSUPPORTED_MESSAGE = 'Background mode is macOS-only for now.';

export interface BackgroundOptions {
  root: string;
  port: number;
  provider: string;
  logFile: string;
  /** Path to this CLI (dist/cli.js). */
  cli?: string;
  node?: string;
}

/** One agent per repo: dev.agentroom.<repo>-<hash>. */
export function agentLabel(root: string): string {
  const id = createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 8);
  const name = path.basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'project';
  return `dev.agentroom.${name}-${id}`;
}

export const plistPath = (label: string) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The LaunchAgent plist (pure, for tests). */
export function buildPlist(o: Required<Pick<BackgroundOptions, 'root' | 'port' | 'provider' | 'logFile' | 'cli' | 'node'>> & { label: string; pathEnv: string }): string {
  const args = [o.node, o.cli, 'start', '--no-open', '--port', String(o.port), '--provider', o.provider];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(o.label)}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(o.root)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENTROOM_DAEMON</key><string>1</string>
    <key>PATH</key><string>${esc(o.pathEnv)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>StandardOutPath</key><string>${esc(o.logFile)}</string>
  <key>StandardErrorPath</key><string>${esc(o.logFile)}</string>
</dict>
</plist>
`;
}

function launchctl(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('launchctl', args, { timeout: 15_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : 1) : 0, out: `${stdout}${stderr}` }),
    );
  });
}

const domain = () => `gui/${process.getuid?.() ?? 501}`;

export async function backgroundStatus(o: Pick<BackgroundOptions, 'root' | 'port' | 'logFile'>): Promise<RunnerStatus> {
  const label = agentLabel(o.root);
  const base = { platform: process.platform, supported: BACKGROUND_SUPPORTED, label, logFile: o.logFile, port: o.port, isDaemon: process.env.AGENTROOM_DAEMON === '1' };
  if (!BACKGROUND_SUPPORTED) return { ...base, installed: false, running: false };
  const installed = fs.existsSync(plistPath(label));
  const running = installed ? (await launchctl(['print', `${domain()}/${label}`])).out.includes('state = running') : false;
  return { ...base, installed, running };
}

export async function installBackground(o: BackgroundOptions): Promise<RunnerStatus> {
  if (!BACKGROUND_SUPPORTED) throw new Error(UNSUPPORTED_MESSAGE);
  const label = agentLabel(o.root);
  const file = plistPath(label);
  const cli = o.cli ?? fs.realpathSync(process.argv[1] ?? '');
  if (!cli || !fs.existsSync(cli)) throw new Error("Couldn't find the agentroom CLI to run in the background.");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(path.dirname(o.logFile), { recursive: true });
  fs.writeFileSync(
    file,
    buildPlist({ ...o, cli, node: o.node ?? process.execPath, label, pathEnv: process.env.PATH ?? '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' }),
  );
  // Replace a previous registration, then load.
  await launchctl(['bootout', `${domain()}/${label}`]);
  const r = await launchctl(['bootstrap', domain(), file]);
  if (r.code !== 0) {
    const legacy = await launchctl(['load', '-w', file]);
    if (legacy.code !== 0) throw new Error(`launchctl couldn't load the agent: ${(r.out || legacy.out).trim().slice(0, 300)}`);
  }
  return backgroundStatus(o);
}

export async function uninstallBackground(o: Pick<BackgroundOptions, 'root' | 'port' | 'logFile'>): Promise<RunnerStatus> {
  if (!BACKGROUND_SUPPORTED) throw new Error(UNSUPPORTED_MESSAGE);
  const label = agentLabel(o.root);
  const file = plistPath(label);
  const r = await launchctl(['bootout', `${domain()}/${label}`]);
  if (r.code !== 0 && fs.existsSync(file)) await launchctl(['unload', '-w', file]);
  if (fs.existsSync(file)) fs.rmSync(file);
  return backgroundStatus(o);
}

// ---------- session reuse ----------

export interface SessionInfo {
  port: number;
  token: string;
  url: string;
  pid: number;
  startedAt: string;
}

export function writeSession(file: string, info: SessionInfo) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(info, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function readSession(file: string): SessionInfo | null {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8')) as SessionInfo;
    return typeof s.port === 'number' && typeof s.token === 'string' && typeof s.url === 'string' ? s : null;
  } catch {
    return null;
  }
}

/** Remove the session file only if it still describes this process. */
export function clearSession(file: string, pid = process.pid) {
  const s = readSession(file);
  if (s && s.pid === pid) fs.rmSync(file, { force: true });
}

/**
 * The server already running for this repo (e.g. background mode), if it answers with its token.
 * `agentroom start` then opens it instead of failing on a busy port.
 */
export async function liveSession(file: string, check: (s: SessionInfo) => Promise<boolean> = pingSession): Promise<SessionInfo | null> {
  const s = readSession(file);
  if (!s) return null;
  return (await check(s).catch(() => false)) ? s : null;
}

async function pingSession(s: SessionInfo): Promise<boolean> {
  const res = await fetch(`http://127.0.0.1:${s.port}/api/info`, { headers: { 'x-agentroom-token': s.token }, signal: AbortSignal.timeout(2000) });
  return res.ok;
}
