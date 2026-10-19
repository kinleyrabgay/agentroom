import { AgentEventType, BotStatus, GoalStatus, NotificationKind, TaskKind, TaskStatus } from '../../shared/enums.js';
import type { Bot, Goal, GoalPatch, GoalSource, Task } from '../../shared/types/index.js';
import type { Project } from '../../core/project.js';
import type { RunOutcome, Team } from '../agents/team.js';
import { isFinished } from '../agents/tools/task.tools.js';
import { GOAL_TITLE_MAX, MAX_FIX_ROUNDS } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';
import type { NotificationService } from '../services/notification.service.js';
import { buildPrompt, planPrompt, reportPrompt, testPrompt } from './prompts.js';
import { resolveLead, resolveRoles, type TeamRoles } from './roles.js';

export interface GoalRunnerDeps {
  project: Project;
  team: Team;
  hub: Hub;
  notifications: NotificationService;
  /** Board written — push it to the UI now. */
  boardChanged: () => void;
}

/** Per-goal runtime flags (not persisted). */
interface Control {
  running: boolean;
  pause: boolean;
  cancel: boolean;
  currentBot?: string;
  /** QA tasks already attempted, keyed by round, so a failing QA task isn't retried in a loop. */
  attempted: Set<string>;
}

type StepResult = 'progress' | 'none' | 'aborted' | { blocked: string };

/** Statuses in which the engine is (or should be) driving the goal. */
const ACTIVE: Goal['status'][] = [GoalStatus.Planning, GoalStatus.Building, GoalStatus.Testing, GoalStatus.Reporting];
const FINAL: Goal['status'][] = [GoalStatus.Done, GoalStatus.Cancelled];
const WORK_KINDS: Task['kind'][] = [TaskKind.Dev, TaskKind.Bug];
const OPEN: Task['status'][] = [TaskStatus.Todo, TaskStatus.Doing];
/** Who the report request comes from in the Team Lead's chat. */
const ENGINE = 'agentroom';

/**
 * Drives a goal through plan → human approval → build → QA (→ fix rounds) → report.
 * State lives in the goal's status on disk, so a goal can pause, resume and survive restarts.
 */
export class GoalRunner {
  private controls = new Map<string, Control>();

  constructor(private readonly deps: GoalRunnerDeps) {}

  // ---------- commands ----------

  list(): Goal[] {
    return this.deps.project.goals.list();
  }

  start(brief: string, title?: string, sources: GoalSource[] = []): Goal {
    const text = brief.trim();
    if (!text) throw new Error('Describe the goal first.');
    const firstLine = text.split('\n')[0].trim();
    const goal = this.deps.project.goals.create({
      title: (title?.trim() || firstLine).slice(0, GOAL_TITLE_MAX),
      brief: text,
      sources,
    });
    this.changed();
    this.kick(goal.id);
    return goal;
  }

  approve(id: string): Goal {
    const goal = this.require(id);
    if (goal.status !== GoalStatus.AwaitingApproval) throw new Error(`${id} isn't waiting for approval (it is ${goal.status}).`);
    if (!this.tasksOf(id).some((t) => WORK_KINDS.includes(t.kind))) throw new Error(`${id} has no dev tasks to build. Add one or request changes.`);
    const next = this.set(id, { status: GoalStatus.Building, approvedAt: new Date().toISOString(), reason: null });
    this.kick(id);
    return next;
  }

  replan(id: string, feedback: string): Goal {
    const goal = this.require(id);
    if (goal.status !== GoalStatus.AwaitingApproval && goal.status !== GoalStatus.Paused) {
      throw new Error(`Changes can be requested while the plan awaits approval or the goal is paused (it is ${goal.status}).`);
    }
    if (this.isRunning(id)) throw new Error(`${id} is still running; wait for it to pause.`);
    const next = this.set(id, { status: GoalStatus.Planning, feedback: feedback.trim() || null, approvedAt: null, reason: null });
    this.kick(id);
    return next;
  }

  pause(id: string): Goal {
    const goal = this.require(id);
    if (!ACTIVE.includes(goal.status)) throw new Error(`${id} isn't running (it is ${goal.status}).`);
    const ctl = this.control(id);
    if (ctl.running) {
      ctl.pause = true;
      return goal;
    }
    return this.pauseNow(id, 'Paused by you.');
  }

  resume(id: string): Goal {
    const goal = this.require(id);
    if (goal.status !== GoalStatus.Paused && goal.status !== GoalStatus.Failed) throw new Error(`${id} isn't paused (it is ${goal.status}).`);
    if (this.isRunning(id)) throw new Error(`${id} is still finishing its current step.`);
    const status = this.phaseFor(goal);
    const next = this.set(id, { status, reason: null });
    if (status !== GoalStatus.AwaitingApproval) this.kick(id);
    else this.leadStatus(BotStatus.Waiting, `${id} · Waiting for your plan approval`);
    return next;
  }

