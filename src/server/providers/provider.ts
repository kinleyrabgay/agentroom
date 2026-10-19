import type { z } from 'zod';
import type { EffortLevel } from '../../shared/enums.js';
import type { AccountUsage, AgentEvent, Bot, ModelOption, StreamDelta } from '../../shared/types/index.js';
import type { ResolvedAttachment } from '../services/upload.store.js';

/** A tool AgentRoom provides to bots (tasks, delegation, in-app browser), independent of provider. */
export interface HostToolDef {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  handler: (args: any) => Promise<string>;
}

export type PermissionAnswer = { allow: true } | { allow: false; message: string };

export type AskPermission = (tool: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<PermissionAnswer>;

/** Where a bot's skills live on disk. */
export interface SkillLocations {
  /** `.agentroom/` — the library plugin root. */
  libraryPluginDir: string;
  /** The bot's own folder — its plugin root when it has local skills. */
  botPluginDir: string;
}

export interface RunRequest {
  bot: Bot;
  prompt: string;
  /** Files the human attached (images, PDFs, text, other files). */
  attachments?: ResolvedAttachment[];
  cwd: string;
  /** Stop once the run has spent this much (USD). */
  maxBudgetUsd?: number;
  model: string;
  /** Reasoning effort; omitted to use the model's default. */
  effort?: EffortLevel;
  skills: SkillLocations;
  /** Extra text appended to the system prompt (team roster, CLAUDE.md…). */
  context: string;
  resumeSessionId?: string;
  hostTools: HostToolDef[];
  /** External MCP servers this bot may use (already resolved: secrets filled in), keyed by name. */
  mcpServers?: Record<string, unknown>;
  signal: AbortSignal;
  /** Logged events (messages, tool calls, usage…). */
  emit: (event: AgentEvent) => void;
  /** Live token/tool progress for the UI. */
  stream: (delta: StreamDelta) => void;
  askPermission: AskPermission;
  /**
   * Called with the output of built-in tools that read the web (WebFetch, WebSearch); return a warning to
   * show the model next to the output (e.g. possible prompt injection), or null.
   */
  inspectToolOutput?: (tool: string, output: string) => string | null;
}

export interface RunResult {
  ok: boolean;
  result: string;
  sessionId?: string;
}

/** An agent runtime AgentRoom can drive. */
export interface Provider {
  readonly id: string;
  run(req: RunRequest): Promise<RunResult>;
  /** Models this provider offers (for the model + effort picker). */
  listModels(cwd: string): Promise<ModelOption[]>;
  /** Account-wide plan usage, if the provider can report it. */
  fetchAccountUsage?(cwd: string): Promise<AccountUsage | null>;
}
