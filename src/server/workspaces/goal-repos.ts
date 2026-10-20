import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRegistry } from '../../core/workspaces/index.js';
import type { ChangeGroup, Goal, GoalChanges, GoalRepoState, Task } from '../../shared/types/index.js';
import * as gg from '../git/goal-git.js';
import { worktreeHome } from '../workflow/goal-runner.js';
import { linkedPrSection, withLinkedSection, type PrPart } from './goal-repos-links.js';

/** The git operations a goal needs in each repo (swapped for fakes in tests). */
export type RepoGit = Pick<
  typeof gg,
  'isRepo' | 'head' | 'goalBranch' | 'createWorktree' | 'commitAll' | 'commitsSince' | 'changedFiles' | 'filesOf' | 'logSince' | 'push' | 'createPr' | 'mergeInto' | 'removeWorktree' | 'currentBranch' | 'revertCommits' | 'run'
>;

export interface GoalReposDeps {
  registry: ProjectRegistry;
  /** Persist a goal's per-repo state. */
  update: (goalId: string, repos: Record<string, GoalRepoState>) => Goal;
  /** settings.worktrees.enabled */
  worktreesEnabled: () => boolean;
  git?: RepoGit;
}

export { LINKS_END, LINKS_START, linkedPrSection, withLinkedSection, type PrPart } from './goal-repos-links.js';

/**
 * The parts of a goal that live in the workspace's other repos: their own folder and branch per repo,
 * checkpoints, diffs, pull requests and cleanup. The primary repo stays with the goal runner's
 * own fields (`worktree`, `baseRef`, `pr`), so single-repo goals are unchanged.
 */
export class GoalRepos {
  private readonly git: RepoGit;

  constructor(private readonly deps: GoalReposDeps) {
    this.git = deps.git ?? gg;
  }

  get isWorkspace(): boolean {
    return this.deps.registry.isWorkspace;
  }

  get registry(): ProjectRegistry {
    return this.deps.registry;
  }

  /** The non-primary repo a task changes, or undefined for the primary repo (and unknown ids). */
  repoOf(task: Pick<Task, 'repo'> | undefined): string | undefined {
    const id = task?.repo;
    if (!id || !this.deps.registry.has(id)) return undefined;
    return id === this.deps.registry.primaryId ? undefined : id;
  }

  /** Non-primary repos a goal touches, in workspace order. */
  spans(goal: Goal, tasks: Task[]): string[] {
    const used = new Set<string>(Object.keys(goal.repos ?? {}));
    for (const t of tasks) {
      const r = this.repoOf(t);
      if (r) used.add(r);
    }
    return this.deps.registry.ids().filter((id) => used.has(id));
  }

  /** Every repo with a part of the goal (primary first when it has work), for linked PRs. */
  parts(goal: Goal, tasks: Task[]): string[] {
    const others = this.spans(goal, tasks);
    const primaryWork = tasks.some((t) => !this.repoOf(t)) || !!goal.pr;
    return [...(primaryWork || !others.length ? [this.deps.registry.primaryId] : []), ...others];
  }

  private state(goal: Goal, repo: string): GoalRepoState {
    return goal.repos?.[repo] ?? {};
  }

  private put(goal: Goal, repo: string, patch: Partial<GoalRepoState>, clear: (keyof GoalRepoState)[] = []): Goal {
    const next: GoalRepoState = { ...this.state(goal, repo), ...patch };
    for (const k of clear) delete next[k];
    return this.deps.update(goal.id, { ...(goal.repos ?? {}), [repo]: next });
  }

