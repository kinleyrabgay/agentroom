import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { Project } from '../src/core/project.js';
import { AgentEventType, GoalStatus, ProviderId, ToolName, WorkPhase } from '../src/shared/enums.js';
import type { AgentEvent, Bot, GoalOutcome, LedgerEntry, Settings } from '../src/shared/types/index.js';
import { SettingsSchema } from '../src/shared/schemas.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { Team } from '../src/server/agents/team.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import { ProviderUnavailableError, type Provider, type ProviderDeps, type RunRequest, type RunResult } from '../src/server/providers/provider.js';
import { ProviderPool } from '../src/server/providers/registry.js';
import { fallbackReason, planRoute } from '../src/server/providers/router.js';
import { HostToolBridge, toolJsonSchema } from '../src/server/providers/host-bridge.js';
import { classifyFailure, RunEvents } from '../src/server/providers/shared/run-events.js';
import { CodexProvider, consumeCodexEvents, codexMcpServers, type CodexEvent } from '../src/server/providers/codex/codex.provider.js';
import { consumeGeminiEvents, GeminiProvider, geminiArgs, type GeminiEvent } from '../src/server/providers/gemini/gemini.provider.js';
import { builtinTools, insideCwd, OpenAICompatProvider } from '../src/server/providers/openai-compat/openai-compat.provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { LedgerService } from '../src/server/services/ledger.service.js';
import { NotificationService } from '../src/server/services/notification.service.js';
import { fisherExact, median } from '../src/server/engine/stats.js';
import { applyVariant, experimentResult, ExperimentStore } from '../src/server/engine/experiments.js';
import { OutcomeTracker, outcomeLabel, type OutcomeProbe } from '../src/server/engine/outcomes.js';
import { estimateGoalCost, suggest } from '../src/server/engine/suggestions.js';
import { EngineService } from '../src/server/engine/engine.service.js';
import { SecretsStore } from '../src/server/services/secrets.store.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-engine-'));
const settings = (patch: Record<string, unknown> = {}): Settings => SettingsSchema.parse(patch);
const engineDeps = (s = settings()): ProviderDeps => ({ engine: () => s.engine, secret: () => undefined });

function project() {
  const root = tmp();
  const p = new Project(root);
  p.init();
  return p;
}

const fakeReq = (bot: Bot, events: AgentEvent[], extra: Partial<RunRequest> = {}): RunRequest => ({
  bot,
  prompt: 'do it',
  cwd: tmp(),
  model: '',
  skills: { libraryPluginDir: tmp(), botPluginDir: tmp() },
  context: '',
  hostTools: [],
  signal: new AbortController().signal,
  emit: (e) => events.push(e),
  stream: () => {},
  askPermission: async () => ({ allow: true }),
  ...extra,
});

describe('routing', () => {
  const bot = { id: 'dev', model: 'sonnet' } as Bot;
  const config = { provider: ProviderId.Claude, model: 'opus' } as const;

  it('defaults to the project provider with the bot model', () => {
    expect(planRoute({ bot, settings: settings(), config })).toEqual([{ provider: 'claude', model: 'sonnet' }]);
  });

  it('uses the phase provider, its fallbacks, then Claude as the last resort, without duplicates', () => {
    const s = settings({ models: { build: { provider: 'codex', model: 'gpt-5-codex', fallbacks: [{ provider: 'gemini' }, { provider: 'codex', model: 'gpt-5-codex' }] } } });
    expect(planRoute({ bot, phase: WorkPhase.Build, settings: s, config })).toEqual([
      { provider: 'codex', model: 'gpt-5-codex' },
      { provider: 'gemini', model: '' },
      { provider: 'claude', model: 'sonnet' },
    ]);
  });

  it('has no fallbacks when fallback is off', () => {
    const s = settings({ models: { build: { provider: 'codex' } }, engine: { fallback: { enabled: false } } });
    expect(planRoute({ bot, phase: WorkPhase.Build, settings: s, config }).map((a) => a.provider)).toEqual(['codex']);
  });

  it('falls back only before the run did anything, and only for reasons another provider would not share', () => {
    const f = settings().engine.fallback;
    const rate = new ProviderUnavailableError('429', 'rate-limit');
    expect(fallbackReason(rate, { progressed: false, aborted: false, settings: f })).toBe('rate-limit');
    expect(fallbackReason(rate, { progressed: true, aborted: false, settings: f })).toBeNull();
    expect(fallbackReason(rate, { progressed: false, aborted: true, settings: f })).toBeNull();
    expect(fallbackReason(new Error('Overloaded (529)'), { progressed: false, aborted: false, settings: f })).toBe('outage');
    expect(fallbackReason(new Error('syntax error in your code'), { progressed: false, aborted: false, settings: f })).toBeNull();
    expect(fallbackReason(new Error('boom'), { progressed: false, aborted: false, settings: { ...f, onError: true } })).toBe('error');
    expect(fallbackReason(rate, { progressed: false, aborted: false, settings: { ...f, onRateLimit: false } })).toBeNull();
    expect(classifyFailure('spawn gemini ENOENT')).toBe('not-installed');
    expect(classifyFailure('HTTP 401: invalid api key')).toBe('auth');
  });
});

