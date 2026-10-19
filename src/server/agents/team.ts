import { AgentEventType, BotStatus } from '../../shared/enums.js';
import type { Bot } from '../../shared/types/index.js';
import type { Project } from '../../core/project.js';
import type { PreviewService } from '../preview/preview.service.js';
import type { Provider } from '../providers/provider.js';
import type { Hub, RunContext } from '../realtime/hub.js';
import { RunTally, type LedgerService } from '../services/ledger.service.js';
import type { NotificationService } from '../services/notification.service.js';
import { buildContext } from './context-builder.js';
import type { PermissionGate } from './permission-gate.js';
import type { SessionStore } from './session-store.js';
import { buildHostTools } from './tools/index.js';
import { expandSkillCommands } from './skill-commands.js';
import type { SecurityService } from '../security/security.service.js';
import { toAttachment, type ResolvedAttachment, type UploadStore } from '../services/upload.store.js';
import type { McpService } from '../services/mcp/mcp.service.js';

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

/** Runs bots: one queue per bot, delegation between them, stop/abort. */
export class Team {
  private queues = new Map<string, Promise<unknown>>();
  private controllers = new Map<string, AbortController>();

  constructor(private readonly deps: TeamDeps) {}

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
    const run = prev.catch(() => {}).then(() => this.run(bot, text, from, opts, attachments));
    this.queues.set(botId, run);
    return run;
  }

  isRunning(botId: string): boolean {
    return this.controllers.has(botId);
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
    const { project, hub, provider, permissions, sessions, previews } = this.deps;
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
    const { model, effort } = this.modelFor(bot, opts);
    const tally = new RunTally(bot.id, model, opts);
    const finish = (out: RunOutcome): RunOutcome => {
      this.deps.ledger?.record(tally.finish({ ok: out.ok, aborted: out.aborted, error: out.ok ? undefined : out.text }));
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
      const res = await provider.run({
        bot,
        prompt,
        ...(attachments.length ? { attachments } : {}),
        cwd: opts.cwd ?? project.root,
        ...(maxBudgetUsd !== undefined && Number.isFinite(maxBudgetUsd) ? { maxBudgetUsd } : {}),
        model,
        effort,
        skills: { libraryPluginDir: project.paths.dir, botPluginDir: project.paths.botDir(bot.dir) },
        context: buildContext(bot, team, project.paths.claudeMd, this.deps.mcp?.describeFor(bot), project.memory.contextBlock(bot)),
        mcpServers: this.deps.mcp?.forBot(bot),
        resumeSessionId: sessions.get(bot.id),
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
          delegate: (to, instruction) => {
            hub.emit({ type: AgentEventType.Delegation, from: bot.id, to, instruction });
            // The delegate works for the same goal, but its own phase/task isn't implied.
            return this.dispatch(to, instruction, bot.id, { goalId: opts.goalId }).then((o) => o.text);
          },
        }, controller.signal),
        signal: controller.signal,
        emit: (e) => {
          tally.observe(e);
          hub.emit(e);
        },
        stream: (d) => hub.stream(bot.id, d),
        askPermission: (tool, input, signal) => permissions.ask(bot.id, tool, input, signal),
        inspectToolOutput: this.deps.security
          ? (tool, output) => this.deps.security!.inspect(output, tool === 'WebSearch' ? 'web search results' : 'a fetched web page', { botId: bot.id, goalId: opts.goalId, runKey: controller.signal })
          : undefined,
      });
      if (res.sessionId) sessions.set(bot.id, res.sessionId);
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
