import { PROJECT_DIR } from '../../shared/constants.js';
import { FindingSeverity, FindingSource, FindingStatus, NotificationKind } from '../../shared/enums.js';
import type { AuditActor, Goal, RiskAssessment, SecurityFinding, Settings } from '../../shared/types/index.js';
import type { NotificationService } from '../services/notification.service.js';
import { diffStats, parseUnifiedDiff, type DiffStats, type FileDiff } from './diff.js';
import type { DependencyGuard } from './dependency/dependency-guard.js';
import { blocks, type FindingsStore } from './findings.store.js';
import { commitsAll, GitAction, gitActionOf } from './git-action.js';
import type { GitReader } from './git.js';
import { detectInjection, injectionFinding, injectionWarning, wrapUntrusted } from './injection.js';
import { assessRisk, sensitiveTouched } from './risk.js';
import { scanFiles } from './scanner/scanner.js';
import type { FindingScope } from './types.js';

export interface SecurityServiceDeps {
  git: GitReader;
  guard: DependencyGuard;
  findings: FindingsStore;
  settings: () => Settings;
  notifications?: NotificationService;
  /** Base commit of a goal (for push/PR diffs of goal work). */
  goalBase?: (goalId: string) => string | undefined;
  /** A goal's own folder (worktree), when it has one: its diffs and gates are read there. */
  goalCwd?: (goalId: string) => string | undefined;
  /** Git access for another folder (a goal's worktree). */
  gitFor?: (cwd: string) => GitReader;
  /**
   * Workspaces: the goal's parts in repos other than the primary one (the folder its bots work in
   * there and that repo's starting commit). Scans, risk and gates cover every one of them.
   */
  goalRepos?: (goalId: string) => GoalRepoTarget[];
}

/** A goal's part in another repo of a workspace. */
export interface GoalRepoTarget {
  repo: string;
  cwd: string;
  base?: string;
}

/** Per-repo diff summary inside a goal assessment (workspaces). */
export interface RepoScan {
  repo: string;
  stats: DiffStats;
  sensitive: string[];
}

export interface ScanResult {
  findings: SecurityFinding[];
  stats: DiffStats;
  depsChanged: boolean;
}

export interface GoalAssessment extends ScanResult {
  risk: RiskAssessment;
  /** Diff paths matching the sensitive-path globs (other repos' paths as `<repo>/<path>`). */
  sensitive: string[];
  /** Workspaces: the goal's other repos, scanned too. Their paths in `stats` are prefixed `<repo>/`. */
  repos: RepoScan[];
}

/** AgentRoom's own files (board, bots, runs) aren't part of the change being reviewed. */
const ownFiles = (files: FileDiff[]) => files.filter((f) => !f.path.startsWith(`${PROJECT_DIR}/`));

/** A commit/push/PR that must wait for the human because of open findings. */
export interface GateHold {
  reason: string;
  findings: SecurityFinding[];
}

/** Context for untrusted-content checks: who read it, and a per-run key so we notify once per source per run. */
export interface UntrustedContext extends FindingScope {
  runKey?: object;
}

/**
 * The security layer: scans diffs (secrets & risky code, dependencies), keeps findings,
 * gates commits/pushes/PRs, scores goal risk, and guards bots against prompt injection.
 */
export class SecurityService {
  private notified = new WeakMap<object, Set<string>>();

  constructor(private readonly deps: SecurityServiceDeps) {}

  get findings(): FindingsStore {
    return this.deps.findings;
  }

  head(): Promise<string | null> {
    return this.deps.git.head();
  }

  /** Git for a goal's own folder, else the project's. */
  private gitOf(goalId?: string): GitReader {
    const cwd = goalId ? this.deps.goalCwd?.(goalId) : undefined;
    return cwd && this.deps.gitFor ? this.deps.gitFor(cwd) : this.deps.git;
  }

