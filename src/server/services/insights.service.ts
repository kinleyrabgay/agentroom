import type { Project } from '../../core/project.js';
import { readJson } from '../../core/fs/json.js';
import { AuditKind } from '../../shared/enums.js';
import type { GoalTimeline, Insights, InsightsPeriod, Notification } from '../../shared/types/index.js';
import type { AuditService } from './audit.service.js';
import { readEvents } from './event-log.js';
import { buildInsights, PERIOD_DAYS } from './insights.js';
import type { LedgerService } from './ledger.service.js';
import { buildTimeline } from './timeline.js';

/** Most audit rows one query looks at. */
const AUDIT_LIMIT = 500;

/** Replay (one goal's timeline) and Insights (the team over a period), read from what AgentRoom already records. */
export class InsightsService {
  constructor(
    private readonly project: Project,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  timeline(goalId: string): GoalTimeline {
    const goal = this.project.goals.get(goalId);
    if (!goal) throw new Error(`No goal ${goalId}`);
    return buildTimeline({
      goal,
      ledger: this.ledger.list({ goalId }),
      events: readEvents(this.project.paths.runs, { goalId }),
      notifications: this.notifications(),
      audit: this.audit.query({ goalId, limit: AUDIT_LIMIT }).entries,
    });
  }

  insights(period: InsightsPeriod): Insights {
    const sinceMs = Date.now() - PERIOD_DAYS[period] * 86_400_000;
    return buildInsights({
      period,
      ledger: this.ledger.list(),
      goals: this.project.goals.list(),
      notifications: this.notifications(),
      events: readEvents(this.project.paths.runs, { sinceMs }).filter((e) => e.type === 'permission_request' || e.type === 'permission_resolved'),
      audit: this.audit.query({ kind: AuditKind.PullRequest, limit: AUDIT_LIMIT }).entries,
      dailyCapUsd: this.dailyCap(),
    });
  }

  private notifications(): Notification[] {
    return readJson<Notification[]>(this.project.paths.inboxFile, []);
  }

  /** Per-day budget from settings, when one is set (Settings → Budgets). */
  private dailyCap(): number | undefined {
    const b = (this.project.settings.get() as { budgets?: Record<string, unknown> }).budgets;
    const v = b?.perDayUsd ?? b?.dailyUsd ?? b?.day;
    return typeof v === 'number' && v > 0 ? v : undefined;
  }
}
