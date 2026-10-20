import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { BotStatus, ProviderId } from '../../../shared/enums.js';
import type { ModelOption } from '../../../shared/types/index.js';
import { ProviderUnavailableError, type Provider, type ProviderDeps, type RunRequest, type RunResult } from '../provider.js';
import { aliasTool, classifyFailure, RunEvents, systemText, type Prices, type RunUsage } from '../shared/run-events.js';

/** One line of `gemini --output-format stream-json` (gemini-cli 0.6x). */
export type GeminiEvent =
  | { type: 'init'; session_id?: string; model?: string }
  | { type: 'message'; role: 'user' | 'assistant'; content: string; delta?: boolean }
  | { type: 'tool_use'; tool_name: string; tool_id: string; parameters?: Record<string, unknown> }
  | { type: 'tool_result'; tool_id: string; status: 'success' | 'error'; output?: string; error?: { message?: string } }
  | { type: 'error'; message?: string; severity?: string }
  | {
      type: 'result';
      status: 'success' | 'error';
      error?: { type?: string; message?: string };
      stats?: { input_tokens?: number; output_tokens?: number; cached?: number; tool_calls?: number };
    };

/** Spawns the CLI; replaceable in tests. Returns the process's stdout lines, stderr text and exit code. */
export type GeminiSpawner = (args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; signal: AbortSignal }) => {
  lines: AsyncIterable<string>;
  done: Promise<{ code: number | null; stderr: string }>;
};

const defaultSpawner: GeminiSpawner = (args, opts) => {
  const child = spawn('gemini', args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'], signal: opts.signal });
  let stderr = '';
  child.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const done = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('error', (err) => resolve({ code: -1, stderr: `${stderr}\n${err.message}` }));
    child.on('close', (code) => resolve({ code, stderr }));
  });
  return { lines: readline.createInterface({ input: child.stdout }), done };
};

/**
 * Runs bots on Google's Gemini CLI in headless mode (`gemini -p … --output-format stream-json`). Experimental.
 * Approvals follow Gemini's approval mode (headless: tools that need approval are refused unless
 * auto_edit / yolo allows them) and its sandbox. Host tools come over MCP through a per-run system
 * settings file (GEMINI_CLI_SYSTEM_SETTINGS_PATH), limited to AgentRoom's servers.
 */