  /** Give the goal its own folder on its own branch in another repo (once), starting at that repo's HEAD. */
  async ensure(goal: Goal, repo: string): Promise<Goal> {
    const root = this.deps.registry.root(repo);
    let st = this.state(goal, repo);
    const isRepo = await this.git.isRepo(root);
    if (!st.baseRef && isRepo) {
      const base = await this.git.head(root);
      if (base) {
        goal = this.put(goal, repo, { baseRef: base });
        st = this.state(goal, repo);
      }
    }
    if (!isRepo || !this.deps.worktreesEnabled() || !st.baseRef) return goal;
    if (st.worktree && fs.existsSync(path.join(st.worktree.path, '.git'))) return goal;
    if (!st.worktree && st.worktreeWarning) return goal;
    const dir = st.worktree?.path ?? path.join(worktreeHome(root), goal.id);
    const branch = st.worktree?.branch ?? this.git.goalBranch(goal.id);
    try {
      await this.git.createWorktree(root, dir, branch, st.baseRef);
      return this.put(goal, repo, { worktree: { path: dir, branch } }, ['worktreeWarning']);
    } catch (err) {
      return this.put(goal, repo, { worktreeWarning: `Working in ${root}: couldn't create the goal's own folder (${(err as Error).message}).` });
    }
  }

  /** Folder the goal's bots work in for a repo. */
  cwd(goal: Goal, repo: string): string {
    const wt = this.state(goal, repo).worktree;
    return wt && fs.existsSync(wt.path) ? wt.path : this.deps.registry.root(repo);
  }

  /** Current commit in the goal's own folder of that repo (null without one). */
  async head(goal: Goal, repo: string): Promise<string | null> {
    const wt = this.state(goal, repo).worktree;
    return wt && fs.existsSync(wt.path) ? this.git.head(wt.path) : null;
  }

  /** Commit what a task changed in that repo's folder; returns the new commits (oldest first). */
  async checkpoint(goal: Goal, repo: string, task: Task, before: string | null): Promise<string[]> {
    const wt = this.state(goal, repo).worktree;
    if (!before || !wt) return [];
    await this.git.commitAll(wt.path, `${task.id}: ${task.title}`);
    return this.git.commitsSince(wt.path, before);
  }

  /** Files the goal changed in one repo, grouped by that repo's tasks. */
  async changes(goal: Goal, repo: string, tasks: Task[]): Promise<GoalChanges> {
    const st = this.state(goal, repo);
    const cwd = this.cwd(goal, repo);
    const branch = st.worktree?.branch ?? (await this.git.currentBranch(cwd));
    const empty = { goalId: goal.id, base: st.baseRef ?? null, branch, cwd, files: [], groups: [], additions: 0, deletions: 0, repo };
    if (!st.baseRef) return empty;
    const files = await this.git.changedFiles(cwd, st.baseRef);
    const groups: ChangeGroup[] = [];
    const claimed = new Set<string>();
    for (const t of tasks.filter((t) => this.repoOf(t) === repo && t.commits.length).sort((a, b) => a.order - b.order)) {
      const touched = new Set<string>();
      for (const c of t.commits) for (const f of await this.git.filesOf(cwd, c)) touched.add(f);
      t.commits.forEach((c) => claimed.add(c));
      groups.push({ taskId: t.id, title: t.title, commits: t.commits, files: [...touched].sort(), ...(t.reverted ? { reverted: true } : {}) });
    }
    if (st.worktree) {
      const other = (await this.git.logSince(cwd, st.baseRef)).filter((c) => !claimed.has(c.sha));
      if (other.length) {
        const touched = new Set<string>();
        for (const c of other) for (const f of await this.git.filesOf(cwd, c.sha)) touched.add(f);
        groups.push({ taskId: null, title: 'Other commits', commits: other.map((c) => c.sha), files: [...touched].sort() });
      }
    }
    const pending = files.filter((f) => f.uncommitted).map((f) => f.path);
    if (pending.length) groups.push({ taskId: null, title: 'Not committed yet', commits: [], files: pending });
    return { ...empty, files, groups, additions: files.reduce((n, f) => n + f.additions, 0), deletions: files.reduce((n, f) => n + f.deletions, 0) };
  }

  /** Undo a task's commits in its repo's branch. */
  revert(goal: Goal, repo: string, commits: string[]): Promise<string[]> {
    return this.git.revertCommits(this.cwd(goal, repo), commits);
  }

  /** The PR links of every part, for the linked block. */
  prParts(goal: Goal, tasks: Task[]): PrPart[] {
    const reg = this.deps.registry;
    return this.parts(goal, tasks).map((repo) => {
      const ref = reg.ref(repo);
      const url = ref.primary ? goal.pr?.url : this.state(goal, repo).pr?.url;
      return { repo, name: ref.name, ...(url ? { url } : {}) };
    });
  }

