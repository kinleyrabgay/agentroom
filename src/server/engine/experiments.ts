import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { WorkPhase } from '../../shared/enums.js';
import type { Bot, Experiment, ExperimentResult, ExperimentVariant, GoalOutcome, VariantResult } from '../../shared/types/index.js';
import { readJson } from '../../core/fs/json.js';
import type { RunExperiments } from '../agents/team.js';
import { outcomeLabel } from './outcomes.js';
import { fisherExact, mean } from './stats.js';

interface ExperimentFile {
  experiments: Experiment[];
  /** Suggestion ids the human dismissed. */
  dismissed: string[];
}

export interface NewExperiment {
  name: string;
  botId: string;
  phase?: WorkPhase;
  /** The change under test; a control variant (no change) is added first. */
  change: Omit<ExperimentVariant, 'id' | 'label'> & { label?: string };
}

const CONTROL: ExperimentVariant = { id: 'control', label: 'As is', addSkills: [], removeSkills: [], promptAppend: '' };

/**
 * A/B experiments on bots (local: `runs/experiments.json`). Each goal gets one variant per
 * experiment, balanced (the variant with fewest goals so far), and keeps it for all its runs.
 */
export class ExperimentStore implements RunExperiments {
  private data: ExperimentFile;

  constructor(
    private readonly file: string,
    private readonly librarySkills: () => string[],
  ) {
    this.data = readJson<ExperimentFile>(file, { experiments: [], dismissed: [] });
    this.data.experiments ??= [];
    this.data.dismissed ??= [];
  }

  list(): Experiment[] {
    return this.data.experiments;
  }

  get(id: string): Experiment | undefined {
    return this.data.experiments.find((e) => e.id === id);
  }

