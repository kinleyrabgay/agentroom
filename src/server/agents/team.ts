import { randomUUID } from 'node:crypto';
import { AgentEventType, BotStatus, QueueHoldReason, RateLimitStatus, SteerStatus } from '../../shared/enums.js';
import type { Bot } from '../../shared/types/index.js';
import type { Project } from '../../core/project.js';
import type { PreviewService } from '../preview/preview.service.js';
import type { Provider, RunRequest, SteerHandle } from '../providers/provider.js';
import type { ProviderPool } from '../providers/registry.js';
import { fallbackNote, fallbackReason, planRoute, type RouteAttempt } from '../providers/router.js';
import type { Hub, RunContext } from '../realtime/hub.js';
import { RunTally, type LedgerService } from '../services/ledger.service.js';
import type { NotificationService } from '../services/notification.service.js';
import { buildContext } from './context-builder.js';
import type { PermissionGate } from './permission-gate.js';
import type { SessionStore } from './session-store.js';
import { buildHostTools } from './tools/index.js';
import type { AutopilotReporter } from './tools/autopilot.tools.js';
import { expandSkillCommands } from './skill-commands.js';
import type { SecurityService } from '../security/security.service.js';
import { toAttachment, type ResolvedAttachment, type UploadStore } from '../services/upload.store.js';
import type { McpService } from '../services/mcp/mcp.service.js';
import type { ContextService } from '../context/context.service.js';
import type { WorkspaceService } from '../workspaces/workspace.service.js';
import type { BotQueues } from './bot-queue.js';

export interface TeamDeps {
  project: Project;
  hub: Hub;
  provider: Provider;
  previews: PreviewService;
  permissions: PermissionGate;
  sessions: SessionStore;
  notifications: NotificationService;
  /** Board written by a bot — push it to the UI. */
  boardChanged: () => void;
  /** Records one row per finished run. */
  ledger?: LedgerService;
  /** Security layer (findings tool, untrusted-content guard). */
  security?: SecurityService;
  /** Files the human attached to messages. */
  uploads?: UploadStore;
  /** External MCP servers (Sentry, …) added in AgentRoom. */
  mcp?: McpService;
  /** Repo context: the map in every bot's instructions and the context_* tools. */
  context?: ContextService;
  /** Incident autopilot (`autopilot_report` on autopilot goals). */
  autopilot?: AutopilotReporter;
  /** Other providers (Codex, Gemini, OpenAI-compatible) for phase routing and fallbacks. */
  providers?: ProviderPool;
  /** A/B experiments: may change the bot's skills/prompt for runs inside goals. */
  experiments?: RunExperiments;
  /** Multi-repo workspaces: the workspace block in bots' instructions, other repos' folders, task repo ids. */
  workspace?: WorkspaceService;
  /** Messages you send while a bot is busy, and steers into its running turn. */
  queue?: BotQueues;
}

/** What the learning loop does to a run: the bot as this run sees it, and the variants it's part of. */
export interface RunExperiments {
  forRun(bot: Bot, ctx: { goalId?: string; phase?: DispatchOptions['phase'] }): { bot: Bot; variants: Record<string, string> } | null;
}

/**
 * What a run is part of: the goal (task_create defaults to it; events are stamped with it),
 * the task, and the workflow phase (selects the phase's model/effort from settings).
 */
export type DispatchOptions = RunContext & {
  /** Upload ids attached to this message (images, PDFs, files). */
  attachments?: readonly string[];
  /** Folder the bot works in (a goal's own worktree); defaults to the project root. */
  cwd?: string;
  /** Other folders the bot may read and edit (a workspace's other repos); chats get the workspace's repos by default. */
  additionalDirectories?: string[];
  /** Stop the run once it has spent this much (USD). */
  maxBudgetUsd?: number;
};

/** Outcome of one bot run. */
export interface RunOutcome {
  ok: boolean;
  text: string;
  aborted: boolean;
}

const HUMAN = 'human';

/** Sent first when a chat continues after its usage limit reset. */
export const CONTINUE_PROMPT = 'Continue where you left off.';
/** Resume a little after the reset time, so the first request isn't refused again. */
const RESET_SLACK_MS = 5000;