  /** Push the repo's goal branch and open its PR (the human clicked Open PR for this repo). */
  async openPr(goal: Goal, repo: string, input: { title: string; body: string; draft?: boolean }): Promise<Goal> {
    const st = this.state(goal, repo);
    if (!st.worktree) throw new Error(`${goal.id} worked directly in ${this.deps.registry.root(repo)}, so there's no branch to push there. Commit and open that PR yourself.`);
    const cwd = this.cwd(goal, repo);
    await this.git.commitAll(cwd, `${goal.id}: remaining changes`).catch(() => null);
    await this.git.push(cwd, st.worktree.branch);
    const pr = await this.git.createPr(cwd, { title: input.title, body: input.body, head: st.worktree.branch, draft: !!input.draft });
    return this.put(goal, repo, { pr });
  }

  /**
   * After a PR opened: refresh the linked block in the goal's other open PRs so every part links to
   * every other. Part of the same click; failures are returned, not thrown (the PR is already open).
   */
  async refreshLinks(goal: Goal, tasks: Task[], except: string): Promise<string[]> {
    const parts = this.prParts(goal, tasks);
    if (parts.length < 2) return [];
    const errors: string[] = [];
    for (const p of parts) {
      if (p.repo === except || !p.url) continue;
      const cwd = this.deps.registry.root(p.repo);
      const view = await this.git.run('gh', ['pr', 'view', p.url, '--json', 'body', '-q', '.body'], cwd);
      if (view.code !== 0) {
        errors.push(`${p.name}: ${view.stderr.trim() || 'gh pr view failed'}`);
        continue;
      }
      const body = withLinkedSection(view.stdout.replace(/\n$/, ''), linkedPrSection(goal.id, parts, p.repo));
      const edit = await this.git.run('gh', ['pr', 'edit', p.url, '--body', body], cwd);
      if (edit.code !== 0) errors.push(`${p.name}: ${edit.stderr.trim() || 'gh pr edit failed'}`);
    }
    return errors;
  }

  /** Merge the repo's goal branch into the branch checked out there (no PR). */
  async mergeLocal(goal: Goal, repo: string): Promise<void> {
    const st = this.state(goal, repo);
    if (!st.worktree) throw new Error(`${goal.id} already worked in ${this.deps.registry.root(repo)}; there's nothing to merge.`);
    if (fs.existsSync(st.worktree.path)) await this.git.commitAll(st.worktree.path, `${goal.id}: remaining changes`).catch(() => null);
    await this.git.mergeInto(this.deps.registry.root(repo), st.worktree.branch, `Merge ${goal.id}: ${goal.title}`);
  }

  /** Remove the goal's folders in the other repos (branches stay). */
  async cleanup(goal: Goal): Promise<Goal> {
    let next = goal;
    for (const [repo, st] of Object.entries(goal.repos ?? {})) {
      if (!st.worktree || !this.deps.registry.has(repo)) continue;
      await this.git.removeWorktree(this.deps.registry.root(repo), st.worktree.path);
      next = this.put(next, repo, { worktreeWarning: `Folder removed; branch ${st.worktree.branch} is kept.` });
    }
    return next;
  }

  /**
   * Other folders a bot may read during a run. Planning and chats read the other repos' working
   * copies; goal work (build, test, report) only gets the goal's own folders, never the human's
   * working copies of other repos.
   */
  extraDirs(goal: Goal | null, current: string | undefined, mode: 'plan' | 'work'): string[] {
    if (!this.isWorkspace) return [];
    const out: string[] = [];
    for (const r of this.deps.registry.list()) {
      if ((current ?? this.deps.registry.primaryId) === r.id) continue;
      if (mode === 'plan' || !goal) {
        out.push(r.root);
        continue;
      }
      const wt = r.primary ? goal.worktree : this.state(goal, r.id).worktree;
      if (wt && fs.existsSync(wt.path)) out.push(wt.path);
    }
    return out;
  }
}
