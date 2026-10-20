import type { ActorType, AuditKind, WorkPhase } from '../enums.js';

/** One bot run. Appended to `.agentroom/runs/ledger.jsonl`; the basis for budgets, insights and replay. */
export interface LedgerEntry {
  id: string;
  /** Run end, ISO. */
  ts: string;
  startedAt: string;
  botId: string;
  goalId?: string;
  taskId?: string;
  phase?: WorkPhase;
  model: string;
  /** Provider that ran it (absent on rows from before 0.0.3: claude). */
  provider?: string;
  /** Providers tried first that couldn't run (rate limit, outage…). */
  fellBackFrom?: string[];
  /** Experiment variants this run was part of: experiment id → variant id. */
  variants?: Record<string, string>;
  ok: boolean;
  aborted?: boolean;
  costUsd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  durationMs: number;
  turns: number;
  /** Skills the bot invoked. */
  skills: string[];
  /** Tool name → call count. */
  tools: Record<string, number>;
  /** First line of the failure, when !ok. */
  error?: string;
}

export interface AuditActor {
  type: ActorType;
  /** git user for humans, bot id for bots, rule name for policy. */
  name: string;
}

/** Append-only audit record (`.agentroom/runs/audit.jsonl`). */
export interface AuditEntry {
  id: string;
  ts: string;
  kind: AuditKind;
  /** Who decided or did it. */
  actor: AuditActor;
  /** The bot that asked for / performed the action, if any. */
  botId?: string;
  goalId?: string;
  taskId?: string;
  /** One line, human readable: "git push origin agentroom/g-1". */
  summary: string;
  decision?: 'allowed' | 'denied';
  /** Structured detail (tool input, finding, etc.). */
  detail?: Record<string, unknown>;
}

export interface AuditQuery {
  q?: string;
  kind?: AuditKind;
  botId?: string;
  goalId?: string;
  /** ISO; return entries older than this (pagination). */
  before?: string;
  limit?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  /** True when older entries exist. */
  more: boolean;
}