  cancel(id: string): Goal {
    const goal = this.require(id);
    if (FINAL.includes(goal.status)) throw new Error(`${id} is already ${goal.status}.`);
    const ctl = this.control(id);
    ctl.cancel = true;
    if (ctl.currentBot) this.deps.team.stop(ctl.currentBot);
    const next = this.set(id, { status: GoalStatus.Cancelled, reason: 'Cancelled by you.' });
    this.leadStatus(BotStatus.Idle);
    return next;
  }

  update(id: string, patch: GoalPatch): Goal {
    this.require(id);
    const clean: GoalPatch = {};
    if (typeof patch.title === 'string' && patch.title.trim()) clean.title = patch.title.trim().slice(0, GOAL_TITLE_MAX);
    if (typeof patch.plan === 'string') clean.plan = patch.plan;
    return this.set(id, clean);
  }

  remove(id: string): void {
    this.require(id);
    if (this.isRunning(id)) throw new Error(`${id} is running. Cancel it first.`);
    this.deps.project.goals.delete(id);
    this.controls.delete(id);
    this.changed();
  }

  /** Goals that were mid-flight when the server stopped can't continue silently. */
  recoverOnStartup(): void {
    for (const g of this.list()) {
      if (ACTIVE.includes(g.status)) this.set(g.id, { status: GoalStatus.Paused, reason: 'AgentRoom restarted — press Resume to continue.' });
    }
  }

  isRunning(id: string): boolean {
    return this.controls.get(id)?.running ?? false;
  }

  // ---------- engine ----------

  private kick(id: string) {
    const ctl = this.control(id);
    if (ctl.running) return;
    ctl.running = true;
    ctl.pause = false;
    ctl.cancel = false;
    this.drive(id)
      .catch((err) => this.fail(id, (err as Error).message))
      .finally(() => {
        ctl.running = false;
        ctl.currentBot = undefined;
      });
  }

  private async drive(id: string): Promise<void> {
    const ctl = this.control(id);
    for (;;) {
      if (ctl.cancel) return;
      if (ctl.pause) {
        this.pauseNow(id, 'Paused by you.');
        return;
      }
      const goal = this.require(id);
      const roles = this.roles(goal);
      if (!roles) return;

      switch (goal.status) {
        case GoalStatus.Planning:
          await this.planPhase(goal, roles);
          return;
        case GoalStatus.Building: {
          const r = await this.buildStep(goal, roles);
          if (this.interrupted(id, r === 'aborted')) return;
          if (r === 'none') this.set(id, { status: GoalStatus.Testing });
          else if (typeof r === 'object') return void this.block(id, r.blocked);
          break;
        }
        case GoalStatus.Testing: {
          const r = await this.testStep(goal, roles);
          if (this.interrupted(id, r === 'aborted')) return;
          if (r === 'none') this.afterTesting(this.require(id));
          break;
        }
        case GoalStatus.Reporting:
          await this.reportPhase(goal, roles);
          return;
        default:
          return;
      }
    }
  }

  private async planPhase(goal: Goal, roles: TeamRoles) {
    this.leadStatus(BotStatus.Working, `${goal.id} · Planning with ${roles.planner.name}`);
    const out = await this.run(goal, roles, roles.planner, planPrompt(goal, roles, this.tasksOf(goal.id)), `Plan ${goal.id}: ${goal.title}`);
    if (this.interrupted(goal.id, out.aborted)) return;

    const tasks = this.tasksOf(goal.id);
    const dev = tasks.filter((t) => WORK_KINDS.includes(t.kind));
    if (!dev.length) {
      this.block(goal.id, `${roles.planner.name} didn't create any dev tasks. Add tasks yourself or request changes.`);
      return;
    }
    const qa = tasks.filter((t) => t.kind === TaskKind.QA).length;
    this.set(goal.id, { status: GoalStatus.AwaitingApproval, feedback: null });
    this.deps.notifications.create({
      kind: NotificationKind.PlanReady,
      title: `Plan ready: ${goal.title}`,
      body: `${dev.length} dev ${dev.length === 1 ? 'task' : 'tasks'} and ${qa} QA ${qa === 1 ? 'task' : 'tasks'}. Review and edit the board, then approve.`,
      goalId: goal.id,
      botId: roles.planner.id,
    });
    this.leadStatus(BotStatus.Waiting, `${goal.id} · Waiting for your plan approval`);
  }