/** A provider whose run is scripted per call. */
class Fake implements Provider {
  calls: RunRequest[] = [];
  constructor(
    readonly id: string,
    private readonly script: (req: RunRequest) => Promise<RunResult>,
  ) {}
  run(req: RunRequest) {
    this.calls.push(req);
    return this.script(req);
  }
  async listModels() {
    return [];
  }
}

function teamWith(p: Project, primary: Provider, others: Provider[]) {
  const hub = new Hub(p.paths.runs);
  const ledger = new LedgerService(p.paths.ledgerFile);
  const events: AgentEvent[] = [];
  hub.onEvent((e) => events.push(e));
  const team = new Team({
    project: p,
    hub,
    provider: primary,
    providers: new ProviderPool(primary, engineDeps(), others),
    previews: new PreviewService(hub),
    permissions: new PermissionGate(hub, () => p.config.get(), p.root),
    sessions: new SessionStore(p.paths.sessionsFile),
    notifications: new NotificationService(hub, p.paths.inboxFile),
    boardChanged: () => {},
    ledger,
  });
  return { team, ledger, events };
}

describe('Team fallback', () => {
  it('moves to the next provider when the first is rate-limited before doing anything', async () => {
    const p = project();
    p.settings.update({ models: { build: { provider: 'codex', model: 'gpt-5-codex' } } });
    const codex = new Fake(ProviderId.Codex, async () => {
      throw new ProviderUnavailableError('Codex: usage limit reached', 'rate-limit');
    });
    const claude = new Fake(ProviderId.Claude, async (req) => {
      req.emit({ type: AgentEventType.Usage, botId: req.bot.id, provider: 'claude', model: req.model, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, costUsd: 0.1, runs: 1 });
      return { ok: true, result: 'built it' };
    });
    const { team, ledger, events } = teamWith(p, claude, [codex]);
    const bot = p.bots.list()[0]!;
    const out = await team.dispatch(bot.id, 'build', 'human', { phase: WorkPhase.Build });
    expect(out).toMatchObject({ ok: true, text: 'built it' });
    expect(codex.calls[0]!.model).toBe('gpt-5-codex');
    expect(claude.calls).toHaveLength(1);
    const row = ledger.list()[0]!;
    expect(row).toMatchObject({ provider: 'claude', fellBackFrom: ['codex'], costUsd: 0.1 });
    expect(events.some((e) => e.type === AgentEventType.Message && /Codex is rate-limited/.test(e.text))).toBe(true);
  });

  it('never retries elsewhere after a tool call', async () => {
    const p = project();
    p.settings.update({ models: { build: { provider: 'codex' } } });
    const codex = new Fake(ProviderId.Codex, async (req) => {
      req.emit({ type: AgentEventType.ToolCall, botId: req.bot.id, toolUseId: 't', name: ToolName.Bash, summary: 'rm', input: {} });
      throw new ProviderUnavailableError('rate limited', 'rate-limit');
    });
    const claude = new Fake(ProviderId.Claude, async () => ({ ok: true, result: 'x' }));
    const { team, ledger } = teamWith(p, claude, [codex]);
    const out = await team.dispatch(p.bots.list()[0]!.id, 'build', 'human', { phase: WorkPhase.Build });
    expect(out.ok).toBe(false);
    expect(claude.calls).toHaveLength(0);
    expect(ledger.list()[0]).toMatchObject({ provider: 'codex', ok: false });
  });

  it('works unchanged with only Claude: a failed result is just a failure', async () => {
    const p = project();
    const claude = new Fake(ProviderId.Claude, async () => ({ ok: false, result: 'Run failed: error_during_execution' }));
    const { team, ledger } = teamWith(p, claude, []);
    const out = await team.dispatch(p.bots.list()[0]!.id, 'hi');
    expect(out.ok).toBe(false);
    expect(claude.calls).toHaveLength(1);
    expect(ledger.list()[0]!.provider).toBe('claude');
  });
});

