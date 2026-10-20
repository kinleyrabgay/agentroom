/**
 * Zod schemas for everything AgentRoom reads from disk. Domain types are inferred from these,
 * so the files on disk and the TypeScript types can't drift apart.
 */
import { z } from 'zod';
import { DEFAULT_MODEL, DEFAULT_PORT } from './constants.js';
import { EffortLevel, GoalStatus, PermissionMode, ProviderId, SecurityReviewMode, TaskKind, TaskStatus, ToolName } from './enums.js';

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

export const BotFrontmatterSchema = z.object({
  name: z.string().min(1),
  role: z.string().default('custom'),
  color: z.string().default('#64748b'),
  avatar: z.string().default('🤖'),
  /** Provider model alias or id (e.g. "sonnet", "claude-opus-5-5"). Unset = project default. */
  model: z.string().optional(),
  /** Reasoning effort. Unset = project default (or the model's default). */
  effort: z.enum(values(EffortLevel)).optional(),
  reportsTo: z.string().optional(),
  tools: z.array(z.string()).default([ToolName.Read, ToolName.Grep, ToolName.Glob]),
  /** Library skills assigned to this bot (names in `.agentroom/skills/`). */
  skills: z.array(z.string()).default([]),
});

export const SkillFrontmatterSchema = z.object({
  name: z.string().optional(),
  description: z.string().default(''),
});

export const TaskStatusSchema = z.enum(values(TaskStatus));

export const AcceptanceItemSchema = z.object({ text: z.string(), done: z.boolean().default(false) });
export const TaskLogEntrySchema = z.object({ ts: z.string(), by: z.string(), text: z.string() });

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(values(TaskKind)).default(TaskKind.Dev),
  status: TaskStatusSchema.default(TaskStatus.Todo),
  /** Goal this task belongs to (G-n); unset for standalone tasks. */
  goalId: z.string().optional(),
  /** Execution order within the goal (ascending). */
  order: z.number().default(0),
  assignee: z.string().optional(),
  /** Markdown: what to do and why, written by the Planner, editable by the human. */
  description: z.string().default(''),
  /** Definition of done. */
  acceptance: z.array(AcceptanceItemSchema).default([]),
  /** Files/areas expected to change. */
  files: z.array(z.string()).default([]),
  /** Task ids that must be done first. */
  dependsOn: z.array(z.string()).default([]),
  /** Set when the assignee can't continue without the human. */
  blockedReason: z.string().optional(),
  /** Free-form notes (legacy + bot hand-off notes). */
  notes: z.string().default(''),
  /** Progress notes appended by bots and the engine. */
  log: z.array(TaskLogEntrySchema).default([]),
  createdBy: z.string().default('human'),
  /** Checkpoint commits of this task in the goal's branch (oldest first). */
  commits: z.array(z.string()).default([]),
  /** The task's commits were reverted by the human. */
  reverted: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GoalSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** What the human asked for, verbatim. */
  brief: z.string(),
  status: z.enum(values(GoalStatus)).default(GoalStatus.Planning),
  /** Planner's overview of the approach (markdown). */
  plan: z.string().default(''),
  /** Team Lead's final report (markdown). */
  summary: z.string().default(''),
  /** Human feedback for re-planning. */
  feedback: z.string().optional(),
  /** Where the goal came from (e.g. GitHub cards handed off to the Team Lead). */
  sources: z
    .array(
      z.discriminatedUnion('type', [
        z.object({
          type: z.literal('github'),
          itemId: z.string(),
          url: z.string().optional(),
          number: z.number().optional(),
          repo: z.string().optional(),
          title: z.string(),
        }),
        z.object({
          type: z.literal('sentry'),
          itemId: z.string(),
          shortId: z.string(),
          url: z.string().optional(),
          project: z.string().optional(),
          title: z.string(),
        }),
      ]),
    )
    .default([]),
  /** Security review for this goal: auto (risk-based), always, or off. */
  securityReview: z.enum(values(SecurityReviewMode)).default(SecurityReviewMode.Auto),
  /** Commit the goal started from (diffs, risk and scans are relative to it). */
  baseRef: z.string().optional(),
  /** Latest risk assessment of the goal's diff. */
  risk: z
    .object({
      score: z.number(),
      level: z.enum(['low', 'medium', 'high']),
      factors: z.array(z.object({ label: z.string(), points: z.number() })),
      files: z.number(),
      additions: z.number(),
      deletions: z.number(),
      computedAt: z.string(),
    })
    .optional(),
  /** Round in which the security review last completed (re-reviewed after each fix round). */
  securityReviewedRound: z.number().optional(),
  /** The human approved a high-risk diff at this score (re-asked if the score grows). */
  riskApproval: z.object({ score: z.number(), at: z.string(), by: z.string() }).optional(),
  /** Upload ids attached to the brief (screenshots, specs). Given to the Planner and listed for every bot. */
  attachments: z.array(z.string()).default([]),
  /** Goal template it was started from (e.g. "bug-fix"). */
  template: z.object({ id: z.string(), name: z.string() }).optional(),
  /** Template guidance for the Planner (how to approach this kind of goal). */
  guidance: z.string().optional(),
  /** Build/test rounds completed (bug-fix loops). */
  round: z.number().default(0),
  /** Why the goal paused/failed. */
  reason: z.string().optional(),
  /** When the human approved the plan; unset until then. */
  approvedAt: z.string().optional(),
  /** The goal's own git branch and folder (a worktree), so bots never touch the human's working copy. */
  worktree: z.object({ path: z.string(), branch: z.string() }).optional(),
  /** Why the goal runs in the project root instead of its own folder (git missing, worktree failed…). */
  worktreeWarning: z.string().optional(),
  /** Inline review comments on the goal's diff (Changes tab). */
  reviewComments: z
    .array(
      z.object({
        id: z.string(),
        file: z.string(),
        line: z.number().optional(),
        body: z.string(),
        author: z.string(),
        createdAt: z.string(),
        resolved: z.boolean().default(false),
        /** Sent to the Developer as a fix round. */
        sent: z.boolean().default(false),
      }),
    )
    .default([]),
  /** Pull request opened for this goal. */
  pr: z.object({ url: z.string(), number: z.number().optional() }).optional(),
  /** Per-goal spend cap (USD); overrides settings.budgets.perGoalUsd. */
  budgetUsd: z.number().positive().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** runs/board.json (was tasks/board.json) — v2 holds goals and tasks; v1 was a bare task array. */
