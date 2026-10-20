import { BotStatus, ProviderId } from '../../../shared/enums.js';
import type { ModelOption } from '../../../shared/types/index.js';
import { ProviderUnavailableError, type Provider, type ProviderDeps, type RunRequest, type RunResult } from '../provider.js';
import { aliasTool, classifyFailure, RunEvents, systemText, type RunUsage } from '../shared/run-events.js';

/** Loaded lazily: `@openai/codex-sdk` is an optional dependency. A variable keeps bundlers from inlining it. */
const SDK = '@openai/codex-sdk';

// The subset of the Codex SDK AgentRoom uses (see @openai/codex-sdk dist/index.d.ts).
type CodexItem =
  | { id: string; type: 'agent_message'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'command_execution'; command: string; aggregated_output: string; exit_code?: number; status: string }
  | { id: string; type: 'file_change'; changes: { path: string; kind: string }[]; status: string }
  | { id: string; type: 'mcp_tool_call'; server: string; tool: string; arguments: unknown; result?: { content: { type: string; text?: string }[] }; error?: { message: string }; status: string }
  | { id: string; type: 'web_search'; query: string }
  | { id: string; type: 'todo_list'; items: { text: string; completed: boolean }[] }
  | { id: string; type: 'error'; message: string };
type CodexUsage = { input_tokens: number; cached_input_tokens: number; cache_write_input_tokens?: number; output_tokens: number };
export type CodexEvent =
  | { type: 'thread.started'; thread_id: string }
  | { type: 'turn.started' }
  | { type: 'turn.completed'; usage: CodexUsage }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'item.started' | 'item.updated' | 'item.completed'; item: CodexItem }
  | { type: 'error'; message: string };
interface CodexThread {
  readonly id: string | null;
  runStreamed(input: string, opts?: { signal?: AbortSignal }): Promise<{ events: AsyncGenerator<CodexEvent> }>;
}
interface CodexClient {
  startThread(opts?: Record<string, unknown>): CodexThread;
  resumeThread(id: string, opts?: Record<string, unknown>): CodexThread;
}
export type CodexFactory = (opts: { config?: Record<string, unknown>; apiKey?: string }) => Promise<CodexClient>;

const defaultFactory: CodexFactory = async (opts) => {
  let mod: { Codex: new (o: unknown) => CodexClient };
  try {
    mod = (await import(SDK)) as typeof mod;
  } catch {
    throw new ProviderUnavailableError('Codex is not installed. Run: npm install -g @openai/codex-sdk (or add it next to AgentRoom).', 'not-installed');
  }
  return new mod.Codex(opts);
};

const EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/**
 * Runs bots on OpenAI Codex (`codex exec` under the hood, via @openai/codex-sdk). Experimental.
 * Codex runs its own agent loop, so AgentRoom can't approve single commands: writes and shell are
 * confined by Codex's sandbox to the goal's folder, with network off unless enabled in Settings.
 * AgentRoom's host tools are served to it over MCP (HostToolBridge).
 */
export class CodexProvider implements Provider {
  readonly id = ProviderId.Codex;

  constructor(
    private readonly deps: ProviderDeps,
    private readonly factory: CodexFactory = defaultFactory,
  ) {}

  async run(req: RunRequest): Promise<RunResult> {
    const settings = this.deps.engine().codex;
    const model = isCodexModel(req.model) ? req.model : '';
    const events = new RunEvents(req, this.id, model);
    const bridge = this.deps.bridge?.register(req.hostTools) ?? null;
    try {
      const mcp: Record<string, unknown> = { ...codexMcpServers(req.mcpServers) };
      if (bridge) mcp[bridge.name] = { url: bridge.url };
      const client = await this.factory({ config: Object.keys(mcp).length ? { mcp_servers: mcp } : {}, apiKey: this.deps.secret(this.id) });
      const threadOpts = {
        ...(model ? { model } : {}),
        workingDirectory: req.cwd,
        skipGitRepoCheck: true,
        sandboxMode: settings.sandbox,
        approvalPolicy: 'never',
        networkAccessEnabled: settings.network,
        ...(req.effort && EFFORTS.has(req.effort) ? { modelReasoningEffort: req.effort } : {}),
      };
      const thread = req.resumeSessionId ? client.resumeThread(req.resumeSessionId, threadOpts) : client.startThread(threadOpts);
      // Codex has no separate system prompt: the first turn of a thread carries the instructions.
      const input = req.resumeSessionId ? req.prompt : `${systemText(req)}\n\n---\n\n${req.prompt}`;
      events.status(BotStatus.Thinking);
      const { events: stream } = await thread.runStreamed(input, { signal: req.signal });
      return await consumeCodexEvents(stream, events, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, {
        inPerMtok: settings.priceInPerMtok,
        outPerMtok: settings.priceOutPerMtok,
      });
    } catch (err) {
      if (err instanceof ProviderUnavailableError) throw err;
      const message = (err as Error).message ?? String(err);
      const kind = classifyFailure(message);
      // Nothing happened yet: let the router try another provider.
      if (kind && events.toolCalls === 0 && kind !== 'auth') throw new ProviderUnavailableError(`Codex: ${message}`, kind);
      if (kind === 'auth' && events.toolCalls === 0) throw new ProviderUnavailableError('Codex is not signed in. Run `codex login` or add an OpenAI API key in Settings → Providers.', 'auth');
      throw err;
    } finally {
      bridge?.dispose();
    }
  }