describe('host tool bridge (MCP over HTTP)', () => {
  const tool = { name: 'task_create', description: 'Create a task', schema: { title: z.string(), priority: z.number().optional() }, handler: async (a: { title: string }) => `created ${a.title}` };

  it('serves initialize, tools/list and tools/call for a live run only', async () => {
    const bridge = new HostToolBridge(() => 'http://127.0.0.1:4317');
    const reg = bridge.register([tool])!;
    const token = reg.url.split('/').pop()!;
    expect(reg.url).toMatch(/^http:\/\/127\.0\.0\.1:4317\/__agentroom\/mcp\/[\w-]+$/);
    const init = await bridge.handle(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect((init!.json as { result: { protocolVersion: string } }).result.protocolVersion).toBe('2025-03-26');
    expect(await bridge.handle(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    const list = (await bridge.handle(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))!.json as { result: { tools: { name: string; inputSchema: { required: string[] } }[] } };
    expect(list.result.tools[0]).toMatchObject({ name: 'task_create', inputSchema: { required: ['title'] } });
    const call = (await bridge.handle(token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'task_create', arguments: { title: 'x' } } }))!.json as { result: { content: { text: string }[] } };
    expect(call.result.content[0]!.text).toBe('created x');
    const bad = (await bridge.handle(token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'task_create', arguments: {} } }))!.json as { result: { isError: boolean } };
    expect(bad.result.isError).toBe(true);
    reg.dispose();
    expect((await bridge.handle(token, { jsonrpc: '2.0', id: 5, method: 'tools/list' }))!.status).toBe(404);
  });

  it('turns zod shapes into JSON Schema for function calling', () => {
    expect(toolJsonSchema(tool)).toMatchObject({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] });
  });
});

