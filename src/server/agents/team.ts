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
}

/**
 * What a run is part of: the goal (task_create defaults to it; events are stamped with it),
 * the task, and the workflow phase (selects the phase's model/effort from settings).
 */
export type DispatchOptions = RunContext;

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
  async send(botId: string, text: string, from = HUMAN): Promise<string> {
    return (await this.dispatch(botId, text, from)).text;
  }

  /** Like send, but reports whether the run succeeded or was stopped. */
  dispatch(botId: string, text: string, from = HUMAN, opts: DispatchOptions = {}): Promise<RunOutcome> {
    const bot = this.deps.project.bots.get(botId);
    if (!bot) return Promise.reject(new Error(`unknown bot "${botId}"`));
    const prev = this.queues.get(botId) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.run(bot, text, from, opts));
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

  private async run(bot: Bot, text: string, from: string, opts: DispatchOptions): Promise<RunOutcome> {
    const { project, hub, provider, permissions, sessions, previews } = this.deps;
    const team = project.bots.list();
    const controller = new AbortController();
    this.controllers.set(bot.id, controller);
    hub.setRunContext(bot.id, opts);
    const { model, effort } = this.modelFor(bot, opts);
    const tally = new RunTally(bot.id, model, opts);
    const finish = (out: RunOutcome): RunOutcome => {
      this.deps.ledger?.record(tally.finish({ ok: out.ok, aborted: out.aborted, error: out.ok ? undefined : out.text }));
      return out;
    };
    hub.emit({ type: AgentEventType.UserMessage, botId: bot.id, text, from });
    hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Thinking });

    try {
      // Humans can start a message with /skill commands; bots' messages are passed through as written.
      const prompt = from === HUMAN ? expandSkillCommands(bot, text, project.library.list()) : text;
      const res = await provider.run({
        bot,
        prompt,
        cwd: project.root,
        model,
        effort,
        skills: { libraryPluginDir: project.paths.dir, botPluginDir: project.paths.botDir(bot.dir) },
        context: buildContext(bot, team, project.paths.claudeMd),
        resumeSessionId: sessions.get(bot.id),
        hostTools: buildHostTools(bot, team, {
          tasks: project.tasks,
          goals: project.goals,
          previews,
          hub,
          notifications: this.deps.notifications,
          boardChanged: this.deps.boardChanged,
          goalId: opts.goalId,
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
