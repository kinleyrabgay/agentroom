import { AgentEventType, AuditKind, ActorType, BotStatus, FindingCategory, FindingSeverity, FindingSource, GoalStatus, NotificationKind, RiskLevel, SecurityReviewMode, TaskKind, TaskStatus, WorkPhase } from '../../shared/enums.js';
import type { Bot, Goal, GoalPatch, GoalSource, Task } from '../../shared/types/index.js';
import type { Project } from '../../core/project.js';
import type { RunOutcome, Team } from '../agents/team.js';
import { isFinished } from '../agents/tools/task.tools.js';
import { GOAL_TITLE_MAX, MAX_FIX_ROUNDS } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';
import type { NotificationService } from '../services/notification.service.js';
import { buildPrompt, planPrompt, reportPrompt, securityPrompt, testPrompt } from './prompts.js';
import { resolveLead, resolveRoles, resolveSecurity, type TeamRoles } from './roles.js';
import type { SecurityService } from '../security/security.service.js';
import { SENSITIVE_FACTOR } from '../security/risk.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import { attachmentLines, type ResolvedAttachment, type UploadStore } from '../services/upload.store.js';

export interface GoalRunnerDeps {
  project: Project;
  team: Team;
  hub: Hub;
  notifications: NotificationService;
  /** Board written — push it to the UI now. */
  boardChanged: () => void;
  /** Security layer: base commit, risk score, Security phase, high-risk gate. Without it those steps are skipped. */
  security?: SecurityService;
  audit?: (entry: NewAuditEntry) => void;
  /** "Name <email>" of the human (for risk approvals). */
  humanName?: () => string;
  /** Files attached to goal briefs. */
  uploads?: UploadStore;
}

