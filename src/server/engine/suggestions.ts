import { createHash } from 'node:crypto';
import { WorkPhase } from '../../shared/enums.js';
import type { Bot, CostEstimate, Goal, LedgerEntry, Settings, Skill, Suggestion } from '../../shared/types/index.js';
import { ProviderId, GoalStatus } from '../../shared/enums.js';
import { median } from './stats.js';
import type { RouteAttempt } from '../providers/router.js';

const STOP = new Set(
  'the a an and or of to in on for with is are was were be by it this that from at as not no run runs failed failure error errors bot task goal when then than into out up'.split(' '),
);
/** Crude stem so "migration" matches "migrations", "failing" matches "fails". */
const stem = (w: string) => w.replace(/(ings?|ions?|ed|es|s)$/, '') || w;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
const words = (s: string) => tokens(s).map(stem);

const id = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);

const MIN_RUNS = 5;
const FAIL_RATE = 0.3;

/**
 * Changes likely to help, from the ledger: a skill that matches what a bot keeps failing on, or a
 * cheaper model for a phase that almost always succeeds. Never applied without a click. Pure.
 */
export function suggest(o: { ledger: LedgerEntry[]; bots: Bot[]; skills: Skill[]; settings: Settings; dismissed: ReadonlySet<string> }): Suggestion[] {
  const out: Suggestion[] = [];

  // 1. Bots that fail often → a library skill whose name/description matches their failures.
  for (const bot of o.bots) {
    const rows = o.ledger.filter((r) => r.botId === bot.id && !r.aborted);
    if (rows.length < MIN_RUNS) continue;
    const failed = rows.filter((r) => !r.ok);
    if (failed.length / rows.length < FAIL_RATE) continue;
    const errorWords = new Map<string, number>();
    /** Stem → a word as it appeared, for the explanation. */
    const shown = new Map<string, string>();
    for (const r of failed) {
      for (const t of tokens(r.error ?? '')) if (!shown.has(stem(t))) shown.set(stem(t), t);
      for (const w of new Set(words(r.error ?? ''))) errorWords.set(w, (errorWords.get(w) ?? 0) + 1);
    }
    let best: { skill: Skill; score: number; hits: string[] } | null = null;
    for (const skill of o.skills) {
      if (bot.skills.includes(skill.name)) continue;
      const vocab = new Set(words(`${skill.name} ${skill.description ?? ''}`));
      const hits = [...errorWords.keys()].filter((w) => vocab.has(w));
      const score = hits.reduce((t, w) => t + errorWords.get(w)!, 0);
      if (score > 0 && (!best || score > best.score)) best = { skill, score, hits };
    }
    if (!best) continue;
    const sid = id('add-skill', bot.id, best.skill.name);
    if (o.dismissed.has(sid)) continue;
    out.push({
      id: sid,
      kind: 'add-skill',
      title: `Give ${bot.name} the ${best.skill.name} skill`,
      why: `${bot.name} failed ${failed.length} of ${rows.length} runs; the failures mention ${best.hits.slice(0, 3).map((h) => shown.get(h) ?? h).join(', ')}, which ${best.skill.name} covers.`,
      botId: bot.id,
      skill: best.skill.name,
      evidence: { runs: rows.length, failures: failed.length, costUsd: round(rows.reduce((t, r) => t + r.costUsd, 0)) },
    });
  }

  // 2. Expensive phases that nearly always succeed on an Opus-class model → try Sonnet.
  for (const phase of [WorkPhase.Planning, WorkPhase.Build, WorkPhase.Security, WorkPhase.Testing, WorkPhase.Reporting]) {
    const rows = o.ledger.filter((r) => r.phase === phase && !r.aborted && (r.provider ?? ProviderId.Claude) === ProviderId.Claude);
    if (rows.length < 10) continue;
    const opus = rows.filter((r) => /opus|fable/i.test(r.model));
    if (opus.length < 10) continue;
    const ok = opus.filter((r) => r.ok).length / opus.length;
    const med = median(opus.map((r) => r.costUsd)) ?? 0;
    const current = (o.settings.models as Record<string, { model?: string } | undefined>)[phase]?.model;
    if (ok < 0.9 || med < 0.5 || (current && !/opus|fable/i.test(current))) continue;
    const sid = id('cheaper-model', phase);
    if (o.dismissed.has(sid)) continue;
    out.push({
      id: sid,
      kind: 'cheaper-model',
      title: `Try Sonnet for ${phase}`,
      why: `${Math.round(ok * 100)}% of ${opus.length} ${phase} runs succeed on ${opus[0]!.model} at a median ${usd(med)} each. A smaller model may do as well for less. You can switch back in Settings → General.`,
      phase,
      model: 'sonnet',
      evidence: { runs: opus.length, failures: opus.filter((r) => !r.ok).length, costUsd: round(opus.reduce((t, r) => t + r.costUsd, 0)) },
    });
  }
  return out;
}

const GOAL_PHASES = [WorkPhase.Planning, WorkPhase.Build, WorkPhase.Security, WorkPhase.Testing, WorkPhase.Reporting] as const;

/**
 * Likely cost of a goal with the current routing: per phase, the median of what that phase cost in
 * finished goals on the same provider+model (else the same provider, else any). Pure.
 */
export function estimateGoalCost(o: { ledger: LedgerEntry[]; goals: Goal[]; routeFor: (phase: WorkPhase) => RouteAttempt }): CostEstimate {
  const finished = new Set(o.goals.filter((g) => g.status === GoalStatus.Done).map((g) => g.id));
  // goal → phase → { provider, model, cost }
  const perGoalPhase = new Map<string, { provider: string; model: string; cost: number }>();
  for (const r of o.ledger) {
    if (!r.goalId || !r.phase || !finished.has(r.goalId)) continue;
    const k = `${r.goalId}\u0000${r.phase}`;
    const cur = perGoalPhase.get(k) ?? { provider: r.provider ?? ProviderId.Claude, model: r.model, cost: 0 };
    cur.cost += r.costUsd;
    perGoalPhase.set(k, cur);
  }
  const samples = (phase: string) => [...perGoalPhase.entries()].filter(([k]) => k.endsWith(`\u0000${phase}`)).map(([, v]) => v);
  const phases = GOAL_PHASES.map((phase) => {
    const route = o.routeFor(phase);
    const all = samples(phase);
    const exact = all.filter((s) => s.provider === route.provider && route.model && s.model.includes(route.model));
    const sameProvider = all.filter((s) => s.provider === route.provider);
    const [basis, pool] = exact.length >= 3 ? (['exact', exact] as const) : sameProvider.length >= 3 ? (['provider', sameProvider] as const) : all.length ? (['any', all] as const) : (['none', []] as const);
    const m = median(pool.map((s) => s.cost));
    return { phase, provider: route.provider, model: route.model, medianUsd: m === null ? null : round(m), samples: pool.length, basis };
  });
  const known = phases.filter((p) => p.medianUsd !== null);
  return { totalUsd: known.length ? round(known.reduce((t, p) => t + p.medianUsd!, 0)) : null, phases, goals: finished.size };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const usd = (n: number) => `$${n.toFixed(2)}`;