export const BoardSchema = z.object({
  version: z.literal(2).default(2),
  goals: z.array(GoalSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
});

export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  provider: z.enum(values(ProviderId)).default(ProviderId.Claude),
  model: z.string().default(DEFAULT_MODEL),
  effort: z.enum(values(EffortLevel)).optional(),
  port: z.number().int().default(DEFAULT_PORT),
  permissionMode: z.enum(values(PermissionMode)).default(PermissionMode.AskWrites),
  /** Bash command prefixes that always require human approval. */
  alwaysAsk: z.array(z.string()).default([]),
});

const PhaseModel = z.object({ model: z.string().optional(), effort: z.enum(values(EffortLevel)).optional() });

/** `.agentroom/settings.json` — team-wide, committed. Every field has a default so older files keep working. */
export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  /** Model/effort per workflow phase; unset = bot's own setting, then project default. */
  models: z
    .object({
      planning: PhaseModel.default({}),
      build: PhaseModel.default({}),
      security: PhaseModel.default({}),
      testing: PhaseModel.default({}),
      reporting: PhaseModel.default({}),
    })
    .default({ planning: {}, build: {}, security: {}, testing: {}, reporting: {} }),
  budgets: z
    .object({
      /** USD per goal; null = no cap. */
      perGoalUsd: z.number().positive().nullable().default(null),
      /** USD per calendar day across all bots; null = no cap. */
      perDayUsd: z.number().positive().nullable().default(null),
      /** Warn at this fraction of a cap. */
      warnAt: z.number().min(0.1).max(1).default(0.8),
    })
    .default({ perGoalUsd: null, perDayUsd: null, warnAt: 0.8 }),
  security: z
    .object({
      review: z.enum(values(SecurityReviewMode)).default(SecurityReviewMode.Auto),
      /** Findings at or above this severity block commits/PRs until approved. */
      blockOn: z.enum(['critical', 'warning', 'none']).default('critical'),
      /** High risk adds approval gates before Test and before the PR. */
      riskGates: z.boolean().default(true),
      /** Paths that always trigger the security step (globs). */
      sensitivePaths: z
        .array(z.string())
        .default(['**/auth/**', '**/*auth*', '**/payment*/**', '**/billing/**', '**/migrations/**', '**/*.sql', '**/.env*', '**/secrets/**']),
    })
    // prefault: run the inner defaults (incl. the sensitive-path list) when the section is missing.
    .prefault({}),
  worktrees: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  audit: z.object({ retentionDays: z.number().int().min(1).default(90) }).default({ retentionDays: 90 }),
  /** Daily summary sent to Slack/Teams webhooks (stored in local secrets). */
  digest: z
    .object({
      enabled: z.boolean().default(false),
      /** Local time, "HH:MM". */
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:30'),
      channels: z.array(z.enum(['slack', 'teams'])).default(['slack']),
    })
    .prefault({}),
  /** Repo context: the module map and cards bots read instead of exploring. */
  context: z
    .object({
      enabled: z.boolean().default(true),
      /** Update the map and rewrite out-of-date cards after a goal finishes. */
      autoSync: z.boolean().default(true),
      /** Model that writes module cards. */
      cardModel: z.string().min(1).default('claude-haiku-4-5-20251001'),
      /** Cards written per sync at most (cost control). */
      maxCardsPerSync: z.number().int().min(1).max(500).default(12),
    })
    .prefault({}),
});