/** Prefix of the pause reason used by the high-risk gate; resuming such a goal approves the risk. */
const RISK_GATE = 'High risk';

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
const ACTIVE: Goal['status'][] = [GoalStatus.Planning, GoalStatus.Building, GoalStatus.Securing, GoalStatus.Testing, GoalStatus.Reporting];
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

  start(brief: string, title?: string, sources: GoalSource[] = [], securityReview?: SecurityReviewMode, attachments: readonly string[] = []): Goal {
    const text = brief.trim();
    if (!text) throw new Error('Describe the goal first.');
    if (attachments.length && !this.deps.uploads) throw new Error('Attachments are not available.');
    // Validates the ids (throws on unknown ones) before the goal exists.
    const files = attachments.length ? this.deps.uploads!.resolve(attachments).map((a) => a.id) : [];
    const firstLine = text.split('\n')[0].trim();
    const goal = this.deps.project.goals.create({
      title: (title?.trim() || firstLine).slice(0, GOAL_TITLE_MAX),
      brief: text,
      sources,
      ...(securityReview ? { securityReview: checkReviewMode(securityReview) } : {}),
      ...(files.length ? { attachments: files } : {}),
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
    if (goal.reason?.startsWith(RISK_GATE) && goal.risk) this.approveRisk(goal);
    const status = this.phaseFor(this.require(id));
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
    if (patch.securityReview !== undefined) clean.securityReview = checkReviewMode(patch.securityReview);
    return this.set(id, clean);
  }

  remove(id: string): void {
    this.require(id);
    if (this.isRunning(id)) throw new Error(`${id} is running. Cancel it first.`);
    this.deps.project.goals.delete(id);
    this.controls.delete(id);
    this.changed();
  }

  /** Re-scan a goal's diff (incl. dependencies) and update its risk score now. */
  async refreshRisk(id: string): Promise<Goal> {
    this.require(id);
    await this.updateRisk(id, { dependencies: true });
    return this.require(id);
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
          await this.ensureBase(goal);
          const r = await this.buildStep(this.require(id), roles);
          if (this.interrupted(id, r === 'aborted')) return;
          if (r === 'none') {
            if (!(await this.afterBuilding(this.require(id)))) return;
          } else if (typeof r === 'object') return void this.block(id, r.blocked);
          break;
        }
        case GoalStatus.Securing: {
          const out = await this.securityStep(goal, roles);
          if (out === 'aborted' && this.interrupted(id, true)) return;
          if (out === 'stop') return;
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
    const out = await this.run(goal, roles, roles.planner, planPrompt(goal, roles, this.tasksOf(goal.id)), `Plan ${goal.id}: ${goal.title}`, { phase: WorkPhase.Planning });
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
    const out = await this.run(goal, roles, roles.developer, buildPrompt(goal, repo.get(task.id)!, previousBlock), `Build ${task.id}: ${task.title}`, {
      phase: WorkPhase.Build,
      taskId: task.id,
    });
    if (out.aborted) return 'aborted';

    await this.updateRisk(goal.id);
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
    const out = await this.run(goal, roles, roles.qa, testPrompt(goal, task, devTasks, roles), `Test ${task.id}: ${task.title}`, {
      phase: WorkPhase.Testing,
      taskId: task.id,
    });
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
    const out = await this.run(goal, roles, roles.lead, reportPrompt(goal, this.tasksOf(goal.id)), `Report on ${goal.id}`, { phase: WorkPhase.Reporting });
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

  // ---------- security ----------

  /** Remember the commit the goal's work starts from (diffs, risk and scans are relative to it). */
  private async ensureBase(goal: Goal) {
    if (goal.baseRef || !this.deps.security) return;
    const head = await this.deps.security.head();
    if (head) this.set(goal.id, { baseRef: head });
  }

  /** Re-scan the goal's diff and store its risk score. Scanner/risk problems never stop the goal. */
  private async updateRisk(id: string, opts: { dependencies?: boolean } = { dependencies: false }) {
    if (!this.deps.security) return;
    try {
      const a = await this.deps.security.assessGoal(this.require(id), opts);
      this.set(id, { risk: a.risk });
    } catch (err) {
      console.warn(`[agentroom] risk assessment for ${id} failed:`, (err as Error).message);
    }
  }

  /**
   * Whether the goal gets a Security review: sensitive paths always; else the goal's mode
   * (auto → the team default) — always / off / auto (medium or high risk).
   */
  private needsSecurity(goal: Goal): boolean {
    if (!this.deps.security) return false;
    if (goal.risk?.factors.some((f) => f.label.startsWith(SENSITIVE_FACTOR))) return true;
    const mode = goal.securityReview !== SecurityReviewMode.Auto ? goal.securityReview : this.deps.project.settings.get().security.review;
    if (mode === SecurityReviewMode.Always) return true;
    if (mode === SecurityReviewMode.Off) return false;
    return !!goal.risk && goal.risk.level !== RiskLevel.Low;
  }

  /** Building finished: full scan (incl. dependencies), then Security review or straight to Testing. Returns false if the goal stopped. */
  private async afterBuilding(goal: Goal): Promise<boolean> {
    await this.updateRisk(goal.id, { dependencies: true });
    const fresh = this.require(goal.id);
    if (this.needsSecurity(fresh) && fresh.securityReviewedRound !== fresh.round) {
      this.set(goal.id, { status: GoalStatus.Securing });
      return true;
    }
    return this.toTesting(fresh);
  }

  /** Enter Testing, unless a high-risk diff needs the human's approval first. Returns false when paused. */
  private toTesting(goal: Goal): boolean {
    const risk = goal.risk;
    const gated = this.deps.security && risk?.level === RiskLevel.High && this.deps.project.settings.get().security.riskGates;
    if (gated && !(goal.riskApproval && goal.riskApproval.score >= risk.score)) {
      const top = risk.factors.slice().sort((a, b) => b.points - a.points).slice(0, 3).map((f) => f.label).join('; ');
      this.block(goal.id, `${RISK_GATE} (score ${risk.score}): ${top}. Review the changes, then press Resume to approve and continue to testing.`, NotificationKind.Security);
      return false;
    }
    this.set(goal.id, { status: GoalStatus.Testing });
    return true;
  }

  /** The human resumed a goal held by the high-risk gate: that's their approval of this risk score. */
  private approveRisk(goal: Goal) {
    const by = this.deps.humanName?.() ?? 'human';
    this.set(goal.id, { riskApproval: { score: goal.risk!.score, at: new Date().toISOString(), by } });
    this.deps.audit?.({
      kind: AuditKind.Security,
      actor: { type: ActorType.Human, name: by },
      goalId: goal.id,
      summary: `Approved high-risk changes in ${goal.id} (score ${goal.risk!.score})`,
      decision: 'allowed',
      detail: { risk: goal.risk },
    });
  }

  /** Security phase: the Security Auditor reviews the diff; must-fix issues become bug tasks (another build round). */
  private async securityStep(goal: Goal, roles: TeamRoles): Promise<'next' | 'aborted' | 'stop'> {
    const security = this.deps.security!;
    const auditor = resolveSecurity(this.deps.project.bots.list());
    if (!auditor) {
      security.findings.record(
        [{ severity: FindingSeverity.Info, category: FindingCategory.Other, source: FindingSource.Review, rule: 'review.skipped', title: 'Security review skipped', detail: 'No bot with the "security" role is on the team. Add a Security Auditor to review risky changes.' }],
        { goalId: goal.id },
      );
    } else {
      this.leadStatus(BotStatus.Working, `${goal.id} · Security review with ${auditor.name}`);
      const assessment = await security.assessGoal(goal, { dependencies: false });
      const prompt = securityPrompt(goal, assessment, this.tasksOf(goal.id), roles);
      const out = await this.run(goal, roles, auditor, prompt, `Security review of ${goal.id}`, { phase: WorkPhase.Security });
      if (out.aborted) return 'aborted';
      if (this.interrupted(goal.id)) return 'stop';
    }
    this.set(goal.id, { securityReviewedRound: goal.round });
    await this.updateRisk(goal.id);
    const fresh = this.require(goal.id);

    const bugs = this.tasksOf(goal.id).filter((t) => WORK_KINDS.includes(t.kind) && OPEN.includes(t.status));
    if (bugs.length) {
      if (fresh.round >= MAX_FIX_ROUNDS) {
        this.block(goal.id, `Security review opened fixes (${bugs.map((t) => t.id).join(', ')}) but the fix-round limit is reached. Review them, then resume.`, NotificationKind.Security);
        return 'stop';
      }
      this.set(goal.id, { status: GoalStatus.Building, round: fresh.round + 1 });
      return 'next';
    }
    const critical = security.findings.openBlocking(goal.id, 'critical');
    if (critical.length) {
      this.block(goal.id, `Security review found ${critical.length} critical ${critical.length === 1 ? 'issue' : 'issues'}: ${critical.slice(0, 3).map((f) => f.title).join('; ')}. Approve or dismiss them on the Security page, or request changes.`, NotificationKind.Security);
      return 'stop';
    }
    return this.toTesting(fresh) ? 'next' : 'stop';
  }

  // ---------- helpers ----------

  /** Hand a prompt to a bot as the Team Lead and wait. Throws if the run fails (not when stopped). */
  private async run(
    goal: Goal,
    roles: TeamRoles,
    bot: Bot,
    prompt: string,
    label: string,
    ctx: { phase: WorkPhase; taskId?: string },
  ): Promise<RunOutcome> {
    const ctl = this.control(goal.id);
    ctl.currentBot = bot.id;
    const fromLead = bot.id !== roles.lead.id;
    if (fromLead) this.deps.hub.emit({ type: AgentEventType.Delegation, from: roles.lead.id, to: bot.id, instruction: label }, { goalId: goal.id });
    try {
      // Files attached to the brief: the Planner gets them as content (images, PDFs…); every bot gets their paths.
      const files = this.attachmentsOf(goal);
      const fullPrompt = files.length ? `${prompt}\n\n## Files the human attached to this goal\n${attachmentLines(files)}` : prompt;
      const out = await this.deps.team.dispatch(bot.id, fullPrompt, fromLead ? roles.lead.id : ENGINE, {
        goalId: goal.id,
        ...ctx,
        ...(ctx.phase === WorkPhase.Planning && files.length ? { attachments: files.map((a) => a.id) } : {}),
      });
      if (!out.ok && !out.aborted) throw new Error(`${bot.name} failed: ${clip(out.text, 300)}`);
      return out;
    } finally {
      ctl.currentBot = undefined;
      this.changed();
    }
  }

  /** The goal's attachments that still exist (uploads expire after the retention period). */
  private attachmentsOf(goal: Goal): ResolvedAttachment[] {
    if (!goal.attachments?.length || !this.deps.uploads) return [];
    return goal.attachments.flatMap((id) => {
      const a = this.deps.uploads!.get(id);
      return a ? [a] : [];
    });
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
    if (this.needsSecurity(goal) && goal.securityReviewedRound !== goal.round) return GoalStatus.Securing;
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

  private block(id: string, reason: string, kind: NotificationKind = NotificationKind.Blocked) {
    const goal = this.set(id, { status: GoalStatus.Paused, reason });
    this.deps.notifications.create({ kind, title: `Needs you: ${goal.title}`, body: reason, goalId: id });
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

function checkReviewMode(mode: unknown): SecurityReviewMode {
  if (!Object.values(SecurityReviewMode).includes(mode as SecurityReviewMode)) {
    throw new Error(`securityReview must be one of: ${Object.values(SecurityReviewMode).join(', ')}`);
  }
  return mode as SecurityReviewMode;
}
