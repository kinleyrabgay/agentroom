import type { z } from 'zod';
import type { EffortLevel, SteerStatus } from '../../shared/enums.js';
import type { AccountUsage, AgentEvent, Bot, ModelOption, StreamDelta } from '../../shared/types/index.js';
import type { ResolvedAttachment } from '../services/upload.store.js';
import type { Settings } from '../../shared/types/index.js';
import type { HostToolBridge } from './host-bridge.js';

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
  /** Extra folders the agent may work in besides `cwd` (a workspace's other repos). */
  additionalDirectories?: string[];
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
  /** Lets the human write into this run while it works (providers that can take input mid-run). */
  steering?: SteerLink;
}

/** A running turn that takes more input. `steer` returns false once the run can't take it any more. */
export interface SteerHandle {
  steer(id: string, text: string): boolean;
}

/** How a provider tells the Team it can be steered, and what became of each steer. */
export interface SteerLink {
  /** Called with a handle when the run starts taking input, and with null when it stops. */
  attach(handle: SteerHandle | null): void;
  status(id: string, status: SteerStatus): void;
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

/** What non-Claude providers need from the server: their settings, keys and the host-tool bridge. */
export interface ProviderDeps {
  engine: () => Settings['engine'];
  /** API key stored for a provider in runs/secrets.json. */
  secret: (providerId: string) => string | undefined;
  /** Serves host tools over MCP to providers that run their own agent loop. */
  bridge?: HostToolBridge;
}

/** Thrown (or reported) when a run can't start or fails for a reason another provider wouldn't have. */
export class ProviderUnavailableError extends Error {
  constructor(
    message: string,
    readonly reason: 'not-installed' | 'auth' | 'rate-limit' | 'outage',
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
