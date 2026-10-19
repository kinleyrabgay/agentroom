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
      z.object({
        type: z.literal('github'),
        itemId: z.string(),
        url: z.string().optional(),
        number: z.number().optional(),
        repo: z.string().optional(),
        title: z.string(),
      }),
    )
    .default([]),
  /** Build/test rounds completed (bug-fix loops). */
  round: z.number().default(0),
  /** Why the goal paused/failed. */
  reason: z.string().optional(),
  /** When the human approved the plan; unset until then. */
  approvedAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** tasks/board.json — v2 holds goals and tasks; v1 was a bare task array. */
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
    .default({ review: SecurityReviewMode.Auto, blockOn: 'critical', riskGates: true, sensitivePaths: [] }),
  worktrees: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
  audit: z.object({ retentionDays: z.number().int().min(1).default(90) }).default({ retentionDays: 90 }),
});
