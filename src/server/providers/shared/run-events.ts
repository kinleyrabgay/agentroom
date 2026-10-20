import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { AgentEventType, BotStatus, StreamDeltaType } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import { HOST_TOOL_PREFIX, TOOL_OUTPUT_LIMIT } from '../../config/constants.js';
import { describeTool, shortToolName } from '../../agents/tool-descriptions.js';
import type { RunRequest, RunResult, SkillLocations } from '../provider.js';

/** Token counts one run used; cost is computed from per-million prices when the provider doesn't report it. */
export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd?: number;
}

export interface Prices {
  inPerMtok: number;
  outPerMtok: number;
}

/**
 * AgentRoom events for providers that aren't Claude: messages, tool calls/results, usage, run done.
 * Mirrors what ClaudeStreamMapper emits, so the UI, ledger and insights don't care which provider ran.
 */
export class RunEvents {
  private readonly started = Date.now();
  private turns = 0;
  private lastText = '';
  /** Tool calls seen; a run that called a tool did something, so it's never retried elsewhere. */
  toolCalls = 0;
  sessionId: string | undefined;

  constructor(
    private readonly req: Pick<RunRequest, 'bot' | 'cwd' | 'emit' | 'stream' | 'resumeSessionId'>,
    private readonly provider: string,
    private readonly model: string,
  ) {
    this.sessionId = req.resumeSessionId;
  }

  status(status: BotStatus, activity?: string) {
    this.req.emit({ type: AgentEventType.BotStatus, botId: this.req.bot.id, status, activity });
  }

  /** A complete assistant message (also streamed so the chat shows it live). */
  message(text: string) {
    if (!text.trim()) return;
    this.lastText = text;
    this.req.stream({ type: StreamDeltaType.TextStart });
    this.req.stream({ type: StreamDeltaType.Text, text });
    this.req.emit({ type: AgentEventType.Message, botId: this.req.bot.id, text });
  }

  turn() {
    this.turns++;
  }

  toolCall(id: string, rawName: string, input: Record<string, unknown>) {
    this.toolCalls++;
    const name = shortToolName(rawName);
    const { summary, activity } = describeTool(name, input, this.req.cwd);
    this.req.stream({ type: StreamDeltaType.ToolStart, toolUseId: id, name });
    this.req.emit({ type: AgentEventType.ToolCall, botId: this.req.bot.id, toolUseId: id, name, summary, input });
    this.status(BotStatus.Working, activity);
  }

  toolResult(id: string, ok: boolean, output: string) {
    this.req.emit({ type: AgentEventType.ToolResult, botId: this.req.bot.id, toolUseId: id, ok, output: truncate(output, TOOL_OUTPUT_LIMIT) });
    this.status(BotStatus.Thinking);
  }

  /** Usage + run done. Returns the run result. */
  finish(ok: boolean, result: string | undefined, usage: RunUsage, prices?: Prices): RunResult {
    const text = result ?? (ok ? this.lastText : 'Run failed.');
    const cost = usage.costUsd ?? (prices ? (usage.input * prices.inPerMtok + usage.output * prices.outPerMtok) / 1e6 : 0);
    this.req.emit({
      type: AgentEventType.Usage,
      botId: this.req.bot.id,
      provider: this.provider,
      model: this.model || this.provider,
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      costUsd: cost,
      runs: 1,
    });
    this.req.emit({
      type: AgentEventType.RunDone,
      botId: this.req.bot.id,
      ok,
      result: text,
      costUsd: cost,
      durationMs: Date.now() - this.started,
      turns: Math.max(1, this.turns),
    });
    return { ok, result: text, sessionId: this.sessionId };
  }
}

/** Gemini/Codex built-in tool names → AgentRoom's (Claude Code) names, so descriptions and approvals line up. */
export const TOOL_ALIASES: Record<string, string> = {
  run_shell_command: 'Bash',
  shell: 'Bash',
  write_file: 'Write',
  replace: 'Edit',
  edit: 'Edit',
  read_file: 'Read',
  read_many_files: 'Read',
  list_directory: 'Glob',
  glob: 'Glob',
  search_file_content: 'Grep',
  grep: 'Grep',
  web_fetch: 'WebFetch',
  google_web_search: 'WebSearch',
  web_search: 'WebSearch',
  write_todos: 'TodoWrite',
};

export const aliasTool = (name: string) => TOOL_ALIASES[name] ?? name;

/** Host tool name as the permission gate and UI know it (`mcp__agentroom__task_create`). */
export const hostToolName = (name: string) => `${HOST_TOOL_PREFIX}${name}`;

/**
 * System instructions for providers without Claude Code's preset: the bot persona, AgentRoom's
 * context (team, repo map, memory…) and the bot's skills as progressive-disclosure pointers.
 */
export function systemText(req: Pick<RunRequest, 'bot' | 'context' | 'skills'>): string {
  return [req.bot.prompt.trim(), req.context.trim(), skillsBlock(req.bot, req.skills)].filter(Boolean).join('\n\n');
}

/** Assigned skills: name, description and the SKILL.md path to read when one applies. */
export function skillsBlock(bot: Bot, loc: SkillLocations): string {
  const rows: string[] = [];
  const add = (dir: string, name: string) => {
    const file = path.join(dir, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(file)) return;
    let description = '';
    try {
      description = String(matter(fs.readFileSync(file, 'utf8')).data.description ?? '').trim();
    } catch {
      // unreadable frontmatter: list it without a description
    }
    rows.push(`- ${name}: ${description || '(no description)'} (read ${file} before using it)`);
  };
  for (const s of bot.skills) add(loc.libraryPluginDir, s);
  for (const s of bot.localSkills) add(loc.botPluginDir, s.name);
  return rows.length ? `# Skills\nWhen a task matches one of these, read its SKILL.md first and follow it.\n${rows.join('\n')}` : '';
}

export function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + `\n… (${s.length - n} more chars)` : s;
}

export type FailureKind = 'rate-limit' | 'outage' | 'auth' | 'not-installed';

/** Rate-limit / outage / auth / not-installed classification of an error message from any provider. */
export function classifyFailure(message: string): FailureKind | null {
  const m = message.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|quota|usage limit|resource.?exhausted/.test(m)) return 'rate-limit';
  if (/\b(500|502|503|504|529)\b|overloaded|service unavailable|econnrefused|econnreset|etimedout|enotfound|fetch failed|socket hang up|network error/.test(m)) return 'outage';
  if (/\b401\b|\b403\b|unauthori[sz]ed|not logged in|login required|invalid api key|authentication/.test(m)) return 'auth';
  if (/not installed|enoent|cannot find (module|package)|command not found/.test(m)) return 'not-installed';
  return null;
}
