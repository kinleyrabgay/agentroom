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
}

export interface ScanResult {
  findings: SecurityFinding[];
  stats: DiffStats;
  depsChanged: boolean;
}

export interface GoalAssessment extends ScanResult {
  risk: RiskAssessment;
  /** Diff paths matching the sensitive-path globs. */
  sensitive: string[];
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

  /** Scan the working tree against `base` (a goal's base commit, or HEAD). */
  async scan(scope: FindingScope, base?: string, opts: { dependencies?: boolean } = {}): Promise<ScanResult> {
    const files = ownFiles(parseUnifiedDiff(await this.deps.git.workingDiff(base ?? 'HEAD')));
    const depsChanged = this.deps.guard.touchesManifests(files);
    const runDeps = opts.dependencies !== false && depsChanged;
    const drafts = [...scanFiles(files), ...(runDeps ? await this.deps.guard.check(files) : [])];
    const sources = runDeps ? [FindingSource.Scanner, FindingSource.Dependency] : [FindingSource.Scanner];
    this.deps.findings.record(drafts, scope, { sources });
    return { findings: this.deps.findings.list({ goalId: scope.goalId }), stats: diffStats(files), depsChanged };
  }

  /** Scan a goal's diff and score its risk. */
  async assessGoal(goal: Goal, opts: { dependencies?: boolean } = {}): Promise<GoalAssessment> {
    const scan = await this.scan({ goalId: goal.id }, goal.baseRef, opts);
    const patterns = this.deps.settings().security.sensitivePaths;
    const risk = assessRisk({ stats: scan.stats, findings: scan.findings, depsChanged: scan.depsChanged, sensitivePatterns: patterns });
    return { ...scan, risk, sensitive: sensitiveTouched(scan.stats.paths, patterns) };
  }

  /**
   * Before a bot commits, pushes or opens a PR: scan what would be published. Returns a hold when
   * open findings reach the configured threshold (settings.security.blockOn), else null.
   */
  async gate(command: string, scope: FindingScope): Promise<GateHold | null> {
    const action = gitActionOf(command);
    if (!action) return null;
    const { git } = this.deps;
    let diff: string;
    if (action === GitAction.Commit) {
      diff = await git.stagedDiff();
      if (commitsAll(command)) diff = `${diff}\n${await git.workingDiff('HEAD')}`;
    } else {
      const base = scope.goalId ? this.deps.goalBase?.(scope.goalId) : undefined;
      diff = await git.rangeDiff(base ? `${base}..HEAD` : undefined);
    }
    const files = ownFiles(parseUnifiedDiff(diff));
    if (!files.length) return null;
    const drafts = [...scanFiles(files), ...(this.deps.guard.touchesManifests(files) ? await this.deps.guard.check(files) : [])];
    const found = this.deps.findings.record(drafts, scope);
    const threshold = this.deps.settings().security.blockOn;
    const holding = found.filter((f) => f.status === FindingStatus.Open && blocks(f.severity, threshold));
    if (!holding.length) return null;
    const critical = holding.filter((f) => f.severity === FindingSeverity.Critical).length;
    const warnings = holding.length - critical;
    const parts = [critical ? `${critical} critical` : '', warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''].filter(Boolean);
    const verb = action === GitAction.Commit ? 'commit' : action === GitAction.Push ? 'push' : 'pull request';
    return { reason: `Security: ${parts.join(', ')} in this ${verb}`, findings: holding };
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
