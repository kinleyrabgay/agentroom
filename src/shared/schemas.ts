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

/** Incident autopilot: a goal started from a Sentry issue that must reproduce, fail first, then pass. */
export const GoalAutopilotSchema = z.object({
  source: z.literal('sentry'),
  issueId: z.string(),
  shortId: z.string(),
  title: z.string(),
  permalink: z.string().optional(),
  triggerId: z.string().optional(),
  /** The trigger allows opening the PR without a human (still needs settings.autopilot.allowAutoPr and enough confidence). */
  autoPr: z.boolean().default(false),
  status: z.enum(['reproducing', 'reproduced', 'not_reproduced', 'needs_human', 'verified', 'unverified', 'pr_opened', 'ready']).default('reproducing'),
  /** Reported by the bot (autopilot_report). */
  reproduced: z.boolean().optional(),
  how: z.string().optional(),
  test: z.object({ file: z.string(), command: z.string() }).optional(),
  /** Measured by AgentRoom: the test fails on the starting commit and passes on the goal's branch. */
  verification: z
    .object({
      failsOnBase: z.boolean().nullable(),
      passesOnHead: z.boolean().nullable(),
      at: z.string(),
      detail: z.string().optional(),
    })
    .optional(),
  confidence: z
    .object({
      score: z.number(),
      at: z.string(),
      factors: z.array(z.object({ label: z.string(), points: z.number(), max: z.number(), ok: z.boolean().nullable(), detail: z.string().optional() })),
    })
    .optional(),
});