export class GeminiProvider implements Provider {
  readonly id = ProviderId.Gemini;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly spawner: GeminiSpawner = defaultSpawner,
  ) {}

  async run(req: RunRequest): Promise<RunResult> {
    const settings = this.deps.engine().gemini;
    const model = isGeminiModel(req.model) ? req.model : '';
    const events = new RunEvents(req, this.id, model);
    const bridge = this.deps.bridge?.register(req.hostTools) ?? null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-gemini-'));
    try {
      const servers: Record<string, unknown> = { ...geminiMcpServers(req.mcpServers) };
      if (bridge) servers[bridge.name] = { httpUrl: bridge.url, trust: true, description: 'AgentRoom: tasks, delegation, questions to the human' };
      const settingsFile = path.join(tmp, 'settings.json');
      fs.writeFileSync(settingsFile, JSON.stringify({ mcpServers: servers }), { mode: 0o600 });
      const args = geminiArgs({
        prompt: `${systemText(req)}\n\n---\n\n${req.prompt}`,
        model,
        approvalMode: settings.approvalMode,
        sandbox: settings.sandbox,
        servers: Object.keys(servers),
      });
      const key = this.deps.secret(this.id);
      const env = { ...process.env, GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsFile, ...(key ? { GEMINI_API_KEY: key } : {}) };
      events.status(BotStatus.Thinking);
      const proc = this.spawner(args, { cwd: req.cwd, env, signal: req.signal });
      const result = await consumeGeminiEvents(parseLines(proc.lines), events, { inPerMtok: settings.priceInPerMtok, outPerMtok: settings.priceOutPerMtok });
      const { code, stderr } = await proc.done;
      if (result) return result;
      const message = stderr.trim().split('\n').slice(-3).join(' ') || `gemini exited with code ${code}`;
      const kind = code === -1 && /enoent/i.test(stderr) ? 'not-installed' : classifyFailure(message);
      if (kind && events.toolCalls === 0) {
        throw new ProviderUnavailableError(
          kind === 'not-installed' ? 'Gemini CLI is not installed. Run: npm install -g @google/gemini-cli' : kind === 'auth' ? 'Gemini CLI is not signed in. Run `gemini` once to sign in, or add a Gemini API key in Settings → Providers.' : `Gemini: ${message}`,
          kind,
        );
      }
      return events.finish(false, `Run failed: ${message}`, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    } finally {
      bridge?.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  async listModels(): Promise<ModelOption[]> {
    return [];
  }
}

export const isGeminiModel = (m: string | undefined): m is string => !!m && /^gemini|^gemma|^learnlm/i.test(m);

export function geminiArgs(o: { prompt: string; model: string; approvalMode: string; sandbox: boolean; servers: string[] }): string[] {
  return [
    '--prompt',
    o.prompt,
    '--output-format',
    'stream-json',
    '--approval-mode',
    o.approvalMode,
    ...(o.model ? ['--model', o.model] : []),
    ...(o.sandbox ? ['--sandbox'] : []),
    // Only AgentRoom's servers, never everything set up in the user's Gemini settings.
    ...(o.servers.length ? ['--allowed-mcp-server-names', ...o.servers] : []),
  ];
}

async function* parseLines(lines: AsyncIterable<string>): AsyncGenerator<GeminiEvent> {
  for await (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      yield JSON.parse(t) as GeminiEvent;
    } catch {
      // a torn or non-JSON line (warnings): skip
    }
  }
}

/** Map stream-json events to AgentRoom events. Returns null when the stream ended without a result line. Exported for tests. */
export async function consumeGeminiEvents(stream: AsyncIterable<GeminiEvent>, events: RunEvents, prices: Prices): Promise<RunResult | null> {
  let text = '';
  let final = '';
  const flush = () => {
    if (text.trim()) {
      events.message(text);
      final = text;
    }
    text = '';
  };
  for await (const ev of stream) {
    switch (ev.type) {
      case 'init':
        if (ev.session_id) events.sessionId = ev.session_id;
        events.turn();
        break;
      case 'message':
        if (ev.role !== 'assistant') break;
        text = ev.delta ? text + ev.content : ev.content;
        break;
      case 'tool_use':
        flush();
        events.toolCall(ev.tool_id, aliasTool(ev.tool_name), ev.parameters ?? {});
        break;
      case 'tool_result':
        events.toolResult(ev.tool_id, ev.status === 'success', ev.output ?? ev.error?.message ?? '');
        events.turn();
        break;
      case 'error':
        if (ev.message) events.message(`⚠ ${ev.message}`);
        break;
      case 'result': {
        flush();
        const usage: RunUsage = { input: ev.stats?.input_tokens ?? 0, output: ev.stats?.output_tokens ?? 0, cacheRead: ev.stats?.cached ?? 0, cacheWrite: 0 };
        if (ev.status === 'success') return events.finish(true, final || undefined, usage, prices);
        const message = ev.error?.message ?? 'Gemini run failed';
        const kind = classifyFailure(message);
        if (kind && kind !== 'auth' && events.toolCalls === 0) throw new ProviderUnavailableError(`Gemini: ${message}`, kind);
        return events.finish(false, `Run failed: ${message}`, usage, prices);
      }
    }
  }
  flush();
  return null;
}

/** External MCP servers → Gemini settings `mcpServers`. */
export function geminiMcpServers(servers: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(servers ?? {})) {
    const s = raw as { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
    if (s.command && (!s.type || s.type === 'stdio')) out[name] = { command: s.command, ...(s.args ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) };
    else if (s.url && s.type === 'http') out[name] = { httpUrl: s.url, ...(s.headers ? { headers: s.headers } : {}) };
    else if (s.url && s.type === 'sse') out[name] = { url: s.url, ...(s.headers ? { headers: s.headers } : {}) };
  }
  return out;
}
