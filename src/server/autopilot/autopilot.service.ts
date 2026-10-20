import path from 'node:path';
import { AuditKind, ActorType, NotificationKind } from '../../shared/enums.js';
import type { AutopilotIssueRun, Bot, Goal, GoalAutopilot, GoalSource, GoalTemplate, SentryIssueDetail, Settings } from '../../shared/types/index.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import { buildSentryBrief } from '../integrations/sentry/sentry-handoff.js';
import { confidenceOf, mayAutoOpen } from './confidence.js';
import { parseTestCommand, safeTestFile, verifyFailPass, type FailPass } from './verify.js';

/** The template autopilot goals start from (its guidance tells the Planner to reproduce first). */
export const AUTOPILOT_TEMPLATE = 'reproduce-first';
/** Pause reason when the bug couldn't be reproduced. */
export const NOT_REPRODUCED = "Autopilot: couldn't reproduce";

/** The slice of the goal runner autopilot drives. */
export interface AutopilotGoals {
  list(): Goal[];
  get(id: string): Goal | undefined;
  start(brief: string, title: string, sources: GoalSource[], template: { id: string; name: string; guidance: string } | null): Goal;
  update(id: string, patch: { autopilot?: GoalAutopilot; budgetUsd?: number }): Goal;
  changedFiles(id: string): Promise<string[]>;
  cwdOf(goal: Goal): string;
  openPr(id: string): Promise<Goal>;
  isRunning(id: string): boolean;
  /** Workspaces: the goal's part in another repo (repo root, the goal's folder there, its starting commit), or null. */
  repoTarget?(goal: Goal, repo: string): { root: string; head: string; baseRef?: string } | null;
  /** Workspaces: the goal changes repos besides the primary one. */
  spansRepos?(goal: Goal): boolean;
}

export interface AutopilotDeps {
  root: string;
  goals: () => AutopilotGoals;
  detail: (issueId: string) => Promise<SentryIssueDetail>;
  template: () => GoalTemplate | undefined;
  bots: () => Bot[];
  settings: () => Settings;
  notify: (n: { kind: NotificationKind; title: string; body: string; goalId?: string }) => void;
  audit: (e: NewAuditEntry) => void;
  /** Error text from the running app is untrusted. */
  guard?: (text: string, source: string) => string;
  /** Modules affected by these files (context map), or null when unknown. */
  impact?: (files: string[]) => number | null;
  /** Throwaway checkouts of the starting commit. */
  scratchDir: string;
  /** Injected in tests. */
  verify?: typeof verifyFailPass;
}

/**
 * Sentry incident autopilot: start a reproduce-first goal for an issue, hold it when the bug can't be
 * reproduced, check on its own that the new test fails before and passes after the fix, score
 * confidence, and open the PR only when the trigger, the settings and the score all allow it.
 */
export class AutopilotService {
  private verifying = new Set<string>();

  constructor(private readonly deps: AutopilotDeps) {}

  /** Start an autopilot goal for one Sentry issue. */
  async startFromSentry(issueId: string, opts: { triggerId?: string; autoPr?: boolean; budgetUsd?: number; by: string }): Promise<Goal> {
    const goals = this.deps.goals();
    const running = goals.list().find((g) => g.autopilot?.issueId === issueId && !['done', 'cancelled', 'failed'].includes(g.status));
    if (running) throw new Error(`${running.id} is already working on this issue.`);
    const detail = await this.deps.detail(issueId);
    const { issue } = detail;
    const brief = [
      'Autopilot: reproduce this production error first, prove it with a failing test, then fix it.',
      buildSentryBrief([detail], { note: '', files: [], links: [], guard: this.deps.guard, sentryTools: false }),
      'When you have reproduced it (or are sure you can\'t), call `autopilot_report`. AgentRoom then checks on its own that the test fails on the starting commit and passes on your fix.',
    ].join('\n\n');
    const source: GoalSource = {
      type: 'sentry',
      itemId: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      ...(issue.permalink ? { url: issue.permalink } : {}),
      ...(issue.project.slug ? { project: issue.project.slug } : {}),
    };
    const t = this.deps.template();
    const goal = goals.start(brief, `Autopilot ${issue.shortId}: ${issue.title}`.slice(0, 80), [source], t ? { id: t.id, name: t.name, guidance: t.guidance } : null);
    const autopilot: GoalAutopilot = {
      source: 'sentry',
      issueId: issue.id,
      shortId: issue.shortId,
      title: issue.title,
      ...(issue.permalink ? { permalink: issue.permalink } : {}),
      ...(opts.triggerId ? { triggerId: opts.triggerId } : {}),
      autoPr: !!opts.autoPr,
      status: 'reproducing',
    };
    const next = goals.update(goal.id, { autopilot, ...(opts.budgetUsd ? { budgetUsd: opts.budgetUsd } : {}) });
    this.deps.audit({
      kind: AuditKind.Goal,
      actor: { type: opts.triggerId ? ActorType.System : ActorType.Human, name: opts.by },
      goalId: goal.id,
      summary: `Autopilot started ${goal.id} for Sentry ${issue.shortId}${opts.autoPr ? ' (may open the PR when confident)' : ''}`,
    });
    return next;
  }