describe('Codex adapter', () => {
  const bot = { id: 'dev', name: 'Dev', prompt: 'You build.', skills: [], localSkills: [], tools: [] } as unknown as Bot;

  async function* gen(evs: CodexEvent[]) {
    for (const e of evs) yield e;
  }

  it('maps thread items to AgentRoom events and usage', async () => {
    const events: AgentEvent[] = [];
    const req = fakeReq(bot, events);
    const ev = new RunEvents(req, 'codex', 'gpt-5-codex');
    const res = await consumeCodexEvents(
      gen([
        { type: 'thread.started', thread_id: 'th_1' },
        { type: 'turn.started' },
        { type: 'item.started', item: { id: 'c1', type: 'command_execution', command: 'npm test', aggregated_output: '', status: 'in_progress' } },
        { type: 'item.completed', item: { id: 'c1', type: 'command_execution', command: 'npm test', aggregated_output: 'ok', exit_code: 0, status: 'completed' } },
        { type: 'item.completed', item: { id: 'f1', type: 'file_change', changes: [{ path: 'src/a.ts', kind: 'update' }], status: 'completed' } },
        { type: 'item.completed', item: { id: 'm1', type: 'agent_message', text: 'Done.' } },
        { type: 'turn.completed', usage: { input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100 } },
      ]),
      ev,
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      { inPerMtok: 1, outPerMtok: 10 },
    );
    expect(res).toEqual({ ok: true, result: 'Done.', sessionId: 'th_1' });
    const calls = events.filter((e) => e.type === AgentEventType.ToolCall);
    expect(calls.map((c) => (c as { name: string }).name)).toEqual(['Bash', 'Edit']);
    const usage = events.find((e) => e.type === AgentEventType.Usage) as Extract<AgentEvent, { type: 'usage' }>;
    expect(usage).toMatchObject({ provider: 'codex', input: 1000, output: 100, cacheRead: 200, costUsd: 0.002 });
  });

  it('reports a rate limit before any tool call as unavailable, and serves host tools over the bridge', async () => {
    const bridge = new HostToolBridge(() => 'http://127.0.0.1:1');
    let config: Record<string, unknown> | undefined;
    const provider = new CodexProvider({ ...engineDeps(), bridge }, async (opts) => {
      config = opts.config;
      return {
        startThread: () => ({
          id: null,
          runStreamed: async () => ({ events: gen([{ type: 'turn.started' }, { type: 'turn.failed', error: { message: '429 Too Many Requests' } }]) }),
        }),
        resumeThread: () => {
          throw new Error('no');
        },
      };
    });
    const tool = { name: 'ask_human', description: 'Ask', schema: {}, handler: async () => '' };
    await expect(provider.run(fakeReq(bot, [], { hostTools: [tool], model: 'claude-opus-4' }))).rejects.toMatchObject({ reason: 'rate-limit' });
    expect((config!.mcp_servers as Record<string, { url: string }>).agentroom!.url).toMatch(/__agentroom\/mcp\//);
    expect(bridge.size).toBe(0);
  });

  it('maps external MCP servers to Codex config', () => {
    expect(codexMcpServers({ a: { command: 'npx', args: ['x'] }, b: { type: 'http', url: 'https://h', headers: { k: 'v' } }, c: { type: 'sse', url: 'https://s' } })).toEqual({
      a: { command: 'npx', args: ['x'] },
      b: { url: 'https://h', http_headers: { k: 'v' } },
    });
  });
});

describe('Gemini adapter', () => {
  const bot = { id: 'qa', name: 'QA', prompt: 'You test.', skills: [], localSkills: [], tools: [] } as unknown as Bot;

  it('builds headless args limited to AgentRoom servers', () => {
    expect(geminiArgs({ prompt: 'p', model: 'gemini-2.5-pro', approvalMode: 'auto_edit', sandbox: true, servers: ['agentroom'] })).toEqual([
      '--prompt', 'p', '--output-format', 'stream-json', '--approval-mode', 'auto_edit', '--model', 'gemini-2.5-pro', '--sandbox', '--allowed-mcp-server-names', 'agentroom',
    ]);
  });

  it('maps stream-json events and writes a per-run settings file with the bridge', async () => {
    const events: AgentEvent[] = [];
    let settingsSeen: { mcpServers: Record<string, { httpUrl?: string; trust?: boolean }> } | undefined;
    const lines: GeminiEvent[] = [
      { type: 'init', session_id: 's1', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'assistant', content: 'Looking', delta: true },
      { type: 'message', role: 'assistant', content: ' now.', delta: true },
      { type: 'tool_use', tool_name: 'run_shell_command', tool_id: 'x1', parameters: { command: 'ls' } },
      { type: 'tool_result', tool_id: 'x1', status: 'success', output: 'a b' },
      { type: 'message', role: 'assistant', content: 'All good.', delta: true },
      { type: 'result', status: 'success', stats: { input_tokens: 50, output_tokens: 5, cached: 10 } },
    ];
    const provider = new GeminiProvider({ ...engineDeps(), bridge: new HostToolBridge(() => 'http://127.0.0.1:2') }, (args, opts) => {
      settingsSeen = JSON.parse(fs.readFileSync(opts.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH!, 'utf8'));
      return {
        lines: (async function* () {
          for (const l of lines) yield JSON.stringify(l);
        })(),
        done: Promise.resolve({ code: 0, stderr: '' }),
      };
    });
    const tool = { name: 'task_list', description: 'List', schema: {}, handler: async () => '' };
    const res = await provider.run(fakeReq(bot, events, { hostTools: [tool] }));
    expect(res).toMatchObject({ ok: true, result: 'All good.' });
    expect(settingsSeen!.mcpServers.agentroom).toMatchObject({ trust: true });
    expect(events.filter((e) => e.type === AgentEventType.Message).map((e) => (e as { text: string }).text)).toEqual(['Looking now.', 'All good.']);
    expect(events.find((e) => e.type === AgentEventType.ToolCall)).toMatchObject({ name: 'Bash' });
  });

  it('a missing CLI is "not installed" so the router can fall back', async () => {
    const provider = new GeminiProvider(engineDeps(), () => ({ lines: (async function* () {})(), done: Promise.resolve({ code: -1, stderr: 'spawn gemini ENOENT' }) }));
    await expect(provider.run(fakeReq(bot, []))).rejects.toMatchObject({ reason: 'not-installed' });
  });

  it('returns null when the stream ends without a result line', async () => {
    const ev = new RunEvents(fakeReq(bot, []), 'gemini', '');
    expect(await consumeGeminiEvents((async function* () {})(), ev, { inPerMtok: 0, outPerMtok: 0 })).toBeNull();
  });
});

describe('OpenAI-compatible adapter', () => {
  it('runs its own tool loop with every write going through the approval gate', async () => {
    const cwd = tmp();
    const bot = { id: 'dev', name: 'Dev', prompt: 'You build.', skills: [], localSkills: [], tools: [ToolName.Read, ToolName.Write, ToolName.Bash] } as unknown as Bot;
    const replies = [
      { choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'hello.txt', content: 'hi' }) } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10 } },
      { choices: [{ message: { content: null, tool_calls: [{ id: 'c2', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'rm -rf /' }) } }] } }], usage: { prompt_tokens: 120, completion_tokens: 10 } },
      { choices: [{ message: { content: 'Wrote hello.txt.' } }], usage: { prompt_tokens: 130, completion_tokens: 5 } },
    ];
    const bodies: { tools: { function: { name: string } }[]; messages: { role: string }[] }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    }) as unknown as typeof fetch;
    const s = settings({ engine: { openaiCompat: { model: 'qwen2.5-coder', priceInPerMtok: 1, priceOutPerMtok: 2 } } });
    const asked: string[] = [];
    const events: AgentEvent[] = [];
    const provider = new OpenAICompatProvider(engineDeps(s), fetchImpl);
    const res = await provider.run(
      fakeReq(bot, events, {
        cwd,
        askPermission: async (tool) => {
          asked.push(tool);
          return tool === ToolName.Bash ? { allow: false, message: 'no' } : { allow: true };
        },
      }),
    );
    expect(res).toMatchObject({ ok: true, result: 'Wrote hello.txt.' });
    expect(fs.readFileSync(path.join(cwd, 'hello.txt'), 'utf8')).toBe('hi');
    expect(asked).toEqual([ToolName.Write, ToolName.Bash]);
    expect(bodies[0]!.tools.map((t) => t.function.name)).toEqual(['read_file', 'write_file', 'run_command']);
    expect(bodies[2]!.messages.filter((m) => m.role === 'tool')).toHaveLength(2);
    const usage = events.find((e) => e.type === AgentEventType.Usage) as Extract<AgentEvent, { type: 'usage' }>;
    expect(usage.costUsd).toBeCloseTo((350 * 1 + 25 * 2) / 1e6);
  });

  it('confines file tools to the working folder', () => {
    const cwd = tmp();
    expect(() => insideCwd(cwd, '../etc/passwd')).toThrow(/outside/);
    expect(() => insideCwd(cwd, '/etc/passwd')).toThrow(/outside/);
    expect(insideCwd(cwd, 'src/a.ts')).toBe(path.join(cwd, 'src/a.ts'));
    const bot = { tools: [ToolName.Read] } as unknown as Bot;
    expect(builtinTools({ bot, cwd }).map((t) => t.name)).toEqual(['read_file']);
  });

  it('a refused connection before any tool call is an outage', async () => {
    const fetchImpl = (async () => {
      throw new Error('fetch failed: ECONNREFUSED');
    }) as unknown as typeof fetch;
    const provider = new OpenAICompatProvider(engineDeps(settings({ engine: { openaiCompat: { model: 'llama3.1' } } })), fetchImpl);
    await expect(provider.run(fakeReq({ id: 'b', prompt: '', skills: [], localSkills: [], tools: [] } as unknown as Bot, []))).rejects.toMatchObject({ reason: 'outage' });
  });
});