  private async buildStep(goal: Goal, roles: TeamRoles): Promise<StepResult> {
    const tasks = this.tasksOf(goal.id);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const work = tasks
      .filter((t) => WORK_KINDS.includes(t.kind) && OPEN.includes(t.status))
      .sort((a, b) => Number(b.kind === TaskKind.Bug) - Number(a.kind === TaskKind.Bug) || a.order - b.order);
    if (!work.length) return 'none';

    const depsMet = (t: Task) =>
      t.dependsOn.every((d) => {
        const dep = byId.get(d);
        return !dep || dep.kind === TaskKind.QA || isFinished(dep);
      });
    const task = work.find(depsMet);
    if (!task) return { blocked: `Remaining tasks wait on dependencies that can't finish: ${work.map((t) => `${t.id} → ${t.dependsOn.join(', ')}`).join('; ')}.` };

    const { tasks: repo } = this.deps.project;
    const previousBlock = task.blockedReason;
    repo.update(task.id, { status: TaskStatus.Doing, blockedReason: null, assignee: task.assignee ?? roles.developer.id });
    repo.appendLog(task.id, roles.lead.id, previousBlock ? `Resumed after block: ${previousBlock}` : `Started by ${roles.developer.name}.`);
    this.changed();

    this.leadStatus(BotStatus.Working, `${goal.id} · Building ${task.id} with ${roles.developer.name}`);
    const out = await this.run(goal, roles, roles.developer, buildPrompt(goal, repo.get(task.id)!, previousBlock), `Build ${task.id}: ${task.title}`);
    if (out.aborted) return 'aborted';

    const after = repo.get(task.id);
    if (!after) return 'progress';
    if (after.blockedReason) return { blocked: `${after.id} is blocked: ${after.blockedReason}` };
    if (OPEN.includes(after.status)) {
      repo.update(after.id, { status: TaskStatus.Review });
      repo.appendLog(after.id, roles.lead.id, 'Marked ready for QA.');
      this.changed();
    }
    return 'progress';
  }

  private async testStep(goal: Goal, roles: TeamRoles): Promise<StepResult> {
    const ctl = this.control(goal.id);
    const tasks = this.tasksOf(goal.id);
    const task = tasks
      .filter((t) => t.kind === TaskKind.QA && t.status !== TaskStatus.Done)
      .sort((a, b) => a.order - b.order)
      .find((t) => !ctl.attempted.has(`${goal.round}:${t.id}`));
    if (!task) return 'none';
    ctl.attempted.add(`${goal.round}:${task.id}`);

    this.leadStatus(BotStatus.Working, `${goal.id} · Testing ${task.id} with ${roles.qa.name}`);
    const devTasks = tasks.filter((t) => WORK_KINDS.includes(t.kind));
    const out = await this.run(goal, roles, roles.qa, testPrompt(goal, task, devTasks, roles), `Test ${task.id}: ${task.title}`);
    return out.aborted ? 'aborted' : 'progress';
  }

  /** All QA tasks attempted this round: finish, loop back for fixes, or stop and ask. */
  private afterTesting(goal: Goal) {
    const tasks = this.tasksOf(goal.id);
    const openWork = tasks.filter((t) => WORK_KINDS.includes(t.kind) && OPEN.includes(t.status));
    const qaLeft = tasks.filter((t) => t.kind === TaskKind.QA && t.status !== TaskStatus.Done);

    if (!openWork.length && !qaLeft.length) {
      for (const t of tasks) {
        if (WORK_KINDS.includes(t.kind) && t.status === TaskStatus.Review) this.deps.project.tasks.update(t.id, { status: TaskStatus.Done });
      }
      this.set(goal.id, { status: GoalStatus.Reporting });
      return;
    }
    if (goal.round < MAX_FIX_ROUNDS) {
      this.set(goal.id, { status: GoalStatus.Building, round: goal.round + 1 });
      return;
    }
    const what = [...openWork, ...qaLeft].map((t) => t.id).join(', ');
    this.block(goal.id, `QA still failing after ${MAX_FIX_ROUNDS} fix rounds (${what}). Review the bug tasks, then resume or request changes.`);
  }

  private async reportPhase(goal: Goal, roles: TeamRoles) {
    const out = await this.run(goal, roles, roles.lead, reportPrompt(goal, this.tasksOf(goal.id)), `Report on ${goal.id}`);
    if (this.interrupted(goal.id, out.aborted)) return;
    this.set(goal.id, { status: GoalStatus.Done, summary: out.text, reason: null });
    this.deps.notifications.create({
      kind: NotificationKind.GoalDone,
      title: `Done: ${goal.title}`,
      body: firstParagraph(out.text),
      goalId: goal.id,
      botId: roles.lead.id,
    });
    this.leadStatus(BotStatus.Idle);
  }

