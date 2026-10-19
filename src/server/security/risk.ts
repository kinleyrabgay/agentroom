import { FindingSeverity, FindingStatus, RiskLevel } from '../../shared/enums.js';
import type { RiskAssessment, RiskFactor, SecurityFinding } from '../../shared/types/index.js';
import type { DiffStats } from './diff.js';
import { matchesAny } from './glob.js';

export interface RiskInput {
  stats: DiffStats;
  findings: Pick<SecurityFinding, 'severity' | 'status'>[];
  depsChanged: boolean;
  sensitivePatterns: string[];
}

export const RISK_MEDIUM = 35;
/** Label prefix of the sensitive-paths factor (the workflow forces a security review when present). */
export const SENSITIVE_FACTOR = 'Sensitive paths';
export const RISK_HIGH = 70;
const MIGRATION = /(^|\/)(migrations?|db\/migrate)\/|\.sql$/i;

export function riskLevel(score: number): RiskLevel {
  return score >= RISK_HIGH ? RiskLevel.High : score >= RISK_MEDIUM ? RiskLevel.Medium : RiskLevel.Low;
}

/** Paths in the diff that match the team's sensitive-path globs. */
export function sensitiveTouched(paths: string[], patterns: string[]): string[] {
  return patterns.length ? paths.filter((p) => matchesAny(p, patterns)) : [];
}

/**
 * Score a diff 0–100. Factors (points):
 * size up to 25 (1 per 40 changed lines), files up to 15, sensitive paths 25, migrations/SQL 15,
 * dependency changes 10, critical findings 30 each (max 60), warnings 8 each (max 24).
 * Dismissed and fixed findings don't count.
 */
export function assessRisk(input: RiskInput): RiskAssessment {
  const { stats } = input;
  const factors: RiskFactor[] = [];
  const add = (label: string, points: number) => {
    if (points > 0) factors.push({ label, points: Math.round(points) });
  };

  const lines = stats.additions + stats.deletions;
  add(`${lines} changed ${lines === 1 ? 'line' : 'lines'}`, Math.min(25, lines / 40));
  add(`${stats.files} ${stats.files === 1 ? 'file' : 'files'} touched`, Math.min(15, stats.files * 1.5));
  const sensitive = sensitiveTouched(stats.paths, input.sensitivePatterns);
  if (sensitive.length) add(`${SENSITIVE_FACTOR}: ${sensitive.slice(0, 3).join(', ')}${sensitive.length > 3 ? '…' : ''}`, 25);
  if (stats.paths.some((p) => MIGRATION.test(p))) add('Database migrations / SQL', 15);
  if (input.depsChanged) add('Dependencies changed', 10);

  const live = input.findings.filter((f) => f.status === FindingStatus.Open || f.status === FindingStatus.Approved);
  const critical = live.filter((f) => f.severity === FindingSeverity.Critical).length;
  const warnings = live.filter((f) => f.severity === FindingSeverity.Warning).length;
  if (critical) add(`${critical} critical ${critical === 1 ? 'finding' : 'findings'}`, Math.min(60, critical * 30));
  if (warnings) add(`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, Math.min(24, warnings * 8));

  const score = Math.min(100, factors.reduce((n, f) => n + f.points, 0));
  return {
    score,
    level: riskLevel(score),
    factors,
    files: stats.files,
    additions: stats.additions,
    deletions: stats.deletions,
    computedAt: new Date().toISOString(),
  };
}