  /** Git for a goal's part in another repo. */
  private gitIn(cwd: string): GitReader {
    if (!this.deps.gitFor) throw new Error('No git access for other repos.');
    return this.deps.gitFor(cwd);
  }

  /** The goal's parts in other repos (workspaces), or none. */
  private others(goalId?: string): GoalRepoTarget[] {
    if (!goalId || !this.deps.goalRepos || !this.deps.gitFor) return [];
    try {
      return this.deps.goalRepos(goalId);
    } catch {
      return [];
    }
  }

  /** Scan the working tree against `base` (a goal's base commit, or HEAD). With `target`, scan that other repo's part instead. */
  async scan(scope: FindingScope, base?: string, opts: { dependencies?: boolean; target?: GoalRepoTarget } = {}): Promise<ScanResult> {
    const git = opts.target ? this.gitIn(opts.target.cwd) : this.gitOf(scope.goalId);
    const files = ownFiles(parseUnifiedDiff(await git.workingDiff(base ?? 'HEAD')));
    const depsChanged = this.deps.guard.touchesManifests(files);
    const runDeps = opts.dependencies !== false && depsChanged;
    const drafts = [...scanFiles(files), ...(runDeps ? await this.deps.guard.check(files) : [])];
    const sources = runDeps ? [FindingSource.Scanner, FindingSource.Dependency] : [FindingSource.Scanner];
    this.deps.findings.record(drafts, scope, { sources });
    return { findings: this.deps.findings.list({ goalId: scope.goalId }), stats: diffStats(files), depsChanged };
  }

  /**
   * Scan a goal's diff and score its risk. In a workspace every repo the goal touched is scanned
   * (findings tagged with the repo) and scored together: one risky repo makes the whole goal risky.
   */
  async assessGoal(goal: Goal, opts: { dependencies?: boolean } = {}): Promise<GoalAssessment> {
    const scan = await this.scan({ goalId: goal.id }, goal.baseRef, opts);
    const patterns = this.deps.settings().security.sensitivePaths;
    const sensitive = sensitiveTouched(scan.stats.paths, patterns);
    const repos: RepoScan[] = [];
    let stats = scan.stats;
    let depsChanged = scan.depsChanged;
    for (const t of this.others(goal.id)) {
      if (!t.base) continue;
      const r = await this.scan({ goalId: goal.id, repo: t.repo }, t.base, { ...opts, target: t });
      const own = sensitiveTouched(r.stats.paths, patterns);
      repos.push({ repo: t.repo, stats: r.stats, sensitive: own });
      sensitive.push(...own.map((p) => `${t.repo}/${p}`));
      depsChanged ||= r.depsChanged;
      stats = {
        files: stats.files + r.stats.files,
        additions: stats.additions + r.stats.additions,
        deletions: stats.deletions + r.stats.deletions,
        paths: [...stats.paths, ...r.stats.paths.map((p) => `${t.repo}/${p}`)],
      };
    }
    const findings = this.deps.findings.list({ goalId: goal.id });
    const risk = assessRisk({ stats, findings, depsChanged, sensitivePatterns: patterns, sensitive });
    return { findings, stats, depsChanged, risk, sensitive, repos };
  }