/** MCP server names become tool prefixes (`mcp__<name>__…`), so keep them simple. */
export const MCP_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const stringMap = z.record(z.string(), z.string());

/** One server in mcp.json: Claude Code's `.mcp.json` fields plus AgentRoom's (bots, enabled, description, preset). */
export const McpFileEntrySchema = z
  .object({
    type: z.enum(['stdio', 'http', 'sse', 'claudeai-proxy']).optional(),
    url: z.string().url().optional(),
    id: z.string().optional(),
    headers: stringMap.optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: stringMap.optional(),
    bots: z.array(z.string()).default(['*']),
    enabled: z.boolean().default(true),
    description: z.string().optional(),
    preset: z.string().optional(),
  })
  .refine((e) => (e.type === 'stdio' || (!e.type && e.command) ? !!e.command : !!e.url), {
    message: 'needs "command" (stdio) or "url" (http, sse)',
  })
  .refine((e) => e.type !== 'claudeai-proxy' || !!e.id, { message: 'claudeai-proxy needs "id"' });

export const McpFileSchema = z.object({
  servers: z.record(z.string().regex(MCP_NAME, 'letters, digits, - and _ only'), McpFileEntrySchema).default({}),
});

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM');
const RunnerSchema = z.enum(['local', 'cloud']).default('local');

export const AutomationActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goal'),
    brief: z.string().min(1, 'Describe the goal'),
    title: z.string().optional(),
    templateId: z.string().optional(),
    fields: z.record(z.string(), z.string()).optional(),
    budgetUsd: z.number().positive().optional(),
    autoBuild: z.boolean().optional(),
  }),
  z.object({ type: z.literal('message'), botId: z.string().min(1), text: z.string().min(1, 'Write the message') }),
  z.object({
    type: z.literal('handoff'),
    source: z.enum(['github', 'sentry']),
    ids: z.array(z.string()).min(1, 'Pick at least one item'),
    botId: z.string().optional(),
    note: z.string().optional(),
  }),
]);

export const ScheduleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  when: z.discriminatedUnion('type', [
    z.object({ type: z.literal('once'), at: z.string().datetime({ offset: true }) }),
    z.object({ type: z.literal('cron'), cron: z.string().min(9), label: z.string() }),
  ]),
  action: AutomationActionSchema,
  runner: RunnerSchema,
  createdAt: z.string(),
  createdBy: z.string().optional(),
  owner: z.object({ name: z.string(), email: z.string() }).optional(),
});
export const SchedulesFileSchema = z.object({ schedules: z.array(ScheduleSchema).default([]) });

export const TriggerSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  when: z.discriminatedUnion('source', [
    z.object({ source: z.literal('sentry'), event: z.literal('new_issue'), level: z.enum(['fatal', 'error', 'warning']).optional(), project: z.string().optional() }),
    z.object({ source: z.literal('github'), event: z.literal('card_moved'), toColumn: z.string().min(1) }),
    z.object({ source: z.literal('goal'), event: z.literal('failed') }),
  ]),
  then: z.object({
    type: z.enum(['handoff', 'goal', 'message', 'notify']),
    botId: z.string().optional(),
    planOnly: z.boolean().default(true),
    channel: z.enum(['inbox', 'slack', 'teams']).optional(),
    text: z.string().optional(),
  }),
  limits: z
    .object({
      maxRunsPerDay: z.number().int().min(1).max(100).default(3),
      budgetUsd: z.number().positive().optional(),
      quietHours: z.object({ from: HHMM, to: HHMM }).optional(),
    })
    .prefault({}),
  runner: RunnerSchema,
  createdAt: z.string(),
  createdBy: z.string().optional(),
  owner: z.object({ name: z.string(), email: z.string() }).optional(),
});
export const TriggersFileSchema = z.object({ triggers: z.array(TriggerSchema).default([]) });