describe('statistics', () => {
  it('Fisher exact test matches known values', () => {
    expect(fisherExact(8, 10, 2, 10)).toBeCloseTo(0.023, 3);
    expect(fisherExact(5, 10, 5, 10)).toBeCloseTo(1, 6);
    expect(fisherExact(3, 3, 0, 3)).toBeCloseTo(0.1, 3);
    expect(fisherExact(0, 0, 1, 2)).toBe(1);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

const outcome = (goalId: string, o: Partial<GoalOutcome> = {}): GoalOutcome => ({ goalId, status: GoalStatus.Done, reviewRounds: 0, costUsd: 1, checkedAt: '2026-01-01T00:00:00Z', ...o });

describe('experiments', () => {
  it('assigns goals to variants in balance, keeps the assignment and changes the bot', () => {
    const file = path.join(tmp(), 'experiments.json');
    const store = new ExperimentStore(file, () => ['db-migrations', 'testing']);
    expect(() => store.create({ name: 'x', botId: 'dev', change: { addSkills: ['nope'], removeSkills: [], promptAppend: '' } })).toThrow(/Unknown skill/);
    const exp = store.create({ name: 'Migrations skill', botId: 'dev', change: { addSkills: ['db-migrations'], removeSkills: ['testing'], promptAppend: 'Be careful.' } });
    expect(() => store.create({ name: 'again', botId: 'dev', change: { addSkills: [], removeSkills: [], promptAppend: 'x' } })).toThrow(/already has a running/);
    const bot = { id: 'dev', skills: ['testing'], localSkills: [], prompt: 'P' } as unknown as Bot;
    const picks = ['g1', 'g2', 'g3', 'g4'].map((g) => store.forRun(bot, { goalId: g })!.variants[exp.id]);
    expect(picks).toEqual(['control', 'change', 'control', 'change']);
    expect(store.forRun(bot, { goalId: 'g2' })!.bot).toMatchObject({ skills: ['db-migrations'], prompt: 'P\n\nBe careful.' });
    expect(store.forRun(bot, { goalId: 'g1' })!.bot).toBe(bot);
    expect(store.forRun(bot, {})).toBeNull();
    // Persisted.
    expect(new ExperimentStore(file, () => []).get(exp.id)!.assignments).toEqual({ g1: 'control', g2: 'change', g3: 'control', g4: 'change' });
  });

  it('compares decided goals and names a winner only when significant', () => {
    const store = new ExperimentStore(path.join(tmp(), 'e.json'), () => ['s']);
    const exp = store.create({ name: 'e', botId: 'b', change: { addSkills: ['s'], removeSkills: [], promptAppend: '' } });
    const bot = { id: 'b', skills: [], localSkills: [], prompt: '' } as unknown as Bot;
    const outcomes = new Map<string, GoalOutcome>();
    for (let i = 0; i < 20; i++) {
      const g = `g${i}`;
      const v = store.forRun(bot, { goalId: g })!.variants[exp.id];
      const good = v === 'change' ? i < 18 : i < 4; // change: 9/10 ok, control: 2/10 ok
      outcomes.set(g, outcome(g, good ? {} : { status: GoalStatus.Failed }));
    }
    outcomes.set('pending', outcome('pending', { prState: 'open' }));
    const notReady = experimentResult(exp, (id) => outcomes.get(id), 11);
    expect(notReady).toMatchObject({ ready: false, pValue: null, winner: null });
    const res = experimentResult(exp, (id) => outcomes.get(id), 10);
    expect(res.ready).toBe(true);
    expect(res.winner).toBe('change');
    expect(res.pValue!).toBeLessThan(0.05);
    expect(res.summary).toMatch(/With change wins/);
  });

  it('applyVariant leaves the bot alone for the control', () => {
    const bot = { skills: ['a'], localSkills: [], prompt: 'p' } as unknown as Bot;
    expect(applyVariant(bot, { id: 'control', label: '', addSkills: [], removeSkills: [], promptAppend: '' })).toBe(bot);
  });
});

describe('outcomes', () => {
  it('labels merged, reverted, closed and open PRs; checks gh only for goals with a PR', async () => {
    const asked: string[] = [];
    const probe: OutcomeProbe = {
      pr: async (url) => {
        asked.push(url);
        if (url.endsWith('/1')) return { state: 'MERGED', mergedAt: '2026-01-02', mergeCommit: { oid: 'abc1234' } };
        if (url.endsWith('/2')) return { state: 'MERGED', mergedAt: '2026-01-02', mergeCommit: { oid: 'def5678' } };
        if (url.endsWith('/3')) return { state: 'CLOSED' };
        return { state: 'OPEN' };
      },
      revertOf: async (sha) => (sha === 'def5678' ? 'rev999' : null),
    };
    const tracker = new OutcomeTracker(path.join(tmp(), 'outcomes.json'), probe);
    const goal = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: GoalStatus.Done, round: 1, reviewComments: [], ...extra }) as never;
    const out = await tracker.refresh(
      [goal('G-1', { pr: { url: 'https://github.com/o/r/pull/1' } }), goal('G-2', { pr: { url: 'https://github.com/o/r/pull/2' } }), goal('G-3', { pr: { url: 'https://github.com/o/r/pull/3' } }), goal('G-4', { pr: { url: 'https://github.com/o/r/pull/4' } }), goal('G-5'), goal('G-6', { status: GoalStatus.Failed }), goal('G-7', { status: GoalStatus.Building })],
      [{ goalId: 'G-1', costUsd: 0.5 } as LedgerEntry, { goalId: 'G-1', costUsd: 0.25 } as LedgerEntry],
      { remote: true, now: new Date('2026-01-03T00:00:00Z') },
    );
    const label = (id: string) => outcomeLabel(out.find((o) => o.goalId === id));
    expect([label('G-1'), label('G-2'), label('G-3'), label('G-4'), label('G-5'), label('G-6'), label('G-7')]).toEqual(['success', 'failure', 'failure', 'pending', 'success', 'failure', 'pending']);
    expect(tracker.get('G-1')!.costUsd).toBe(0.75);
    expect(asked).toHaveLength(4);
  });
});

describe('suggestions and estimates', () => {
  const bots = [{ id: 'dev', name: 'Developer', skills: ['testing'] }] as unknown as Bot[];
  const row = (o: Partial<LedgerEntry>): LedgerEntry => ({ id: 'x', ts: '2026-01-01', startedAt: '2026-01-01', botId: 'dev', model: 'claude-opus-4', ok: true, costUsd: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, durationMs: 1, turns: 1, skills: [], tools: {}, ...o });

  it('suggests a skill that matches what a bot keeps failing on', () => {
    const ledger = [row({ ok: false, error: 'migration failed: column exists' }), row({ ok: false, error: 'database migration rollback error' }), row({}), row({}), row({ ok: false, error: 'timeout' })];
    const skills = [
      { name: 'db-migrations', description: 'Write safe database migrations and rollbacks' },
      { name: 'frontend', description: 'React components' },
    ] as never;
    const out = suggest({ ledger, bots, skills, settings: settings(), dismissed: new Set() });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'add-skill', botId: 'dev', skill: 'db-migrations', evidence: { runs: 5, failures: 3 } });
    // "migration" in the errors matches "migrations" in the skill, and is shown as written.
    expect(out[0]!.why).toMatch(/mention migration/);
    expect(suggest({ ledger, bots, skills, settings: settings(), dismissed: new Set([out[0]!.id]) })).toHaveLength(0);
  });

  it('suggests a cheaper model for an expensive phase that nearly always succeeds', () => {
    const ledger = Array.from({ length: 12 }, () => row({ phase: WorkPhase.Reporting, costUsd: 0.8 }));
    const out = suggest({ ledger, bots: [], skills: [], settings: settings(), dismissed: new Set() });
    expect(out[0]).toMatchObject({ kind: 'cheaper-model', phase: 'reporting', model: 'sonnet' });
  });

  it('estimates a goal from per-phase medians of finished goals', () => {
    const goals = ['G-1', 'G-2', 'G-3', 'G-4'].map((id, i) => ({ id, status: i < 3 ? GoalStatus.Done : GoalStatus.Failed })) as never;
    const ledger = [
      row({ goalId: 'G-1', phase: WorkPhase.Planning, costUsd: 0.1 }),
      row({ goalId: 'G-1', phase: WorkPhase.Planning, costUsd: 0.1 }),
      row({ goalId: 'G-2', phase: WorkPhase.Planning, costUsd: 0.3 }),
      row({ goalId: 'G-3', phase: WorkPhase.Planning, costUsd: 0.4 }),
      row({ goalId: 'G-4', phase: WorkPhase.Planning, costUsd: 9 }),
      row({ goalId: 'G-1', phase: WorkPhase.Build, costUsd: 2, provider: 'codex', model: 'gpt-5-codex' }),
    ];
    const est = estimateGoalCost({ ledger, goals, routeFor: () => ({ provider: 'claude', model: 'opus' }) });
    const planning = est.phases.find((p) => p.phase === 'planning')!;
    expect(planning).toMatchObject({ medianUsd: 0.3, samples: 3, basis: 'exact' });
    expect(est.phases.find((p) => p.phase === 'build')).toMatchObject({ basis: 'any', medianUsd: 2 });
    expect(est.totalUsd).toBe(2.3);
    expect(est.goals).toBe(3);
  });
});

