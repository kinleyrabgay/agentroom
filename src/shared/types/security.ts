import type { FindingCategory, FindingSeverity, FindingSource, FindingStatus, RiskLevel } from '../enums.js';
import type { AuditActor } from './ledger.js';

/** One security issue. Stored in `.agentroom/runs/security.json`; pushed to the UI as StateType.Findings. */
export interface SecurityFinding {
  id: string;
  ts: string;
  severity: FindingSeverity;
  category: FindingCategory;
  source: FindingSource;
  /** Stable rule id, e.g. "secret.github-token", "dep.osv", "injection.ignore-instructions". */
  rule: string;
  title: string;
  /** Markdown explanation + suggested fix. */
  detail: string;
  file?: string;
  line?: number;
  /** Matched code with secrets redacted (never the full secret). */
  snippet?: string;
  goalId?: string;
  /** Workspaces: the repo the finding is in (unset = the primary repo). */
  repo?: string;
  taskId?: string;
  botId?: string;
  status: FindingStatus;
  resolvedBy?: AuditActor;
  resolvedAt?: string;
  /** Why it was approved/dismissed. */
  note?: string;
}

export interface RiskFactor {
  label: string;
  points: number;
}

/** 0–100; low < 35 ≤ medium < 70 ≤ high. Medium turns on the security step; high adds approval gates. */
export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  /** Diff size the score was computed on. */
  files: number;
  additions: number;
  deletions: number;
  computedAt: string;
}

export interface FindingQuery {
  goalId?: string;
  /** Workspaces: only this repo's findings ('' = the primary repo). */
  repo?: string;
  status?: FindingStatus;
  severity?: FindingSeverity;
}