  async listModels(): Promise<ModelOption[]> {
    return [];
  }
}

/** Codex model ids look like gpt-*, o*, codex-*; a Claude model id means "use Codex's own default". */
export const isCodexModel = (m: string | undefined): m is string => !!m && !/^claude|^(opus|sonnet|haiku|fable)\b/i.test(m);

/** Map Codex's JSONL events to AgentRoom events. Exported for tests. */
export async function consumeCodexEvents(stream: AsyncIterable<CodexEvent>, events: RunEvents, usage: RunUsage, prices: { inPerMtok: number; outPerMtok: number }): Promise<RunResult> {
  let final = '';
  let failure: string | undefined;
  const started = new Set<string>();
  for await (const ev of stream) {
    switch (ev.type) {
      case 'thread.started':
        events.sessionId = ev.thread_id;
        break;
      case 'turn.started':
        events.turn();
        break;
      case 'turn.completed':
        usage.input += ev.usage.input_tokens;
        usage.output += ev.usage.output_tokens;
        usage.cacheRead += ev.usage.cached_input_tokens;
        usage.cacheWrite += ev.usage.cache_write_input_tokens ?? 0;
        break;
      case 'turn.failed':
        failure = ev.error.message;
        break;
      case 'error':
        failure = ev.message;
        break;
      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const item = ev.item;
        const done = ev.type === 'item.completed';
        switch (item.type) {
          case 'agent_message':
            if (done) {
              final = item.text;
              events.message(item.text);
            }
            break;
          case 'reasoning':
            events.status(BotStatus.Thinking);
            break;
          case 'command_execution':
            if (!started.has(item.id)) {
              started.add(item.id);
              events.toolCall(item.id, aliasTool('shell'), { command: item.command });
            }
            if (done) events.toolResult(item.id, item.exit_code === 0 || item.status === 'completed', item.aggregated_output);
            break;
          case 'file_change':
            if (done) {
              events.toolCall(item.id, 'Edit', { file_path: item.changes.map((c) => c.path).join(', '), changes: item.changes });
              events.toolResult(item.id, item.status === 'completed', item.changes.map((c) => `${c.kind} ${c.path}`).join('\n'));
            }
            break;
          case 'mcp_tool_call':
            if (!started.has(item.id)) {
              started.add(item.id);
              events.toolCall(item.id, `mcp__${item.server}__${item.tool}`, (item.arguments ?? {}) as Record<string, unknown>);
            }
            if (done) {
              const out = item.error?.message ?? (item.result?.content ?? []).map((c) => c.text ?? '').join('\n');
              events.toolResult(item.id, !item.error && item.status === 'completed', out);
            }
            break;
          case 'web_search':
            if (!started.has(item.id)) {
              started.add(item.id);
              events.toolCall(item.id, 'WebSearch', { query: item.query });
            }
            if (done) events.toolResult(item.id, true, '');
            break;
          case 'error':
            if (done) events.message(`⚠ ${item.message}`);
            break;
        }
        break;
      }
    }
  }
  if (failure) {
    const kind = classifyFailure(failure);
    if (kind && kind !== 'auth' && events.toolCalls === 0) throw new ProviderUnavailableError(`Codex: ${failure}`, kind);
    return events.finish(false, `Run failed: ${failure}`, usage, prices);
  }
  return events.finish(true, final || undefined, usage, prices);
}

/** External MCP servers (Claude Code's .mcp.json shape) → Codex `mcp_servers` config. SSE and claude.ai proxies are skipped. */
export function codexMcpServers(servers: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(servers ?? {})) {
    const s = raw as { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string> };
    if (s.command && (!s.type || s.type === 'stdio')) out[name] = { command: s.command, ...(s.args ? { args: s.args } : {}), ...(s.env ? { env: s.env } : {}) };
    else if (s.url && s.type === 'http') out[name] = { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) };
  }
  return out;
}