describe('EngineService', () => {
  it('applies a suggestion only on request, or starts an experiment instead', () => {
    const p = project();
    const dev = p.bots.list().find((b) => b.role === 'developer')!;
    p.library.save({ name: 'db-migrations', description: 'Safe database migrations', body: 'x' });
    const ledger = new LedgerService(p.paths.ledgerFile);
    const now = new Date().toISOString();
    for (const error of ['migration failed', 'database migration error', 'migration lock', undefined, undefined]) {
      ledger.record({ ts: now, startedAt: now, botId: dev.id, model: 'm', ok: !error, ...(error ? { error } : {}), costUsd: 0.1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, durationMs: 1, turns: 1, skills: [], tools: {} });
    }
    const claude = new Fake(ProviderId.Claude, async () => ({ ok: true, result: '' }));
    const engine = new EngineService({ project: p, ledger, secrets: new SecretsStore(p.paths.secretsFile), providers: new ProviderPool(claude, engineDeps()), scratchDir: tmp(), probe: { pr: async () => null, revertOf: async () => null } });
    const [s] = engine.suggestions();
    expect(s).toMatchObject({ kind: 'add-skill', skill: 'db-migrations', botId: dev.id });
    expect(p.bots.get(dev.id)!.skills).not.toContain('db-migrations');
    expect(engine.applySuggestion(s!.id, 'experiment').applied).toMatch(/Started experiment/);
    expect(engine.experimentResults()).toHaveLength(1);
    expect(engine.suggestions()).toHaveLength(0);
    expect(p.bots.get(dev.id)!.skills).not.toContain('db-migrations');
  });

  it('stores provider keys write-only and rejects Claude', () => {
    const p = project();
    const secrets = new SecretsStore(p.paths.secretsFile);
    const engine = new EngineService({ project: p, ledger: new LedgerService(p.paths.ledgerFile), secrets, providers: new ProviderPool(new Fake('claude', async () => ({ ok: true, result: '' })), engineDeps()), scratchDir: tmp() });
    engine.setKey('openai-compat', ' sk-local ');
    expect(secrets.providerKey('openai-compat')).toBe('sk-local');
    expect(secrets.providerKeys()).toEqual(['openai-compat']);
    expect(() => engine.setKey('claude', 'x')).toThrow(/Claude/);
    engine.setKey('openai-compat', '');
    expect(secrets.providerKeys()).toEqual([]);
  });
});

describe('settings', () => {
  it('engine defaults parse and a phase route keeps provider + fallbacks', () => {
    const s = settings();
    expect(s.engine.fallback).toEqual({ enabled: true, onRateLimit: true, onOutage: true, onError: false });
    expect(s.engine.openaiCompat.baseUrl).toBe('http://localhost:11434/v1');
    const p = project();
    const next = p.settings.update({ models: { build: { provider: 'codex', model: 'gpt-5-codex', fallbacks: [{ provider: 'claude' }] } } });
    expect(next.models.build).toEqual({ provider: 'codex', model: 'gpt-5-codex', fallbacks: [{ provider: 'claude' }] });
    expect(() => p.settings.update({ models: { build: { provider: 'nope' as never } } })).toThrow(/Invalid settings/);
  });
});