  /** Autopilot goals for an issue (Sentry page). */
  runs(issueId: string): AutopilotIssueRun[] {
    return this.deps
      .goals()
      .list()
      .filter((g) => g.autopilot?.issueId === issueId)
      .map((g) => ({
        goalId: g.id,
        title: g.title,
        status: g.autopilot!.status,
        goalStatus: g.status,
        ...(g.autopilot!.confidence ? { confidence: g.autopilot!.confidence.score } : {}),
        ...(g.pr ? { pr: g.pr.url } : {}),
        startedAt: g.createdAt,
      }))
      .reverse();
  }

  /** From the `autopilot_report` tool: what the bot found. Returns a line for the bot. */
  report(goalId: string, input: { reproduced: boolean; how: string; testFile?: string; testCommand?: string; repo?: string }): string {
    const goals = this.deps.goals();
    const goal = goals.get(goalId);
    if (!goal?.autopilot) return 'This goal is not an autopilot goal; nothing recorded.';
    const a = goal.autopilot;
    if (!input.reproduced) {
      goals.update(goalId, { autopilot: { ...a, reproduced: false, how: input.how.slice(0, 2000), status: 'not_reproduced' } });
      return 'Recorded: not reproduced. AgentRoom will stop and ask the human; finish your current step and stop.';
    }
    const problems: string[] = [];
    let test: GoalAutopilot['test'];
    if (input.testFile && input.testCommand) {
      const cmd = parseTestCommand(input.testCommand);
      const target = input.repo ? goals.repoTarget?.(goal, input.repo) : undefined;
      if (input.repo && !target) problems.push(`Unknown repo "${input.repo}".`);
      const file = safeTestFile(target?.head ?? goal.worktree?.path ?? this.deps.root, input.testFile);
      if ('error' in cmd) problems.push(cmd.error);
      if ('error' in file) problems.push(file.error);
      if (!problems.length && !('error' in cmd) && !('error' in file)) test = { file: file.rel, command: input.testCommand.trim().replace(/\s+/g, ' '), ...(input.repo ? { repo: input.repo } : {}) };
    } else problems.push('No failing test given: pass testFile and testCommand once the test exists.');
    goals.update(goalId, { autopilot: { ...a, reproduced: true, how: input.how.slice(0, 2000), status: 'reproduced', ...(test ? { test } : {}) } });
    return problems.length ? `Recorded as reproduced, but: ${problems.join(' ')} Call autopilot_report again with a valid test file and command.` : `Recorded. AgentRoom will run \`${test!.command}\` on the starting commit (must fail) and on your fix (must pass).`;
  }

  /** Before each engine step: hold a goal whose bug couldn't be reproduced. Returns the pause reason. */
  gate(goal: Goal): string | null {
    const a = goal.autopilot;
    if (!a || a.status !== 'not_reproduced') return null;
    this.deps.goals().update(goal.id, { autopilot: { ...a, status: 'needs_human' } });
    this.deps.notify({
      kind: NotificationKind.Blocked,
      title: `${a.shortId}: couldn't reproduce`,
      body: `${goal.id} stopped instead of guessing a fix.${a.how ? ` What was tried: ${a.how.slice(0, 300)}` : ''} Add steps or data and resume, or cancel.`,
      goalId: goal.id,
    });
    return `${NOT_REPRODUCED} ${a.shortId}. Add details and resume, or cancel.`;
  }

  /** Before the report: verify the failing test (fail → pass) and score confidence. Never throws. */
  async beforeReport(goal: Goal, cwd: string, signal?: AbortSignal): Promise<void> {
    if (!goal.autopilot) return;
    await this.verify(goal.id, cwd, signal).catch((err) => console.warn(`[agentroom] autopilot verify ${goal.id}:`, (err as Error).message));
  }