/** "Implement design" goals: the design the Verify step compares the page against. */
export const GoalDesignSchema = z.object({
  source: z.enum(['figma', 'upload']),
  figmaUrl: z.string().optional(),
  fileKey: z.string().optional(),
  nodeId: z.string().optional(),
  /** Upload id of the design image (uploads, or the Figma export once fetched). */
  uploadId: z.string().optional(),
  /** Page to compare ("/pricing"). */
  path: z.string().default('/'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
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
        z.object({
          type: z.literal('issue'),
          tracker: z.enum(['linear', 'jira']),
          itemId: z.string(),
          key: z.string(),
          url: z.string().optional(),
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
  /** Last proof-of-work run (Verify phase); the full report is in runs/proof/<id>/. */
  proof: z
    .object({
      round: z.number(),
      status: z.enum(['passed', 'failed', 'skipped', 'error']),
      at: z.string(),
      summary: z.string(),
      failing: z.array(z.string()).default([]),
      gif: z.boolean().optional(),
    })
    .optional(),
  /** The human approved failing quality checks for this round. */
  proofOverride: z.object({ round: z.number(), at: z.string(), by: z.string() }).optional(),
  /** Incident autopilot (Sentry → reproduce → failing test → fix → verify). */
  autopilot: GoalAutopilotSchema.optional(),
  /** Design to match (Implement design goals). */
  design: GoalDesignSchema.optional(),
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

/** One step of a fallback chain: another provider (and model) to try when the first can't run. */
const RouteStep = z.object({ provider: z.enum(values(ProviderId)), model: z.string().optional() });
const PhaseModel = z.object({
  model: z.string().optional(),
  effort: z.enum(values(EffortLevel)).optional(),
  /** Provider for this phase; unset = the project's provider (config.json). */
  provider: z.enum(values(ProviderId)).optional(),
  /** Tried in order when the run fails before doing anything (rate limit, outage, not installed). */
  fallbacks: z.array(RouteStep).max(4).optional(),
});

/** Registries Browse skills searches out of the box. The AgentRoom index is off until it's published. */
export const DEFAULT_REGISTRIES = [
  { id: 'agentroom', name: 'AgentRoom', kind: 'index' as const, url: 'https://raw.githubusercontent.com/kinleyrabgay/agentroom-registry/main/index.json', enabled: false },
  { id: 'skills-sh', name: 'skills.sh', kind: 'skills-sh' as const, url: 'https://skills.sh', enabled: true },
];

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
  /** Proof of work: the Verify phase records the feature working in a headless browser. */
  proof: z
    .object({
      enabled: z.boolean().default(true),
      /** "branch": push images to the agentroom/proof branch so the PR can show them; "local": keep them here. */
      publish: z.enum(['branch', 'local']).default('branch'),
      /** Command that serves the app (default: detected from package.json, e.g. `npm run dev`). */
      devCommand: z.string().default(''),
      /** Use an app that's already running instead of starting one (e.g. http://localhost:3000). */
      url: z.string().default(''),
      /** Also screenshot the same pages on the goal's starting commit. */
      before: z.boolean().default(true),
      /** Give up on starting the app after this many seconds. */
      startTimeoutSec: z.number().int().min(10).max(600).default(90),
      /** Elements blurred in screenshots (CSS selectors). */
      mask: z.array(z.string()).default(['input[type=password]', '[data-secret]', '[data-proof-mask]']),
    })
    .prefault({}),
  /** Quality checks run in the Verify phase. Failing checks pause the goal (override with Resume). */
  quality: z
    .object({
      /** Pause the goal when a check fails. */
      gate: z.boolean().default(true),
      a11y: z.boolean().default(true),
      /** New accessibility issues allowed compared with the starting commit. */
      maxNewA11yIssues: z.number().int().min(0).default(0),
      perf: z.boolean().default(true),
      /** Largest Contentful Paint warning threshold (dev server, so a warning only). */
      maxLcpMs: z.number().int().min(100).default(4000),
      visual: z.boolean().default(true),
      /** Pages that changed more than this (percent of pixels) are flagged for a look. */
      maxVisualDiffPct: z.number().min(0).max(100).default(40),
      coverage: z.boolean().default(false),
      /** Command that writes coverage/coverage-summary.json or lcov.info (e.g. `npx vitest run --coverage`). */
      coverageCommand: z.string().default(''),
      /** Line coverage may drop at most this many points. */
      maxCoverageDrop: z.number().min(0).max(100).default(1),
      bundle: z.boolean().default(false),
      buildCommand: z.string().default(''),
      /** Build output folder to measure (default: detected, e.g. dist, .next/static, build). */
      bundleDir: z.string().default(''),
      maxBundleGrowthPct: z.number().min(0).default(10),
      /** Compare the page with the design reference (Implement design goals). */
      design: z.boolean().default(true),
      /** Design match score (0–100) below which the check fails. */
      minDesignMatch: z.number().min(0).max(100).default(70),
    })
    .prefault({}),
  /** Incident autopilot (Sentry triggers with "Autopilot"). */
  autopilot: z
    .object({
      /** Allow autopilot to open a PR without a human. Off by default: it always stops for you. */
      allowAutoPr: z.boolean().default(false),
      /** Confidence (0–100) a fix needs before a PR may open on its own. */
      minConfidence: z.number().min(0).max(100).default(80),
    })
    .prefault({}),
  /** Where Browse skills searches. A private registry is just another `index` URL. */
  registries: z
    .object({
      sources: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
            name: z.string().min(1).max(60),
            kind: z.enum(['index', 'skills-sh']),
            url: z.string().url(),
            enabled: z.boolean().default(true),
          }),
        )
        .default(DEFAULT_REGISTRIES),
    })
    .prefault({}),
  /** Providers besides Claude, fallback rules and the learning loop. */
  engine: z
    .object({
      codex: z
        .object({
          /** Codex's own sandbox for shell and file writes (AgentRoom can't approve single commands). */
          sandbox: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
          network: z.boolean().default(false),
          /** USD per million tokens, to estimate spend (0 = sign-in plan, tokens only). */
          priceInPerMtok: z.number().min(0).default(0),
          priceOutPerMtok: z.number().min(0).default(0),
        })
        .prefault({}),
      gemini: z
        .object({
          /** default = tools that need approval are refused (headless); auto_edit = edits allowed; yolo = everything. */
          approvalMode: z.enum(['default', 'auto_edit', 'yolo']).default('auto_edit'),
          /** Run tools in Gemini's sandbox (seatbelt on macOS, Docker elsewhere). */
          sandbox: z.boolean().default(true),
          /** USD per million tokens, to estimate spend (0 = sign-in plan, tokens only). */
          priceInPerMtok: z.number().min(0).default(0),
          priceOutPerMtok: z.number().min(0).default(0),
        })
        .prefault({}),
      openaiCompat: z
        .object({
          /** e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio). */
          baseUrl: z.string().default('http://localhost:11434/v1'),
          /** Default model when a phase doesn't name one. */
          model: z.string().default(''),
          /** USD per million tokens (0 for local models). */
          priceInPerMtok: z.number().min(0).default(0),
          priceOutPerMtok: z.number().min(0).default(0),
          /** Tool-loop turns per run at most. */
          maxTurns: z.number().int().min(1).max(200).default(40),
        })
        .prefault({}),
      fallback: z
        .object({
          enabled: z.boolean().default(true),
          onRateLimit: z.boolean().default(true),
          onOutage: z.boolean().default(true),
          /** Also fall back on other errors (only ever before the run did anything). */
          onError: z.boolean().default(false),
        })
        .prefault({}),
      learning: z
        .object({
          /** Runs per variant before an experiment shows a result. */
          minSamples: z.number().int().min(2).max(1000).default(10),
          /** Check PR state (merged / reverted) with gh, read-only. */
          trackOutcomes: z.boolean().default(true),
          /** Budget cap per replay eval run (USD). */
          evalBudgetUsd: z.number().positive().max(20).default(0.5),
        })
        .prefault({}),
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
    source: z.enum(['github', 'sentry', 'linear', 'jira']),
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
    z.object({
      source: z.literal('sentry'),
      event: z.enum(['new_issue', 'spike']),
      level: z.enum(['fatal', 'error', 'warning']).optional(),
      project: z.string().optional(),
      /** spike: events in the last `windowMin` minutes ≥ `factor` × the window before, and at least `minEvents`. */
      spike: z.object({ factor: z.number().min(1.5).max(100).default(3), windowMin: z.number().int().min(10).max(1440).default(60), minEvents: z.number().int().min(1).default(10) }).optional(),
    }),
    z.object({ source: z.literal('github'), event: z.literal('card_moved'), toColumn: z.string().min(1) }),
    z.object({ source: z.literal('goal'), event: z.literal('failed') }),
    z.object({ source: z.literal('linear'), event: z.literal('issue_moved'), toState: z.string().min(1) }),
    z.object({ source: z.literal('jira'), event: z.literal('issue_moved'), toState: z.string().min(1) }),
  ]),
  then: z.object({
    type: z.enum(['handoff', 'goal', 'message', 'notify', 'autopilot']),
    botId: z.string().optional(),
    planOnly: z.boolean().default(true),
    /** Autopilot: may open the PR on its own when confident enough (also needs settings.autopilot.allowAutoPr). */
    autoPr: z.boolean().optional(),
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