/** Runs bots: one queue per bot, delegation between them, stop/abort. */
export class Team {
  private queues = new Map<string, Promise<unknown>>();
  private controllers = new Map<string, AbortController>();
  /** Runs dispatched and not finished yet, per bot (running or waiting their turn). */
  private pending = new Map<string, number>();
  /** The running turn of a bot that can take steers. */
  private steerHandles = new Map<string, SteerHandle>();
  /** The bot's current run hit its usage limit: when it resets (epoch ms, 0 = unknown), and whether it was a chat. */
  private limits = new Map<string, { until: number; chat: boolean }>();
  private resumeTimers = new Map<string, NodeJS.Timeout>();
  /** Bots whose limited run was a chat, so resuming says "continue" (goal runs are resumed by the goal). */
  private chatLimited = new Set<string>();

  constructor(private readonly deps: TeamDeps) {
    for (const botId of Object.keys(deps.queue?.all() ?? {})) this.scheduleResume(botId);
  }

  /** Queue a message for a bot. Resolves with the bot's final answer. Runs are serialized per bot. */
  async send(botId: string, text: string, from = HUMAN, opts: DispatchOptions = {}): Promise<string> {
    return (await this.dispatch(botId, text, from, opts)).text;
  }

  /** Like send, but reports whether the run succeeded or was stopped. */
  dispatch(botId: string, text: string, from = HUMAN, opts: DispatchOptions = {}): Promise<RunOutcome> {
    const bot = this.deps.project.bots.get(botId);
    if (!bot) return Promise.reject(new Error(`unknown bot "${botId}"`));
    let attachments: ResolvedAttachment[] = [];
    if (opts.attachments?.length) {
      if (!this.deps.uploads) return Promise.reject(new Error('Attachments are not available.'));
      try {
        attachments = this.deps.uploads.resolve(opts.attachments);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    const prev = this.queues.get(botId) ?? Promise.resolve();
    this.pending.set(botId, (this.pending.get(botId) ?? 0) + 1);
    const run = prev.catch(() => {}).then(() => this.run(bot, text, from, opts, attachments));
    this.queues.set(botId, run);
    run.then(
      (out) => this.afterRun(botId, out),
      () => this.afterRun(botId, { ok: false, text: '', aborted: false }),
    );
    return run;
  }

  isRunning(botId: string): boolean {
    return this.controllers.has(botId);
  }

  /** Running, or with runs waiting their turn. */
  isBusy(botId: string): boolean {
    return (this.pending.get(botId) ?? 0) > 0;
  }

  // ---------- your messages: queue and steering ----------

  /**
   * A message you typed. It goes now when the bot is free and nothing is waiting; otherwise it joins
   * the bot's queue and goes when the current run ends cleanly. Sending into an empty, held queue
   * counts as "carry on" and lifts the hold.
   */
  submit(botId: string, text: string, attachments?: string[]) {
    const queue = this.deps.queue;
    if (!queue) {
      void this.send(botId, text, HUMAN, attachments?.length ? { attachments } : {}).catch(this.fail(botId));
      return;
    }
    if (!this.deps.project.bots.get(botId)) throw new Error(`unknown bot "${botId}"`);
    const q = queue.get(botId);
    if (q.hold && !q.items.length) this.releaseHold(botId);
    if (this.isBusy(botId) || q.items.length || queue.get(botId).hold) {
      queue.add(botId, text, attachments);
      this.drain(botId);
      return;
    }
    this.start(botId, text, attachments);
  }

  /**
   * Write a message into the bot's running turn without stopping it. When the run can't take it
   * (not running, another provider, attachments), it goes first in the queue instead.
   */
  steer(botId: string, text: string, attachments?: string[]) {
    const queue = this.deps.queue;
    const bot = this.deps.project.bots.get(botId);
    if (!queue || !bot) return this.submit(botId, text, attachments);
    const handle = this.steerHandles.get(botId);
    if (handle && !attachments?.length) {
      const id = randomUUID();
      queue.steer(botId, { id, text, status: SteerStatus.Pending });
      if (handle.steer(id, expandSkillCommands(bot, text, this.deps.project.library.list()))) return;
      queue.steerStatus(botId, id, SteerStatus.Failed);
    }
    queue.add(botId, text, attachments, true);
    this.releaseHold(botId);
    this.drain(botId);
  }

  /** Send a queued message now: into the running turn if it can take it, else next in line. */
  sendNow(botId: string, id: string) {
    const item = this.deps.queue?.remove(botId, id);
    if (item) this.steer(botId, item.text, item.attachments);
  }

  /** Lift the hold and send the next queued message. */
  resume(botId: string) {
    this.releaseHold(botId);
    this.drain(botId);
  }

  setResumeAtReset(botId: string, on: boolean) {
    this.deps.queue?.setResumeAtReset(botId, on);
    this.scheduleResume(botId);
  }

  /** Send the next queued message if the bot is free and the queue isn't held. */
  private drain(botId: string) {
    const queue = this.deps.queue;
    if (!queue || this.isBusy(botId) || queue.get(botId).hold) return;
    const next = queue.shift(botId);
    if (next) this.start(botId, next.text, next.attachments);
  }

  private start(botId: string, text: string, attachments?: string[]) {
    this.dispatch(botId, text, HUMAN, attachments?.length ? { attachments } : {}).catch(this.fail(botId));
  }

  private fail = (botId: string) => (err: Error) => this.deps.hub.emit({ type: AgentEventType.Error, botId, message: err.message });

  /** A run ended: hold the queue after a failure, a stop or a usage limit; otherwise send the next message. */
  private afterRun(botId: string, out: RunOutcome) {
    const left = (this.pending.get(botId) ?? 1) - 1;
    if (left > 0) this.pending.set(botId, left);
    else this.pending.delete(botId);
    const queue = this.deps.queue;
    const limit = this.limits.get(botId);
    this.limits.delete(botId);
    if (!queue) return;
    if (limit && !out.ok && !out.aborted) {
      if (limit.chat) this.chatLimited.add(botId);
      else this.chatLimited.delete(botId);
      queue.hold(botId, QueueHoldReason.Limited, limit.until || undefined);
      this.scheduleResume(botId);
    } else if (out.aborted) queue.hold(botId, QueueHoldReason.Stopped);
    else if (!out.ok) queue.hold(botId, QueueHoldReason.Failed);
    this.drain(botId);
  }

  private releaseHold(botId: string) {
    clearTimeout(this.resumeTimers.get(botId));
    this.resumeTimers.delete(botId);
    this.chatLimited.delete(botId);
    this.deps.queue?.release(botId);
  }

  /** With "Resume at reset" on, continue on our own once a usage limit with a known reset time passes. */
  private scheduleResume(botId: string) {
    clearTimeout(this.resumeTimers.get(botId));
    this.resumeTimers.delete(botId);
    const q = this.deps.queue?.get(botId);
    if (!q?.resumeAtReset || q.hold?.reason !== QueueHoldReason.Limited || !q.hold.until) return;
    const delay = Math.max(0, q.hold.until - Date.now() + RESET_SLACK_MS);
    // Timers can't wait longer than ~24 days; limits reset far sooner.
    const timer = setTimeout(() => {
      this.resumeTimers.delete(botId);
      const chat = this.chatLimited.has(botId);
      this.releaseHold(botId);
      if (chat) this.deps.queue?.add(botId, CONTINUE_PROMPT, undefined, true);
      this.drain(botId);
    }, Math.min(delay, 2 ** 31 - 1));
    timer.unref?.();
    this.resumeTimers.set(botId, timer);
  }

  private onSteerStatus(botId: string, id: string, status: SteerStatus) {
    const steer = this.deps.queue?.steerStatus(botId, id, status);
    if (!steer) return;
    // Shown in the thread where the run took it; one it never took goes back to the front of the queue.
    if (status === SteerStatus.Delivered) this.deps.hub.emit({ type: AgentEventType.UserMessage, botId, text: steer.text, from: HUMAN });
    else if (status === SteerStatus.Failed) this.deps.queue?.add(botId, steer.text, undefined, true);
  }

  stop(botId?: string) {
    const ids = botId ? [botId] : [...this.controllers.keys()];
    for (const id of ids) this.controllers.get(id)?.abort();
    this.deps.permissions.cancel(botId);
  }

  resetSession(botId: string) {
    this.deps.sessions.clear(botId);
  }

  private async run(bot: Bot, text: string, from: string, opts: DispatchOptions, attachments: ResolvedAttachment[]): Promise<RunOutcome> {
    const { project, hub, permissions, sessions, previews } = this.deps;
    const repoMap = this.deps.context?.promptBlock() ?? '';
    const workspace = this.deps.workspace?.isWorkspace ? this.deps.workspace : undefined;
    const workspaceBlock = workspace?.promptBlock() ?? '';
    // Chats outside goals may read the workspace's other repos where they are; goal runs pass their own folders.
    const extraDirs = opts.additionalDirectories ?? (workspace && !opts.goalId ? workspace.registry.list().filter((r) => !r.primary).map((r) => r.root) : []);
    const team = project.bots.list();
    // Chats outside goals obey the daily cap (goal runs are checked by the goal engine).
    const dayLeft = opts.goalId ? undefined : this.dayRemaining();
    if (dayLeft !== undefined && dayLeft < 0.01) {
      const cap = project.settings.get().budgets.perDayUsd ?? 0;
      hub.emit({ type: AgentEventType.UserMessage, botId: bot.id, text, from });
      hub.emit({
        type: AgentEventType.Message,
        botId: bot.id,
        text: `Today's budget of $${cap.toFixed(2)} is used up, so I won't start. Raise it in Settings → Budgets, or try again tomorrow.`,
      });
      return { ok: false, text: 'Daily budget used up.', aborted: false };
    }
    const maxBudgetUsd = opts.maxBudgetUsd ?? dayLeft;
    const controller = new AbortController();
    this.controllers.set(bot.id, controller);
    hub.setRunContext(bot.id, { goalId: opts.goalId, taskId: opts.taskId, phase: opts.phase });
    const route = this.route(bot, opts);
    const experiment = opts.goalId ? (this.deps.experiments?.forRun(bot, { goalId: opts.goalId, phase: opts.phase }) ?? null) : null;
    const runBot = experiment?.bot ?? bot;
    const tally = new RunTally(bot.id, route[0]!.model, opts);
    let ran = route[0]!;
    const fellBackFrom: string[] = [];
    const finish = (out: RunOutcome): RunOutcome => {
      this.deps.ledger?.record(
        tally.finish({ ok: out.ok, aborted: out.aborted, error: out.ok ? undefined : out.text, provider: ran.provider, fellBackFrom, ...(experiment ? { variants: experiment.variants } : {}) }),
      );
      return out;
    };
    hub.emit({
      type: AgentEventType.UserMessage,
      botId: bot.id,
      text,
      from,
      ...(attachments.length ? { attachments: attachments.map(toAttachment) } : {}),
    });
    hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Thinking });

    try {
      // Humans can start a message with /skill commands; bots' messages are passed through as written.
      const prompt = from === HUMAN ? expandSkillCommands(bot, text, project.library.list()) : text;
      const request = (attempt: RouteAttempt): RunRequest => ({
        bot: runBot,
        prompt,
        ...(attachments.length ? { attachments } : {}),
        cwd: opts.cwd ?? project.root,
        ...(extraDirs.length ? { additionalDirectories: extraDirs } : {}),
        ...(maxBudgetUsd !== undefined && Number.isFinite(maxBudgetUsd) ? { maxBudgetUsd } : {}),
        model: attempt.model,
        effort: attempt.effort,
        skills: { libraryPluginDir: project.paths.dir, botPluginDir: project.paths.botDir(bot.dir) },
        context: buildContext(runBot, team, project.paths.claudeMd, this.deps.mcp?.describeFor(bot), project.memory.contextBlock(bot), [repoMap, workspaceBlock].filter(Boolean).join('\n\n')),
        mcpServers: this.deps.mcp?.forBot(bot),
        // Sessions belong to one provider; another provider starts fresh.
        resumeSessionId: attempt.provider === route[0]!.provider ? sessions.get(bot.id) : undefined,
        hostTools: buildHostTools(bot, team, {
          tasks: project.tasks,
          goals: project.goals,
          previews,
          hub,
          notifications: this.deps.notifications,
          boardChanged: this.deps.boardChanged,
          goalId: opts.goalId,
          security: this.deps.security,
          memory: project.memory,
          ...(repoMap && this.deps.context ? { context: this.deps.context.reader } : {}),
          ...(this.deps.autopilot ? { autopilot: this.deps.autopilot } : {}),
          ...(workspace ? { repos: workspace.registry.ids(), primaryRepo: workspace.registry.primaryId } : {}),
          delegate: (to, instruction) => {
            hub.emit({ type: AgentEventType.Delegation, from: bot.id, to, instruction });
            // The delegate works for the same goal, but its own phase/task isn't implied.
            return this.dispatch(to, instruction, bot.id, { goalId: opts.goalId }).then((o) => o.text);
          },
        }, controller.signal),
        signal: controller.signal,
        emit: (e) => {
          tally.observe(e);
          if (e.type === AgentEventType.RateLimit && e.status === RateLimitStatus.Rejected) {
            this.limits.set(bot.id, { until: e.resetsAt ? e.resetsAt * 1000 : 0, chat: !opts.goalId });
          }
          hub.emit(e);
        },
        ...(this.deps.queue
          ? {
              steering: {
                attach: (h: SteerHandle | null) => (h ? this.steerHandles.set(bot.id, h) : this.steerHandles.delete(bot.id)),
                status: (id: string, st: SteerStatus) => this.onSteerStatus(bot.id, id, st),
              },
            }
          : {}),
        stream: (d) => hub.stream(bot.id, d),
        askPermission: (tool, input, signal) => permissions.ask(bot.id, tool, input, signal),
        inspectToolOutput: this.deps.security
          ? (tool, output) => this.deps.security!.inspect(output, tool === 'WebSearch' ? 'web search results' : 'a fetched web page', { botId: bot.id, goalId: opts.goalId, runKey: controller.signal })
          : undefined,
      });
      const res = await this.runRoute(route, request, tally, controller.signal, (from, to, reason) => {
        fellBackFrom.push(from.provider);
        ran = to;
        hub.emit({ type: AgentEventType.Message, botId: bot.id, text: fallbackNote(from.provider, to.provider, reason) });
      });
      ran = res.attempt;
      if (res.sessionId && ran.provider === route[0]!.provider) sessions.set(bot.id, res.sessionId);
      hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: res.ok ? BotStatus.Idle : BotStatus.Error });
      return finish({ ok: res.ok, text: res.result, aborted: controller.signal.aborted });
    } catch (err) {
      const aborted = controller.signal.aborted;
      const message = aborted ? 'Stopped by human.' : (err as Error).message;
      if (aborted) hub.emit({ type: AgentEventType.Message, botId: bot.id, text: '⏹ Stopped.' });
      else hub.emit({ type: AgentEventType.Error, botId: bot.id, message });
      hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: aborted ? BotStatus.Idle : BotStatus.Error });
      return finish({ ok: false, text: message, aborted });
    } finally {
      if (this.controllers.get(bot.id) === controller) this.controllers.delete(bot.id);
      hub.setRunContext(bot.id, null);
    }
  }

  /** Providers this run may use, in order (just the main provider without a pool, as before). */
  private route(bot: Bot, opts: DispatchOptions): RouteAttempt[] {
    if (!this.deps.providers) {
      const { model, effort } = this.modelFor(bot, opts);
      return [{ provider: this.deps.provider.id, model, ...(effort ? { effort } : {}) }];
    }
    return planRoute({ bot, phase: opts.phase, settings: this.deps.project.settings.get(), config: this.deps.project.config.get() });
  }

  /**
   * Try each provider in turn. Moves on only when an attempt failed before it did anything
   * (no tool call) for a reason another provider wouldn't share: rate limit, outage, not installed.
   */
  private async runRoute(
    route: RouteAttempt[],
    request: (a: RouteAttempt) => RunRequest,
    tally: RunTally,
    signal: AbortSignal,
    onFallback: (from: RouteAttempt, to: RouteAttempt, reason: NonNullable<ReturnType<typeof fallbackReason>>) => void,
  ): Promise<Awaited<ReturnType<Provider['run']>> & { attempt: RouteAttempt }> {
    const settings = this.deps.project.settings.get().engine.fallback;
    for (let i = 0; ; i++) {
      const attempt = route[i]!;
      const next = route[i + 1];
      const provider = this.deps.providers ? this.deps.providers.get(attempt.provider) : this.deps.provider;
      try {
        const res = await provider.run(request(attempt));
        const reason = !res.ok && next ? fallbackReason(res.result, { progressed: tally.toolCalls > 0, aborted: signal.aborted, settings }) : null;
        if (!reason || !next) return { ...res, attempt };
        onFallback(attempt, next, reason);
      } catch (err) {
        const reason = next ? fallbackReason(err, { progressed: tally.toolCalls > 0, aborted: signal.aborted, settings }) : null;
        if (!reason || !next) throw err;
        onFallback(attempt, next, reason);
      }
    }
  }

  /** USD left of today's cap, or undefined when there's no daily cap. */
  private dayRemaining(): number | undefined {
    const cap = this.deps.project.settings.get().budgets.perDayUsd;
    if (cap === null || !this.deps.ledger) return undefined;
    return cap - this.deps.ledger.spentToday();
  }

  /**
   * Model/effort for a run. Inside a goal run the phase setting (settings.models[phase]) wins,
   * so a team can say "Opus for planning, Haiku for QA" regardless of each bot's default.
   * Direct chats (no phase) use the bot's own setting, then the project default.
   */
  private modelFor(bot: Bot, opts: DispatchOptions) {
    const config = this.deps.project.config.get();
    const phases = this.deps.project.settings.get().models as Record<string, { model?: string; effort?: Bot['effort'] } | undefined>;
    const phase = opts.phase ? phases[opts.phase] : undefined;
    return {
      model: phase?.model ?? bot.model ?? config.model,
      effort: phase?.effort ?? bot.effort ?? config.effort,
    };
  }
}
