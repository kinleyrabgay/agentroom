/** What a stretch of a goal's timeline was: drives the segment colour. */
export type TimelineKind = 'planning' | 'working' | 'testing' | 'waiting' | 'error' | 'security' | 'reporting';

export interface TimelineSegment {
  /** Epoch ms. */
  start: number;
  end: number;
  kind: TimelineKind;
  label: string;
  /** Spend of the run this segment stands for (spread over its length for the running total). */
  costUsd?: number;
}

export interface TimelineLane {
  /** A bot id, or "human" for time spent waiting on the human. */
  botId: string;
  segments: TimelineSegment[];
}

export type TimelineMarkerKind = 'approval' | 'checkpoint' | 'delegation' | 'failure' | 'pr';

export interface TimelineMarker {
  ts: number;
  kind: TimelineMarkerKind;
  label: string;
}

/** A notable moment for the scrubber's detail list. */
export interface TimelineEvent {
  ts: number;
  botId?: string;
  kind: 'tool' | 'approval_asked' | 'approval' | 'delegation' | 'run_done' | 'error';
  text: string;
}

/** GET /goals/:id/timeline */
export interface GoalTimeline {
  goalId: string;
  start: number;
  end: number;
  totalCostUsd: number;
  lanes: TimelineLane[];
  markers: TimelineMarker[];
  events: TimelineEvent[];
}

export type InsightsPeriod = '7d' | '30d' | '90d';

/** GET /insights?period= */
export interface Insights {
  period: InsightsPeriod;
  /** ISO start of the period. */
  since: string;
  goalsFinished: number;
  goalsFailed: number;
  /** Share of finished goals that never paused, asked a question or got a denial (0–100). */
  finishedWithoutHelpPct: number | null;
  spendUsd: number;
  spendPerGoal: number | null;
  /** One row per day of the period, oldest first (local dates, YYYY-MM-DD). */
  dailySpend: { date: string; usd: number }[];
  dailyCapUsd?: number;
  /** Median time from "needs approval" to the human's answer (permissions and plan reviews). */
  approvalWaitMedianMs: number | null;
  prsOpened?: number;
  prsMerged?: number;
  perBot: { botId: string; runs: number; successRate: number; costUsd: number; avgDurationMs: number }[];
  failureReasons: { reason: string; count: number }[];
  skills: { skill: string; runs: number; successRate: number }[];
}
