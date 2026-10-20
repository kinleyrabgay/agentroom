import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentEventType, ToolName, type WorkPhase } from '../../shared/enums.js';
import type { AgentEvent, LedgerEntry } from '../../shared/types/index.js';

export interface LedgerFilter {
  goalId?: string;
  botId?: string;
  /** ISO timestamp; entries that ended at or after it. */
  since?: string;
}

/**
 * One row per finished bot run, appended to `.agentroom/runs/ledger.jsonl`.
 * Budgets, insights and replay are computed from it.
 */
export class LedgerService {
  private entries: LedgerEntry[];

  constructor(private readonly file: string) {
    this.entries = readJsonl<LedgerEntry>(file);
  }

  record(entry: Omit<LedgerEntry, 'id'>): LedgerEntry {
    const row: LedgerEntry = { id: randomUUID(), ...entry };
    this.entries.push(row);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(row) + '\n');
    return row;
  }

  list(filter: LedgerFilter = {}): LedgerEntry[] {
    return this.entries.filter(
      (e) =>
        (!filter.goalId || e.goalId === filter.goalId) &&
        (!filter.botId || e.botId === filter.botId) &&
        (!filter.since || e.ts >= filter.since),
    );
  }

  /** USD spent since local midnight, across all bots. */
  spentToday(now = new Date()): number {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    return sum(this.list({ since: midnight }));
  }

  spentForGoal(goalId: string): number {
    return sum(this.list({ goalId }));
  }
}

const sum = (rows: LedgerEntry[]) => rows.reduce((t, r) => t + r.costUsd, 0);

function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // Skip a torn line (e.g. crash mid-write); the rest stays readable.
    }
  }
  return out;
}

/**
 * Collects one run's numbers from its events: usage (all models), tool calls,
 * skills invoked, turns and outcome. Feed it every event of the run, then `finish`.
 */
export class RunTally {
  private readonly startedAt = new Date();
  private cost = 0;
  private input = 0;
  private output = 0;
  private cacheRead = 0;
  private cacheWrite = 0;
  private turns = 0;
  private mainModel: string | undefined;
  private readonly skills = new Set<string>();
  private readonly tools: Record<string, number> = {};

  constructor(
    private readonly botId: string,
    private readonly model: string,
    private readonly ctx: { goalId?: string; taskId?: string; phase?: WorkPhase } = {},
  ) {}

  observe(e: AgentEvent) {
    switch (e.type) {
      case AgentEventType.Usage:
        this.cost += e.costUsd;
        this.input += e.input;
        this.output += e.output;
        this.cacheRead += e.cacheRead;
        this.cacheWrite += e.cacheWrite;
        if (e.runs > 0) this.mainModel = e.model;
        break;
      case AgentEventType.ToolCall: {
        this.tools[e.name] = (this.tools[e.name] ?? 0) + 1;
        if (e.name === ToolName.Skill) {
          const input = (e.input ?? {}) as Record<string, unknown>;
          const skill = input.skill ?? input.name ?? input.command;
          if (typeof skill === 'string' && skill) this.skills.add(skill);
        }
        break;
      }
      case AgentEventType.RunDone:
        this.turns += e.turns;
        break;
    }
  }

  /** Tool calls seen so far (a run that did something is never retried on another provider). */
  get toolCalls(): number {
    return Object.values(this.tools).reduce((t, n) => t + n, 0);
  }

  finish(
    outcome: { ok: boolean; aborted: boolean; error?: string; provider?: string; fellBackFrom?: string[]; variants?: Record<string, string> },
    now = new Date(),
  ): Omit<LedgerEntry, 'id'> {
    return {
      ts: now.toISOString(),
      startedAt: this.startedAt.toISOString(),
      botId: this.botId,
      ...(this.ctx.goalId ? { goalId: this.ctx.goalId } : {}),
      ...(this.ctx.taskId ? { taskId: this.ctx.taskId } : {}),
      ...(this.ctx.phase ? { phase: this.ctx.phase } : {}),
      model: this.mainModel ?? this.model,
      ...(outcome.provider ? { provider: outcome.provider } : {}),
      ...(outcome.fellBackFrom?.length ? { fellBackFrom: outcome.fellBackFrom } : {}),
      ...(outcome.variants && Object.keys(outcome.variants).length ? { variants: outcome.variants } : {}),
      ok: outcome.ok,
      ...(outcome.aborted ? { aborted: true } : {}),
      costUsd: round(this.cost),
      input: this.input,
      output: this.output,
      cacheRead: this.cacheRead,
      cacheWrite: this.cacheWrite,
      durationMs: now.getTime() - this.startedAt.getTime(),
      turns: this.turns,
      skills: [...this.skills],
      tools: { ...this.tools },
      ...(!outcome.ok && outcome.error ? { error: outcome.error.split('\n')[0].slice(0, 300) } : {}),
    };
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
