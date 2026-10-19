import { createHash } from 'node:crypto';
import os from 'node:os';
import { AgentEventType, AuditKind, ActorType, BotStatus, FindingCategory, FindingSeverity, FindingSource, FindingStatus, GoalStatus, NotificationKind, RiskLevel, SecurityReviewMode, TaskKind, TaskStatus, WorkPhase } from '../../shared/enums.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BudgetSummary, ChangeGroup, Bot, Goal, GoalChanges, GoalPatch, GoalSource, PrDraft, Task } from '../../shared/types/index.js';
import type { NewGoalInput } from '../../core/repositories/goal.repository.js';
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
import type { LedgerService } from '../services/ledger.service.js';
import * as gg from '../git/goal-git.js';
import { checkBudget, dayKey, usd, WarnOnce, type BudgetCheck } from './budget.js';
import { buildPrBody, testsLine } from './pr-body.js';

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
  /** Run ledger: spend per goal and per day (budgets). */
  ledger?: LedgerService;
}

/** Pause reasons set by the budget gate start with this, so the UI can offer "Add budget and resume". */
export const BUDGET_PAUSE = 'Budget:';
/**
 * Where goal worktrees live: outside the repo (~/.agentroom/worktrees/<repo>-<hash>/<G-n>), so tools
 * that don't honour .gitignore (jest haste map, tsc/nx globs) never see a second copy of the code.
 */