  create(input: NewExperiment, now = new Date()): Experiment {
    const name = input.name.trim().slice(0, 80);
    if (!name) throw new Error('Name the experiment.');
    if (!input.botId) throw new Error('Pick a bot.');
    const library = new Set(this.librarySkills());
    const addSkills = [...new Set(input.change.addSkills ?? [])];
    const unknown = addSkills.filter((s) => !library.has(s));
    if (unknown.length) throw new Error(`Unknown skill${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    const change: ExperimentVariant = {
      id: 'change',
      label: input.change.label?.trim() || 'With change',
      addSkills,
      removeSkills: [...new Set(input.change.removeSkills ?? [])],
      promptAppend: (input.change.promptAppend ?? '').trim().slice(0, 4000),
    };
    if (!change.addSkills.length && !change.removeSkills.length && !change.promptAppend) throw new Error('The change needs a skill to add or remove, or extra instructions.');
    if (this.data.experiments.some((e) => e.status === 'running' && e.botId === input.botId && (e.phase ?? null) === (input.phase ?? null))) {
      throw new Error('This bot already has a running experiment for that phase. Stop it first.');
    }
    const exp: Experiment = {
      id: randomUUID().slice(0, 8),
      name,
      botId: input.botId,
      ...(input.phase ? { phase: input.phase } : {}),
      variants: [CONTROL, change],
      status: 'running',
      createdAt: now.toISOString(),
      assignments: {},
    };
    this.data.experiments.push(exp);
    this.save();
    return exp;
  }

  update(id: string, patch: { status?: 'running' | 'stopped'; name?: string }): Experiment {
    const exp = this.get(id);
    if (!exp) throw new Error('No such experiment.');
    if (patch.name !== undefined) exp.name = patch.name.trim().slice(0, 80) || exp.name;
    if (patch.status) exp.status = patch.status;
    this.save();
    return exp;
  }

  remove(id: string) {
    this.data.experiments = this.data.experiments.filter((e) => e.id !== id);
    this.save();
  }

  dismissed(): ReadonlySet<string> {
    return new Set(this.data.dismissed);
  }

  dismiss(suggestionId: string) {
    if (!this.data.dismissed.includes(suggestionId)) this.data.dismissed.push(suggestionId);
    this.save();
  }

  /** RunExperiments: the bot as this goal's variant sees it. */
  forRun(bot: Bot, ctx: { goalId?: string; phase?: WorkPhase }): { bot: Bot; variants: Record<string, string> } | null {
    if (!ctx.goalId) return null;
    let current = bot;
    const variants: Record<string, string> = {};
    let changed = false;
    for (const exp of this.data.experiments) {
      if (exp.status !== 'running' || exp.botId !== bot.id) continue;
      if (exp.phase && exp.phase !== ctx.phase) continue;
      const variant = this.assign(exp, ctx.goalId);
      variants[exp.id] = variant.id;
      current = applyVariant(current, variant);
      changed = true;
    }
    return changed ? { bot: current, variants } : null;
  }

  private assign(exp: Experiment, goalId: string): ExperimentVariant {
    const existing = exp.assignments[goalId];
    const found = existing ? exp.variants.find((v) => v.id === existing) : undefined;
    if (found) return found;
    const counts = new Map(exp.variants.map((v) => [v.id, 0]));
    for (const v of Object.values(exp.assignments)) counts.set(v, (counts.get(v) ?? 0) + 1);
    const pick = [...exp.variants].sort((a, b) => counts.get(a.id)! - counts.get(b.id)!)[0]!;
    exp.assignments[goalId] = pick.id;
    this.save();
    return pick;
  }

  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }
}

/** The bot with a variant applied: skills added/removed, instructions appended. Pure. */
export function applyVariant(bot: Bot, v: ExperimentVariant): Bot {
  if (!v.addSkills.length && !v.removeSkills.length && !v.promptAppend) return bot;
  const remove = new Set(v.removeSkills);
  const skills = [...new Set([...bot.skills.filter((s) => !remove.has(s)), ...v.addSkills])];
  return {
    ...bot,
    skills,
    localSkills: bot.localSkills.filter((s) => !remove.has(s.name)),
    prompt: v.promptAppend ? `${bot.prompt}\n\n${v.promptAppend}` : bot.prompt,
  };
}

/** Compare variants on decided goals: success rate, cost and fix rounds, with a Fisher exact test. Pure. */
export function experimentResult(exp: Experiment, outcomes: (goalId: string) => GoalOutcome | undefined, minSamples: number): ExperimentResult {
  const rows: VariantResult[] = exp.variants.map((v) => {
    const goals = Object.entries(exp.assignments)
      .filter(([, vid]) => vid === v.id)
      .map(([gid]) => outcomes(gid));
    const decided = goals.filter((o) => o && outcomeLabel(o) !== 'pending') as GoalOutcome[];
    const successes = decided.filter((o) => outcomeLabel(o) === 'success').length;
    return {
      variantId: v.id,
      label: v.label,
      goals: decided.length,
      successes,
      pending: goals.length - decided.length,
      successRate: decided.length ? successes / decided.length : null,
      avgCostUsd: mean(decided.map((o) => o.costUsd)),
      avgReviewRounds: mean(decided.map((o) => o.reviewRounds)),
    };
  });
  const ready = rows.length >= 2 && rows.every((r) => r.goals >= minSamples);
  const [a, b] = rows;
  const pValue = ready && a && b ? fisherExact(a.successes, a.goals, b.successes, b.goals) : null;
  const winner = pValue !== null && pValue < 0.05 && a && b ? ((a.successRate ?? 0) > (b.successRate ?? 0) ? a.variantId : b.variantId) : null;
  const need = rows.reduce((t, r) => t + Math.max(0, minSamples - r.goals), 0);
  const summary = !ready
    ? `Needs ${need} more finished goal${need === 1 ? '' : 's'} (${minSamples} per variant) before comparing.`
    : winner
      ? `${rows.find((r) => r.variantId === winner)!.label} wins: ${pct(rows.find((r) => r.variantId === winner)!.successRate)} vs ${pct(rows.find((r) => r.variantId !== winner)!.successRate)} success (p = ${pValue!.toFixed(3)}).`
      : `No clear difference yet (p = ${pValue!.toFixed(2)}). Keep it running or stop it.`;
  return { experiment: exp, variants: rows, ready, minSamples, pValue, winner, summary };
}

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