  /**
   * Before a bot commits, pushes or opens a PR: scan what would be published. Returns a hold when
   * open findings reach the configured threshold (settings.security.blockOn), else null.
   */
  async gate(command: string, scope: FindingScope): Promise<GateHold | null> {
    const action = gitActionOf(command);
    if (!action) return null;
    // In a workspace the command may run in any of the goal's repos (the bot can `cd`), so every part is checked.
    const parts: { git: GitReader; base?: string; scope: FindingScope }[] = [
      { git: this.gitOf(scope.goalId), ...(scope.goalId && this.deps.goalBase?.(scope.goalId) ? { base: this.deps.goalBase(scope.goalId) } : {}), scope },
      ...this.others(scope.goalId).map((t) => ({ git: this.gitIn(t.cwd), ...(t.base ? { base: t.base } : {}), scope: { ...scope, repo: t.repo } })),
    ];
    const found: SecurityFinding[] = [];
    for (const part of parts) {
      let diff: string;
      if (action === GitAction.Commit) {
        diff = await part.git.stagedDiff();
        if (commitsAll(command)) diff = `${diff}\n${await part.git.workingDiff('HEAD')}`;
      } else {
        diff = await part.git.rangeDiff(part.base ? `${part.base}..HEAD` : undefined);
      }
      const files = ownFiles(parseUnifiedDiff(diff));
      if (!files.length) continue;
      const drafts = [...scanFiles(files), ...(this.deps.guard.touchesManifests(files) ? await this.deps.guard.check(files) : [])];
      found.push(...this.deps.findings.record(drafts, part.scope));
    }
    const threshold = this.deps.settings().security.blockOn;
    const holding = found.filter((f) => f.status === FindingStatus.Open && blocks(f.severity, threshold));
    if (!holding.length) return null;
    const critical = holding.filter((f) => f.severity === FindingSeverity.Critical).length;
    const warnings = holding.length - critical;
    const counts = [critical ? `${critical} critical` : '', warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''].filter(Boolean);
    const verb = action === GitAction.Commit ? 'commit' : action === GitAction.Push ? 'push' : 'pull request';
    const where = [...new Set(holding.map((f) => f.repo).filter(Boolean))];
    return { reason: `Security: ${counts.join(', ')} in this ${verb}${where.length ? ` (repo ${where.join(', ')})` : ''}`, findings: holding };
  }

  /** The human let a held commit/push/PR through: those findings are accepted risks. */
  approveHeld(ids: string[], actor: AuditActor) {
    for (const id of ids) {
      const f = this.deps.findings.get(id);
      if (f?.status === FindingStatus.Open) this.deps.findings.resolve(id, FindingStatus.Approved, actor, 'Approved at the commit/push/PR gate');
    }
  }

  /** Message the bot gets when the human denies a held action. */
  static deniedMessage(findings: SecurityFinding[]): string {
    const lines = findings.map((f) => `- [${f.severity}] ${f.title}${f.file ? ` in ${f.file}${f.line ? `:${f.line}` : ''}` : ''}`);
    return `The human blocked this because of security findings. Fix them (remove secrets from the change and history, address the risky code), then try again:\n${lines.join('\n')}`;
  }

  /** Wrap untrusted text for a bot, flagging instruction-like content. */
  guardUntrusted(text: string, source: string, ctx: UntrustedContext): string {
    const warning = this.inspect(text, source, ctx);
    const wrapped = wrapUntrusted(text, source);
    return warning ? `${wrapped}\n\n${warning}` : wrapped;
  }

  /** Detection only (for outputs we can't rewrite, e.g. built-in WebFetch): returns a warning or null. */
  inspect(text: string, source: string, ctx: UntrustedContext): string | null {
    const matches = detectInjection(text);
    if (!matches.length) return null;
    const { runKey, ...scope } = ctx;
    this.deps.findings.record([injectionFinding(matches, source)], scope);
    this.notifyOnce(runKey, source, () =>
      this.deps.notifications?.create({
        kind: NotificationKind.Security,
        title: `Possible prompt injection in ${source}`,
        body: `${matches.map((m) => m.label).join('; ')}. The bot was told to treat it as data.`,
        ...(scope.botId ? { botId: scope.botId } : {}),
        ...(scope.goalId ? { goalId: scope.goalId } : {}),
      }),
    );
    return injectionWarning(matches);
  }

  private notifyOnce(runKey: object | undefined, source: string, fn: () => void) {
    if (!runKey) return fn();
    let seen = this.notified.get(runKey);
    if (!seen) this.notified.set(runKey, (seen = new Set()));
    if (seen.has(source)) return;
    seen.add(source);
    fn();
  }
}
