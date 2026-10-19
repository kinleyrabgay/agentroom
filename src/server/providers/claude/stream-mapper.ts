import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentEventType, BotStatus, ProviderId, StreamDeltaType } from '../../../shared/enums.js';
import type { AgentEvent, StreamDelta } from '../../../shared/types/index.js';
import { TOOL_OUTPUT_LIMIT } from '../../config/constants.js';
import { describeTool, shortToolName } from '../../agents/tool-descriptions.js';
import type { RunResult } from '../provider.js';

type SdkResult = Extract<SDKMessage, { type: 'result' }>;

/**
 * Translates Claude Agent SDK messages into AgentRoom events (logged) and stream deltas (live).
 * One instance per run; holds the run's session id, final result and context fill.
 */
export class ClaudeStreamMapper {
  sessionId: string | undefined;
  result: RunResult = { ok: false, result: 'Run ended without a result.' };
  /** Prompt size on the latest top-level turn = how full the context window is. */
  private contextUsed: number | undefined;

  constructor(
    private readonly botId: string,
    private readonly model: string,
    private readonly cwd: string,
    private readonly emit: (e: AgentEvent) => void,
    private readonly stream: (d: StreamDelta) => void,
    resumeSessionId?: string,
  ) {
    this.sessionId = resumeSessionId;
  }

  handle(msg: SDKMessage) {
    if ('session_id' in msg && msg.session_id) this.sessionId = msg.session_id;
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') this.status(BotStatus.Thinking);
        return;
      case 'stream_event':
        return this.onStreamEvent(msg);
      case 'assistant':
        return this.onAssistant(msg);
      case 'user':
        return this.onToolResults(msg);
      case 'rate_limit_event':
        return this.onRateLimit(msg);
      case 'result':
        return this.onResult(msg);
    }
  }

  private status(status: BotStatus, activity?: string) {
    this.emit({ type: AgentEventType.BotStatus, botId: this.botId, status, activity });
  }

  private onStreamEvent(msg: Extract<SDKMessage, { type: 'stream_event' }>) {
    if (msg.parent_tool_use_id) return;
    const ev = msg.event;
    if (ev.type === 'content_block_start') {
      const b = ev.content_block;
      if (b.type === 'text') this.stream({ type: StreamDeltaType.TextStart });
      else if (b.type === 'thinking') this.stream({ type: StreamDeltaType.Thinking });
      else if (b.type === 'tool_use') this.stream({ type: StreamDeltaType.ToolStart, toolUseId: b.id, name: shortToolName(b.name) });
    } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      this.stream({ type: StreamDeltaType.Text, text: ev.delta.text });
    }
  }

  private onAssistant(msg: Extract<SDKMessage, { type: 'assistant' }>) {
    const u = msg.message.usage;
    if (!msg.parent_tool_use_id && u) {
      this.contextUsed = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    }
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text.trim()) {
        this.emit({ type: AgentEventType.Message, botId: this.botId, text: block.text });
      } else if (block.type === 'thinking') {
        this.status(BotStatus.Thinking);
      } else if (block.type === 'tool_use') {
        const name = shortToolName(block.name);
        const { summary, activity } = describeTool(name, block.input as Record<string, unknown>, this.cwd);
        this.emit({ type: AgentEventType.ToolCall, botId: this.botId, toolUseId: block.id, name, summary, input: block.input });
        this.status(BotStatus.Working, activity);
      }
    }
  }

  private onToolResults(msg: Extract<SDKMessage, { type: 'user' }>) {
    const content = msg.message.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (typeof block === 'object' && block && block.type === 'tool_result') {
        this.emit({
          type: AgentEventType.ToolResult,
          botId: this.botId,
          toolUseId: block.tool_use_id,
          ok: !block.is_error,
          output: truncate(stringifyContent(block.content), TOOL_OUTPUT_LIMIT),
        });
      }
    }
    this.status(BotStatus.Thinking);
  }

  private onRateLimit(msg: Extract<SDKMessage, { type: 'rate_limit_event' }>) {
    const r = msg.rate_limit_info;
    if (!r.rateLimitType) return;
    this.emit({
      type: AgentEventType.RateLimit,
      provider: ProviderId.Claude,
      window: r.rateLimitType,
      status: r.status,
      utilization: r.utilization,
      resetsAt: r.resetsAt,
      usingOverage: r.isUsingOverage,
    });
  }

  private onResult(msg: SdkResult) {
    const ok = msg.subtype === 'success' && !msg.is_error;
    const text = msg.subtype === 'success'
      ? msg.result
      : `Run failed: ${msg.subtype}${'errors' in msg && msg.errors?.length ? ` — ${msg.errors.join('; ')}` : ''}`;
    this.result = { ok, result: text, sessionId: this.sessionId };
    this.emitUsage(msg);
    this.emit({
      type: AgentEventType.RunDone,
      botId: this.botId,
      ok,
      result: text,
      costUsd: msg.total_cost_usd ?? 0,
      durationMs: msg.duration_ms ?? 0,
      turns: msg.num_turns ?? 0,
    });
  }

  /** One report per model the run touched (Claude Code may use a small model for side tasks). */
  private emitUsage(msg: SdkResult) {
    const models = Object.entries(msg.modelUsage ?? {});
    const main =
      models.find(([m]) => m === this.model || m.startsWith(this.model))?.[0] ??
      [...models].sort((a, b) => b[1].outputTokens - a[1].outputTokens)[0]?.[0];
    for (const [model, mu] of models) {
      this.emit({
        type: AgentEventType.Usage,
        botId: this.botId,
        provider: ProviderId.Claude,
        model,
        input: mu.inputTokens,
        output: mu.outputTokens,
        cacheRead: mu.cacheReadInputTokens,
        cacheWrite: mu.cacheCreationInputTokens,
        costUsd: mu.costUSD,
        runs: model === main ? 1 : 0,
        contextWindow: mu.contextWindow || undefined,
        contextUsed: model === main ? this.contextUsed : undefined,
      });
    }
  }
}

function stringifyContent(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '')).join('\n');
  return c == null ? '' : JSON.stringify(c);
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s;
}
