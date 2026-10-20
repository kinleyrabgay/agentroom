import type { WorkPhase } from '../enums.js';

/** What a provider guarantees about approvals, shown in Settings → Providers. */
export interface ProviderGuarantees {
  /** AgentRoom asks you before each risky shell command / file write. */
  perCommandApproval: boolean;
  /** Where writes and commands are confined when AgentRoom can't approve them one by one. */
  sandbox: string;
  /** AgentRoom's own tools (tasks, delegation, ask_human…) are available and keep their gates. */
  hostTools: boolean;
  /** Chats continue across runs (session resume). */
  resume: boolean;
  /** Spend is reported exactly (true) or estimated from tokens (false). */
  exactCost: boolean;
  notes: string[];
}

export type ProviderAuth = 'ok' | 'missing' | 'unknown';

/** GET /api/engine/providers: one row per provider. */
export interface ProviderStatus {
  id: string;
  name: string;
  /** Installed / reachable on this machine. */
  available: boolean;
  version?: string;
  auth: ProviderAuth;
  /** Not verified end to end against the real service yet. */
  experimental: boolean;
  /** Why it isn't available, or what to do. */
  hint?: string;
  guarantees: ProviderGuarantees;
  /** Known model ids (free text is allowed too). */
  models: string[];
  /** For openai-compat: an API key is stored in runs/secrets.json. */
  hasKey?: boolean;
}

/** One step of a phase's route: the provider and model a run uses, in fallback order. */
export interface RouteStep {
  provider: string;
  model?: string;
}

/** GET /api/engine/estimate: what a goal is likely to cost with the current routing. */
export interface CostEstimate {
  /** Sum of the per-phase medians (USD); null when there's no history at all. */
  totalUsd: number | null;
  phases: { phase: WorkPhase; provider: string; model: string; medianUsd: number | null; samples: number; basis: 'exact' | 'provider' | 'any' | 'none' }[];
  /** Finished goals the estimate is built from. */
  goals: number;
}

// ---- Learning loop ----

/** What happened to a goal after it finished. Derived (gh read-only, git log); stored in runs/outcomes.json. */
export interface GoalOutcome {
  goalId: string;
  /** done / failed / cancelled at the time of the check. */
  status: string;
  prState?: 'open' | 'merged' | 'closed';
  mergedAt?: string;
  /** A later commit reverted the goal's merge. */
  reverted?: boolean;
  /** Fix rounds after the first build (review / QA loops). */
  reviewRounds: number;
  costUsd: number;
  checkedAt: string;
}

/** A goal is a success when it finished, its PR (if any) wasn't closed unmerged, and it wasn't reverted. */
export type OutcomeLabel = 'success' | 'failure' | 'pending';

export interface ExperimentVariant {
  id: string;
  label: string;
  /** Skills added to the bot for runs in this variant. */
  addSkills: string[];
  /** Skills removed from the bot for runs in this variant. */
  removeSkills: string[];
  /** Extra instructions appended to the bot's prompt. */
  promptAppend: string;
}

/** A/B test of skills or prompt changes on one bot. Local (`runs/experiments.json`). */
export interface Experiment {
  id: string;
  name: string;
  botId: string;
  /** Limit to one phase; unset = every run of the bot inside goals. */
  phase?: WorkPhase;
  /** Usually two: the control (no changes) and the change. */
  variants: ExperimentVariant[];
  status: 'running' | 'stopped';
  createdAt: string;
  /** goalId → variantId; a goal keeps its variant for every run. */
  assignments: Record<string, string>;
}

export interface VariantResult {
  variantId: string;
  label: string;
  goals: number;
  successes: number;
  pending: number;
  successRate: number | null;
  avgCostUsd: number | null;
  avgReviewRounds: number | null;
}

/** GET /api/engine/experiments: each experiment with its comparison. */
export interface ExperimentResult {
  experiment: Experiment;
  variants: VariantResult[];
  /** Enough decided goals in every variant to compare. */
  ready: boolean;
  minSamples: number;
  /** Two-sided p-value of the success-rate difference (first two variants), when ready. */
  pValue: number | null;
  /** Variant that wins at p < 0.05, if any. */
  winner: string | null;
  summary: string;
}

/** A change the engine thinks would help. Applied only when the human clicks. */
export interface Suggestion {
  id: string;
  kind: 'add-skill' | 'cheaper-model' | 'start-experiment';
  title: string;
  why: string;
  botId?: string;
  phase?: WorkPhase;
  skill?: string;
  model?: string;
  /** Runs the suggestion is based on. */
  evidence: { runs: number; failures: number; costUsd: number };
}

/** A replay eval: the plan step of a past goal re-run with a change, side by side with the original. */
export interface EvalRun {
  id: string;
  goalId: string;
  goalTitle: string;
  botId: string;
  variant: ExperimentVariant;
  provider: string;
  model: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  /** The plan the goal actually used. */
  original: string;
  /** The plan the changed bot wrote. */
  output: string;
  costUsd: number;
  error?: string;
}
