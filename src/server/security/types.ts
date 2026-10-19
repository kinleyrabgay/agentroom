import type { SecurityFinding } from '../../shared/types/index.js';

/** A finding as produced by a detector, before the store assigns id/status/scope. */
export type FindingDraft = Pick<SecurityFinding, 'severity' | 'category' | 'source' | 'rule' | 'title' | 'detail'> &
  Partial<Pick<SecurityFinding, 'file' | 'line' | 'snippet'>>;

/** Where findings belong: a goal (and maybe a task/bot), or the working tree (no goal). */
export interface FindingScope {
  goalId?: string;
  taskId?: string;
  botId?: string;
}