  /** Re-run the check (also from the UI). */
  async verify(goalId: string, cwd?: string, signal?: AbortSignal): Promise<Goal> {
    const goals = this.deps.goals();
    const goal = goals.get(goalId);
    if (!goal?.autopilot) throw new Error(`${goalId} is not an autopilot goal.`);
    if (this.verifying.has(goalId)) throw new Error(`Already checking ${goalId}.`);
    this.verifying.add(goalId);
    try {
      const a = goal.autopilot;
      let check: FailPass | null = null;
      // A test in another repo of a workspace runs in that repo: its folder for the fix, its starting commit for the base.
      const other = a.test?.repo ? goals.repoTarget?.(goal, a.test.repo) : undefined;
      const where = other ? { root: other.root, head: other.head, baseRef: other.baseRef } : { root: this.deps.root, head: cwd ?? goals.cwdOf(goal), baseRef: goal.baseRef };
      if (a.test && where.baseRef) {
        check = await (this.deps.verify ?? verifyFailPass)({
          root: where.root,
          head: where.head,
          baseRef: where.baseRef,
          test: { file: a.test.file, command: a.test.command },
          scratchDir: path.join(this.deps.scratchDir, `${goal.id.replace(/[^A-Za-z0-9_-]/g, '_')}-autopilot-base`),
          ...(signal ? { signal } : {}),
        });
      }
      const verification = check ? { failsOnBase: check.failsOnBase, passesOnHead: check.passesOnHead, at: new Date().toISOString(), detail: check.detail } : a.verification;
      const files = await goals.changedFiles(goalId).catch(() => [] as string[]);
      let impact: number | null = null;
      try {
        impact = files.length && this.deps.impact ? this.deps.impact(files) : null;
      } catch {
        impact = null;
      }
      const fresh = goals.get(goalId)!;
      const confidence = confidenceOf({ reproduced: a.reproduced, verification, impactModules: impact, riskScore: fresh.risk?.score ?? null, proof: fresh.proof });
      const verified = verification?.failsOnBase === true && verification?.passesOnHead === true;
      return goals.update(goalId, {
        autopilot: { ...(fresh.autopilot ?? a), ...(verification ? { verification } : {}), confidence, status: verified ? 'verified' : a.status === 'needs_human' ? 'needs_human' : 'unverified' },
      });
    } finally {
      this.verifying.delete(goalId);
    }
  }

  /** The goal is done: open the PR when allowed, else tell the human it's ready. */
  async afterDone(goal: Goal): Promise<void> {
    const a = goal.autopilot;
    if (!a || goal.pr) return;
    const s = this.deps.settings().autopilot;
    const goals = this.deps.goals();
    // A fix that spans several repos needs one PR per repo, each opened by the human.
    const allow = goals.spansRepos?.(goal) ? { ok: false, why: 'The fix changes more than one repo, so each PR waits for you.' } : mayAutoOpen(a, s);
    const score = a.confidence?.score;
    if (allow.ok) {
      try {
        const next = await goals.openPr(goal.id);
        goals.update(goal.id, { autopilot: { ...a, status: 'pr_opened' } });
        this.deps.audit({ kind: AuditKind.PullRequest, actor: { type: ActorType.System, name: 'autopilot' }, goalId: goal.id, summary: `Autopilot opened ${next.pr?.url ?? 'a PR'} for ${a.shortId} (confidence ${score})`, decision: 'allowed', detail: { why: allow.why } });
        this.deps.notify({ kind: NotificationKind.GoalDone, title: `Autopilot opened a PR for ${a.shortId}`, body: `Confidence ${score}/100. ${next.pr?.url ?? ''}`.trim(), goalId: goal.id });
        return;
      } catch (err) {
        this.deps.notify({ kind: NotificationKind.Blocked, title: `Autopilot couldn't open the PR for ${a.shortId}`, body: (err as Error).message, goalId: goal.id });
      }
    }
    goals.update(goal.id, { autopilot: { ...a, status: a.status === 'verified' ? 'ready' : a.status } });
    this.deps.notify({
      kind: NotificationKind.Info,
      title: `Autopilot fix ready: ${a.shortId}`,
      body: `Confidence ${score ?? '—'}/100. Review the changes and open the PR. ${allow.why}`,
      goalId: goal.id,
    });
  }

  /** "Autopilot" section of the PR body. */
  prSection(goal: Goal): string | null {
    const a = goal.autopilot;
    if (!a) return null;
    const v = a.verification;
    const lines = [`### Autopilot`, `Started from Sentry ${a.permalink ? `[${a.shortId}](${a.permalink})` : a.shortId}.`];
    if (a.how) lines.push(`**Reproduced:** ${a.how.split('\n')[0].slice(0, 300)}`);
    if (a.test) lines.push(`**Failing test:** \`${a.test.file}\` (\`${a.test.command}\`)`);
    if (v) lines.push(`**Verified by AgentRoom:** starting commit ${v.failsOnBase === true ? '❌ fails' : v.failsOnBase === false ? '⚠️ passes' : '— not run'}, fix ${v.passesOnHead === true ? '✅ passes' : v.passesOnHead === false ? '❌ fails' : '— not run'}`);
    if (a.confidence) {
      lines.push(`**Confidence:** ${a.confidence.score}/100`);
      lines.push('| Evidence | Points |\n|---|---|\n' + a.confidence.factors.map((f) => `| ${f.label}${f.detail ? ` (${f.detail.replace(/\|/g, '\\|')})` : ''} | ${f.points}/${f.max} |`).join('\n'));
    }
    return lines.join('\n\n');
  }
}