export function worktreeHome(root: string) {
  const id = createHash('sha1').update(path.resolve(root)).digest('hex').slice(0, 8);
  return path.join(os.homedir(), '.agentroom', 'worktrees', `${path.basename(root)}-${id}`);
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
  /** The last run stopped at a budget cap (the goal is already paused with the reason). */
  budgetStop?: boolean;
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
  private warned = new WarnOnce();

  constructor(private readonly deps: GoalRunnerDeps) {}

  // ---------- commands ----------

  list(): Goal[] {
    return this.deps.project.goals.list();
  }

  /** "Name <email>" of the human using AgentRoom (for comments, reverts, audit). */
  human(): string {
    return this.deps.humanName?.() ?? 'human';
  }

  start(brief: string, title?: string, sources: GoalSource[] = [], securityReview?: SecurityReviewMode, attachments: readonly string[] = [], extra: Pick<NewGoalInput, 'template' | 'guidance'> = {}): Goal {
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
      ...extra,
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
    if (patch.budgetUsd !== undefined) {
      if (patch.budgetUsd !== null && !(typeof patch.budgetUsd === 'number' && patch.budgetUsd > 0)) throw new Error('Budget must be a positive amount in USD.');
      return this.set(id, { ...clean, budgetUsd: patch.budgetUsd });
    }
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
      await this.ensureWorkspace(this.require(id));
      const goal = this.require(id);
      const roles = this.roles(goal);
      if (!roles) return;

      switch (goal.status) {
        case GoalStatus.Planning:
          await this.planPhase(goal, roles);
          return;
        case GoalStatus.Building: {
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
    const before = await this.headOf(goal);
    const out = await this.run(goal, roles, roles.developer, buildPrompt(goal, repo.get(task.id)!, previousBlock), `Build ${task.id}: ${task.title}`, {
      phase: WorkPhase.Build,
      taskId: task.id,
    });
    await this.checkpoint(this.require(goal.id), task.id, before);
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
    const before = await this.headOf(goal);
    const out = await this.run(goal, roles, roles.qa, testPrompt(goal, task, devTasks, roles), `Test ${task.id}: ${task.title}`, {
      phase: WorkPhase.Testing,
      taskId: task.id,
    });
    await this.checkpoint(this.require(goal.id), task.id, before);
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

  // ---------- workspace (own branch + folder per goal) ----------

  /**
   * Remember the commit the goal starts from, and give the goal its own folder on its own branch
   * (a git worktree) so bots never touch the human's working copy. Falls back to the project root
   * (with a warning on the goal) when that isn't possible.
   */
  private async ensureWorkspace(goal: Goal) {
    const root = this.deps.project.root;
    const repo = await gg.isRepo(root);
    if (!goal.baseRef) {
      const base = repo ? await gg.head(root) : ((await this.deps.security?.head()) ?? null);
      if (base) goal = this.set(goal.id, { baseRef: base });
    }
    if (!repo || !this.deps.project.settings.get().worktrees.enabled || !goal.baseRef) return;
    if (goal.worktree && fs.existsSync(path.join(goal.worktree.path, '.git'))) return;
    if (!goal.worktree && goal.worktreeWarning) return;
    const dir = goal.worktree?.path ?? path.join(worktreeHome(root), goal.id);
    const branch = goal.worktree?.branch ?? gg.goalBranch(goal.id);
    try {
      await gg.createWorktree(root, dir, branch, goal.baseRef);
      this.set(goal.id, { worktree: { path: dir, branch }, worktreeWarning: null });
    } catch (err) {
      this.set(goal.id, { worktreeWarning: `Working in your project folder: couldn't create the goal's own folder (${(err as Error).message}).` });
    }
  }

  /** Folder the goal's bots work in. */
  cwdOf(goal: Goal): string {
    return goal.worktree && fs.existsSync(goal.worktree.path) ? goal.worktree.path : this.deps.project.root;
  }

  /** Current commit in the goal's own folder (null without one: no checkpoints in the human's working copy). */
  private async headOf(goal: Goal): Promise<string | null> {
    return goal.worktree && this.cwdOf(goal) === goal.worktree.path ? gg.head(goal.worktree.path) : null;
  }

  /** After a task's run: commit what changed in the goal's folder and record the task's commits. */
  private async checkpoint(goal: Goal, taskId: string, before: string | null) {
    if (!before || !goal.worktree) return;
    const cwd = goal.worktree.path;
    const task = this.deps.project.tasks.get(taskId);
    if (!task) return;
    try {
      await gg.commitAll(cwd, `${task.id}: ${task.title}`);
      const commits = await gg.commitsSince(cwd, before);
      if (!commits.length) return;
      this.deps.project.tasks.update(task.id, { commits: [...task.commits, ...commits.filter((c) => !task.commits.includes(c))] });
      this.deps.project.tasks.appendLog(task.id, ENGINE, `Checkpoint ${commits[commits.length - 1].slice(0, 8)} on ${goal.worktree.branch}.`);
      this.changed();
    } catch (err) {
      this.deps.project.tasks.appendLog(task.id, ENGINE, `Couldn't commit a checkpoint: ${(err as Error).message}`);
    }
  }

  /** Files changed by the goal (its branch vs where it started, plus uncommitted work), grouped by task. */
  async changes(id: string): Promise<GoalChanges> {
    const goal = this.require(id);
    const cwd = this.cwdOf(goal);
    const branch = goal.worktree?.branch ?? (await gg.currentBranch(cwd));
    if (!goal.baseRef) return { goalId: id, base: null, branch, cwd, files: [], groups: [], additions: 0, deletions: 0 };
    const files = await gg.changedFiles(cwd, goal.baseRef);
    const groups: ChangeGroup[] = [];
    const claimed = new Set<string>();
    for (const t of this.tasksOf(id).filter((t) => t.commits.length).sort((a, b) => a.order - b.order)) {
      const touched = new Set<string>();
      for (const c of t.commits) for (const f of await gg.filesOf(cwd, c)) touched.add(f);
      t.commits.forEach((c) => claimed.add(c));
      groups.push({ taskId: t.id, title: t.title, commits: t.commits, files: [...touched].sort(), ...(t.reverted ? { reverted: true } : {}) });
    }
    if (goal.worktree) {
      const other = (await gg.logSince(cwd, goal.baseRef)).filter((c) => !claimed.has(c.sha));
      if (other.length) {
        const touched = new Set<string>();
        for (const c of other) for (const f of await gg.filesOf(cwd, c.sha)) touched.add(f);
        groups.push({ taskId: null, title: 'Other commits', commits: other.map((c) => c.sha), files: [...touched].sort() });
      }
    }
    const pending = files.filter((f) => f.uncommitted).map((f) => f.path);
    if (pending.length) groups.push({ taskId: null, title: 'Not committed yet', commits: [], files: pending });
    return {
      goalId: id,
      base: goal.baseRef,
      branch,
      cwd,
      files,
      groups,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
    };
  }

  /** Undo a task's checkpoint commits in the goal's branch. */
  async revertTask(goalId: string, taskId: string, by: string): Promise<Task> {
    const goal = this.require(goalId);
    if (this.isRunning(goalId)) throw new Error(`${goalId} is running. Pause it before reverting.`);
    if (!goal.worktree) throw new Error(`${goalId} has no branch of its own, so its changes can't be reverted per task.`);
    const task = this.deps.project.tasks.get(taskId);
    if (!task || task.goalId !== goalId) throw new Error(`task "${taskId}" isn't part of ${goalId}`);
    if (task.reverted) throw new Error(`${taskId} is already reverted.`);
    if (!task.commits.length) throw new Error(`${taskId} has no commits to revert.`);
    const reverts = await gg.revertCommits(this.cwdOf(goal), task.commits);
    const next = this.deps.project.tasks.update(taskId, { reverted: true });
    this.deps.project.tasks.appendLog(taskId, by, `Reverted by ${by} (${reverts.length} revert ${reverts.length === 1 ? 'commit' : 'commits'}).`);
    this.deps.audit?.({ kind: AuditKind.Goal, actor: { type: ActorType.Human, name: by }, goalId, summary: `Reverted ${taskId} in ${goalId}`, decision: 'allowed', detail: { commits: task.commits, reverts } });
    this.changed();
    return next;
  }

  // ---------- review comments ----------

  addComment(goalId: string, input: { file: string; line?: number; body: string }, author: string): Goal {
    const goal = this.require(goalId);
    const body = String(input.body ?? '').trim();
    const file = String(input.file ?? '').trim();
    if (!body) throw new Error('Write a comment first.');
    if (!file) throw new Error('A comment needs a file.');
    const comment = {
      id: randomUUID(),
      file,
      ...(typeof input.line === 'number' && input.line > 0 ? { line: Math.floor(input.line) } : {}),
      body,
      author,
      createdAt: new Date().toISOString(),
      resolved: false,
      sent: false,
    };
    return this.set(goalId, { reviewComments: [...goal.reviewComments, comment] });
  }

  deleteComment(goalId: string, commentId: string): Goal {
    const goal = this.require(goalId);
    if (!goal.reviewComments.some((c) => c.id === commentId)) throw new Error('Comment not found.');
    return this.set(goalId, { reviewComments: goal.reviewComments.filter((c) => c.id !== commentId) });
  }

  /** Send the open review comments to the Developer as a fix round (QA re-tests afterwards). */
  requestChanges(goalId: string): Goal {
    const goal = this.require(goalId);
    if (this.isRunning(goalId)) throw new Error(`${goalId} is still running; pause it or wait for it to finish.`);
    if (!goal.approvedAt) throw new Error(`${goalId}'s plan isn't approved yet. Use "Request changes" on the plan instead.`);
    const open = goal.reviewComments.filter((c) => !c.sent && !c.resolved);
    if (!open.length) throw new Error('There are no new review comments to send.');
    const roles = resolveRoles(this.deps.project.bots.list());
    const developer = 'missing' in roles ? undefined : roles.developer;
    const where = (c: (typeof open)[number]) => `\`${c.file}${c.line ? `:${c.line}` : ''}\``;
    const task = this.deps.project.tasks.create({
      title: `Review changes (${open.length} ${open.length === 1 ? 'comment' : 'comments'})`,
      kind: TaskKind.Bug,
      goalId,
      ...(developer ? { assignee: developer.id } : {}),
      description: ['The human reviewed the diff and asked for these changes:', '', ...open.map((c) => `- ${where(c)}: ${c.body}`)].join('\n'),
      acceptance: open.map((c) => `${c.file}${c.line ? `:${c.line}` : ''}: ${c.body}`.slice(0, 200)),
    });
    for (const t of this.tasksOf(goalId)) {
      if (t.kind === TaskKind.QA && t.status === TaskStatus.Done) this.deps.project.tasks.update(t.id, { status: TaskStatus.Todo });
    }
    const sentIds = new Set(open.map((c) => c.id));
    const next = this.set(goalId, {
      status: GoalStatus.Building,
      round: goal.round + 1,
      reason: null,
      reviewComments: goal.reviewComments.map((c) => (sentIds.has(c.id) ? { ...c, sent: true } : c)),
    });
    this.deps.project.tasks.appendLog(task.id, ENGINE, 'Created from review comments.');
    this.kick(goalId);
    return next;
  }

  // ---------- publish ----------

  /** Prefilled PR for the goal. */
  async prDraft(goalId: string): Promise<PrDraft> {
    const goal = this.require(goalId);
    const tasks = this.tasksOf(goalId);
    const openFindings = this.deps.security?.findings.list({ goalId, status: FindingStatus.Open }).length ?? 0;
    return {
      title: goal.title,
      body: buildPrBody(goal, tasks, openFindings, await this.originRepo()),
      branch: goal.worktree?.branch ?? null,
      openFindings,
      tests: testsLine(tasks),
    };
  }

  /** Push the goal's branch and open a pull request with gh. */
  async openPr(goalId: string, input: { title?: string; body?: string; draft?: boolean }): Promise<Goal> {
    const goal = this.require(goalId);
    if (this.isRunning(goalId)) throw new Error(`${goalId} is still running. Wait for it to finish or pause it.`);
    if (!goal.worktree) throw new Error(`${goalId} worked in your own folder, so there's no branch to push. Commit and open the PR yourself.`);
    const cwd = this.cwdOf(goal);
    await gg.commitAll(cwd, `${goal.id}: remaining changes`).catch(() => null);
    const draft = await this.prDraft(goalId);
    const title = input.title?.trim() || draft.title;
    const body = input.body?.trim() || draft.body;
    await gg.push(cwd, goal.worktree.branch);
    const pr = await gg.createPr(cwd, { title, body, head: goal.worktree.branch, draft: !!input.draft });
    return this.set(goalId, { pr });
  }

  /** Merge the goal's branch into the branch checked out in the project (no PR). */
  async mergeLocal(goalId: string): Promise<Goal> {
    const goal = this.require(goalId);
    if (this.isRunning(goalId)) throw new Error(`${goalId} is still running.`);
    if (!goal.worktree) throw new Error(`${goalId} already worked in your own folder; there's nothing to merge.`);
    if (fs.existsSync(goal.worktree.path)) await gg.commitAll(goal.worktree.path, `${goal.id}: remaining changes`).catch(() => null);
    await gg.mergeInto(this.deps.project.root, goal.worktree.branch, `Merge ${goal.id}: ${goal.title}`);
    return this.require(goalId);
  }

  /** Remove the goal's folder; its branch stays (resuming the goal recreates the folder). */
  async cleanup(goalId: string): Promise<Goal> {
    const goal = this.require(goalId);
    if (this.isRunning(goalId)) throw new Error(`${goalId} is still running.`);
    if (!goal.worktree) throw new Error(`${goalId} has no folder of its own.`);
    await gg.removeWorktree(this.deps.project.root, goal.worktree.path);
    return this.set(goalId, { worktreeWarning: `Folder removed; branch ${goal.worktree.branch} is kept.` });
  }

  /** owner/repo of the origin remote (to write cross-repo "Closes" lines), if it's on GitHub. */
  private async originRepo(): Promise<string | undefined> {
    const out = await gg.run('git', ['remote', 'get-url', 'origin'], this.deps.project.root);
    const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\s*$/.exec(out.stdout.trim());
    return m?.[1];
  }

  // ---------- budgets ----------

  /** Spend and caps for the UI. */
  budgetSummary(): BudgetSummary {
    const b = this.deps.project.settings.get().budgets;
    const ledger = this.deps.ledger;
    const goals: BudgetSummary['goals'] = {};
    for (const g of this.list()) goals[g.id] = { spent: ledger?.spentForGoal(g.id) ?? 0, cap: g.budgetUsd ?? b.perGoalUsd };
    return { spentToday: ledger?.spentToday() ?? 0, perDayUsd: b.perDayUsd, perGoalUsd: b.perGoalUsd, warnAt: b.warnAt, goals };
  }

  private budgetFor(goal: Goal): BudgetCheck {
    const b = this.deps.project.settings.get().budgets;
    const ledger = this.deps.ledger;
    return checkBudget({
      goalCap: goal.budgetUsd ?? b.perGoalUsd,
      goalSpent: ledger?.spentForGoal(goal.id) ?? 0,
      dayCap: b.perDayUsd,
      daySpent: ledger?.spentToday() ?? 0,
      warnAt: b.warnAt,
    });
  }

  /** Pause the goal at a used-up cap (one Blocked notification). */
  private budgetPause(goal: Goal, scope: 'goal' | 'day') {
    const b = this.deps.project.settings.get().budgets;
    const cap = scope === 'goal' ? (goal.budgetUsd ?? b.perGoalUsd ?? 0) : (b.perDayUsd ?? 0);
    const reason =
      scope === 'goal'
        ? `${BUDGET_PAUSE} paused at its ${usd(cap)} budget. Raise the budget to continue, or stop here.`
        : `${BUDGET_PAUSE} paused because today's ${usd(cap)} budget is used up. Raise it in Settings → Budgets, or resume tomorrow.`;
    this.block(goal.id, reason);
  }

  private budgetWarn(goal: Goal, check: BudgetCheck) {
    const b = this.deps.project.settings.get().budgets;
    const pct = Math.round(b.warnAt * 100);
    if (check.warn.includes('goal')) {
      const cap = goal.budgetUsd ?? b.perGoalUsd ?? 0;
      if (this.warned.first(`goal:${goal.id}:${cap}`)) {
        this.deps.notifications.create({ kind: NotificationKind.Info, title: `${goal.id} used ${pct}% of its ${usd(cap)} budget`, body: `It pauses when the budget is used up.`, goalId: goal.id });
      }
    }
    if (check.warn.includes('day') && this.warned.first(`day:${dayKey()}`)) {
      this.deps.notifications.create({ kind: NotificationKind.Info, title: `${pct}% of today's ${usd(b.perDayUsd ?? 0)} budget used`, body: 'Goals pause when it runs out.' });
    }
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
    const budget = this.budgetFor(this.require(goal.id));
    if (budget.exceeded) {
      this.budgetPause(goal, budget.exceeded);
      ctl.budgetStop = true;
      return { ok: false, text: 'Budget used up.', aborted: true };
    }
    this.budgetWarn(goal, budget);
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
        cwd: this.cwdOf(this.require(goal.id)),
        ...(Number.isFinite(budget.remaining) ? { maxBudgetUsd: budget.remaining } : {}),
        ...(ctx.phase === WorkPhase.Planning && files.length ? { attachments: files.map((a) => a.id) } : {}),
      });
      if (!out.ok && !out.aborted) {
        // The SDK stops a run at its budget: pause with the reason instead of failing the goal.
        const after = this.budgetFor(this.require(goal.id));
        if (after.exceeded) {
          this.budgetPause(goal, after.exceeded);
          ctl.budgetStop = true;
          return { ...out, aborted: true };
        }
        throw new Error(`${bot.name} failed: ${clip(out.text, 300)}`);
      }
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
    if (ctl.budgetStop) {
      ctl.budgetStop = false;
      return true;
    }
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