  // ---------- helpers ----------

  /** Hand a prompt to a bot as the Team Lead and wait. Throws if the run fails (not when stopped). */
  private async run(goal: Goal, roles: TeamRoles, bot: Bot, prompt: string, label: string): Promise<RunOutcome> {
    const ctl = this.control(goal.id);
    ctl.currentBot = bot.id;
    const fromLead = bot.id !== roles.lead.id;
    if (fromLead) this.deps.hub.emit({ type: AgentEventType.Delegation, from: roles.lead.id, to: bot.id, instruction: label });
    try {
      const out = await this.deps.team.dispatch(bot.id, prompt, fromLead ? roles.lead.id : ENGINE, { goalId: goal.id });
      if (!out.ok && !out.aborted) throw new Error(`${bot.name} failed: ${clip(out.text, 300)}`);
      return out;
    } finally {
      ctl.currentBot = undefined;
      this.changed();
    }
  }

  /** After a step: stop driving if cancelled, paused, or the bot was stopped by the human. */
  private interrupted(id: string, aborted = false): boolean {
    const ctl = this.control(id);
    if (ctl.cancel) return true;
    if (aborted) {
      this.pauseNow(id, 'A bot was stopped. Resume when ready.');
      return true;
    }
    if (ctl.pause) {
      this.pauseNow(id, 'Paused by you.');
      return true;
    }
    return false;
  }

  /** Which phase a paused goal should continue from. */
  private phaseFor(goal: Goal): Goal['status'] {
    const tasks = this.tasksOf(goal.id);
    const hasWork = tasks.some((t) => WORK_KINDS.includes(t.kind));
    if (!goal.approvedAt) return hasWork ? GoalStatus.AwaitingApproval : GoalStatus.Planning;
    if (tasks.some((t) => WORK_KINDS.includes(t.kind) && OPEN.includes(t.status))) return GoalStatus.Building;
    if (tasks.some((t) => t.kind === TaskKind.QA && t.status !== TaskStatus.Done)) return GoalStatus.Testing;
    return GoalStatus.Reporting;
  }

  private roles(goal: Goal): TeamRoles | null {
    const r = resolveRoles(this.deps.project.bots.list());
    if ('missing' in r) {
      this.fail(goal.id, `The team needs bots with these roles: ${r.missing.join(', ')}.`);
      return null;
    }
    return r;
  }

  private block(id: string, reason: string) {
    const goal = this.set(id, { status: GoalStatus.Paused, reason });
    this.deps.notifications.create({ kind: NotificationKind.Blocked, title: `Needs you: ${goal.title}`, body: reason, goalId: id });
    this.leadStatus(BotStatus.Waiting, `${id} · Needs you`);
  }

  private pauseNow(id: string, reason: string): Goal {
    this.control(id).pause = false;
    const goal = this.set(id, { status: GoalStatus.Paused, reason });
    this.leadStatus(BotStatus.Idle);
    return goal;
  }

  private fail(id: string, reason: string) {
    const goal = this.deps.project.goals.get(id);
    if (!goal || FINAL.includes(goal.status)) return;
    this.set(id, { status: GoalStatus.Failed, reason });
    this.deps.notifications.create({ kind: NotificationKind.GoalFailed, title: `Failed: ${goal.title}`, body: reason, goalId: id });
    this.leadStatus(BotStatus.Idle);
  }

  private leadStatus(status: BotStatus, activity?: string) {
    const lead = resolveLead(this.deps.project.bots.list());
    if (lead) this.deps.hub.emit({ type: AgentEventType.BotStatus, botId: lead.id, status, activity });
  }

  private set(id: string, patch: Parameters<Project['goals']['update']>[1]): Goal {
    const goal = this.deps.project.goals.update(id, patch);
    this.changed();
    return goal;
  }

  private tasksOf(goalId: string): Task[] {
    return this.deps.project.tasks.list({ goalId });
  }

  private require(id: string): Goal {
    const goal = this.deps.project.goals.get(id);
    if (!goal) throw new Error(`goal "${id}" not found`);
    return goal;
  }

  private control(id: string): Control {
    let c = this.controls.get(id);
    if (!c) {
      c = { running: false, pause: false, cancel: false, attempted: new Set() };
      this.controls.set(id, c);
    }
    return c;
  }

  private changed() {
    this.deps.boardChanged();
  }
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The report's first real sentence or paragraph, for notifications (the full report lives on the goal). */
function firstParagraph(md: string): string {
  const para = md
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^#{1,6}\s/.test(p) && !p.startsWith('|'));
  return clip((para ?? md).replace(/\*\*/g, ''), 300);
}
