/** When a schedule runs: once at a time, or repeating (cron, local time). */
export type ScheduleWhen = { type: 'once'; at: string } | { type: 'cron'; cron: string; label: string };

/** What a schedule or trigger does when it fires. */
export type AutomationAction =
  | {
      type: 'goal';
      brief: string;
      title?: string;
      templateId?: string;
      fields?: Record<string, string>;
      budgetUsd?: number;
      /** Approve the plan automatically and build (default: stop at plan approval). */
      autoBuild?: boolean;
    }
  | { type: 'message'; botId: string; text: string }
  | { type: 'handoff'; source: 'github' | 'sentry' | 'linear' | 'jira'; ids: string[]; botId?: string; note?: string };

/** Where automation runs. Only this machine for now. */
export type AutomationRunner = 'local' | 'cloud';

/**
 * personal: `.agentroom/runs/*.json`, only on this machine.
 * team: `.agentroom/*.json` (committed); runs only on its owner's machine (later: the cloud runner).
 */
export type AutomationScope = 'personal' | 'team';

export interface AutomationOwner {
  name: string;
  email: string;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  when: ScheduleWhen;
  action: AutomationAction;
  runner: AutomationRunner;
  createdAt: string;
  createdBy?: string;
  /** Where it's saved (computed from the file it lives in). */
  scope?: AutomationScope;
  /** Team items: whose machine runs it. */
  owner?: AutomationOwner;
}

export type TriggerWhen =
  | { source: 'sentry'; event: 'new_issue'; level?: 'fatal' | 'error' | 'warning'; project?: string }
  | { source: 'github'; event: 'card_moved'; toColumn: string }
  | { source: 'goal'; event: 'failed' }
  | { source: 'linear' | 'jira'; event: 'issue_moved'; toState: string };

export interface TriggerThen {
  type: 'handoff' | 'goal' | 'message' | 'notify';
  botId?: string;
  /** Stop after the plan and wait for the human (default true). */
  planOnly: boolean;
  channel?: 'inbox' | 'slack' | 'teams';
  /** For goal/message actions: what to ask. `{title}` and `{url}` are filled from the event. */
  text?: string;
}

export interface TriggerLimits {
  maxRunsPerDay: number;
  budgetUsd?: number;
  quietHours?: { from: string; to: string };
}

export interface Trigger {
  id: string;
  name: string;
  enabled: boolean;
  when: TriggerWhen;
  then: TriggerThen;
  limits: TriggerLimits;
  runner: AutomationRunner;
  createdAt: string;
  createdBy?: string;
  /** Where it's saved (computed from the file it lives in). */
  scope?: AutomationScope;
  /** Team items: whose machine runs it. */
  owner?: AutomationOwner;
}

export type AutomationOutcome = 'started' | 'skipped' | 'failed';

export interface AutomationRun {
  id: string;
  kind: 'schedule' | 'trigger' | 'digest';
  refId: string;
  name: string;
  startedAt: string;
  outcome: AutomationOutcome;
  goalId?: string;
  reason?: string;
  costUsd?: number;
}

/** A schedule with its computed state. */
export interface ScheduleView extends Schedule {
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastOutcome?: AutomationOutcome;
  /** Who it acts as (bot id), for display. */
  botId?: string;
  /** This machine runs it (personal, or a team item owned by the current git user). */
  runsHere: boolean;
}

export interface TriggerView extends Trigger {
  /** This machine runs it (personal, or a team item owned by the current git user). */
  runsHere: boolean;
  runsToday: number;
  lastRunAt: string | null;
  lastOutcome?: AutomationOutcome;
}

export interface NextRun {
  id: string;
  name: string;
  at: string;
}

/** Pushed to the UI (StateType.Automation). */
export interface AutomationSnapshot {
  schedules: ScheduleView[];
  triggers: TriggerView[];
  history: AutomationRun[];
  next: NextRun | null;
  /** Failed runs since the human last looked (sidebar badge). */
  failedSinceSeen: number;
}

export interface TimeParse {
  /** First run (ISO), or null when nothing time-like was found. */
  at: string | null;
  /** The exact words that mean the time, as they appear in the text. */
  phrase: string | null;
  recurring: { cron: string; label: string } | null;
  /** The text without the time phrase. */
  rest: string;
}

export interface RunnerStatus {
  platform: string;
  /** Background mode is available on this OS. */
  supported: boolean;
  installed: boolean;
  running: boolean;
  /** This server was started by background mode. */
  isDaemon: boolean;
  label: string;
  logFile: string;
  port: number;
}

export interface BriefItem {
  kind: 'pr' | 'approval' | 'question' | 'plan' | 'paused' | 'failed' | 'done' | 'automation';
  label: string;
  /** In-app hash route, e.g. "#/work/G-4". */
  href: string;
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}

export interface Brief {
  since: string;
  until: string;
  goalsDone: number;
  goalsFailed: number;
  prsOpened: number;
  waiting: number;
  spentUsd: number;
  dailyCapUsd?: number;
  automationRuns: number;
  items: BriefItem[];
}
