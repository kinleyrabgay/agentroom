import { AgentEventType, AuditKind, NotificationKind, WorkPhase } from '../../shared/enums.js';
import type {
  AuditEntry,
  Goal,
  GoalTimeline,
  LedgerEntry,
  Notification,
  StampedEvent,
  TimelineEvent,
  TimelineKind,
  TimelineLane,
  TimelineMarker,
} from '../../shared/types/index.js';

/** Lane id for time spent waiting on the human. */
export const HUMAN_LANE = 'human';
const MAX_EVENTS = 600;
const MAX_MARKERS = 300;

const PHASE_KIND: Record<string, TimelineKind> = {
  [WorkPhase.Planning]: 'planning',
  [WorkPhase.Build]: 'working',
  [WorkPhase.Security]: 'security',
  [WorkPhase.Testing]: 'testing',
  [WorkPhase.Reporting]: 'reporting',
  [WorkPhase.Chat]: 'working',
};

const PHASE_LABEL: Record<string, string> = {
  [WorkPhase.Planning]: 'Planning',
  [WorkPhase.Build]: 'Building',
  [WorkPhase.Security]: 'Security review',
  [WorkPhase.Testing]: 'Testing',
  [WorkPhase.Reporting]: 'Report',
  [WorkPhase.Chat]: 'Chat',
};

const isCommit = (s: string) => /(^|[;&|]\s*|\s)git\s+(\S+\s+)*commit(\s|$)/.test(s);

export interface TimelineInput {
  goal: Pick<Goal, 'id' | 'createdAt' | 'updatedAt' | 'approvedAt'>;
  ledger: LedgerEntry[];
  events: StampedEvent[];
  notifications: Notification[];
  audit: AuditEntry[];
}

/** One goal's history as lanes (one per bot, plus the human), markers and notable events. */
export function buildTimeline({ goal, ledger, events, notifications, audit }: TimelineInput): GoalTimeline {
  const lanes = new Map<string, TimelineLane>();
  const lane = (botId: string) => {
    let l = lanes.get(botId);
    if (!l) lanes.set(botId, (l = { botId, segments: [] }));
    return l;
  };
  const markers: TimelineMarker[] = [];
  const out: TimelineEvent[] = [];

  // Bot runs, from the ledger.
  for (const r of ledger) {
    const start = Date.parse(r.startedAt);
    const end = Date.parse(r.ts);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const failed = !r.ok && !r.aborted;
    const base = PHASE_LABEL[r.phase ?? ''] ?? 'Working';
    lane(r.botId).segments.push({
      start,
      end: Math.max(end, start + 1),
      kind: failed ? 'error' : (PHASE_KIND[r.phase ?? ''] ?? 'working'),
      label: [r.taskId, failed ? `Failed: ${r.error ?? base}` : r.aborted ? `${base} (stopped)` : base].filter(Boolean).join(' · '),
      costUsd: r.costUsd,
    });
    if (failed) markers.push({ ts: end, kind: 'failure', label: `${r.botId}: ${r.error ?? 'run failed'}` });
  }

  // Waiting on the human: permission requests until answered.
  const asked = new Map<string, Extract<StampedEvent, { type: typeof AgentEventType.PermissionRequest }>>();
  for (const e of events) {
    switch (e.type) {
      case AgentEventType.PermissionRequest:
        asked.set(e.requestId, e);
        out.push({ ts: e.ts, botId: e.botId, kind: 'approval_asked', text: `Asked to use ${e.tool}: ${e.summary}` });
        break;
      case AgentEventType.PermissionResolved: {
        const req = asked.get(e.requestId);
        if (req) {
          lane(HUMAN_LANE).segments.push({ start: req.ts, end: Math.max(e.ts, req.ts + 1), kind: 'waiting', label: `Approve ${req.tool}: ${req.summary}` });
          asked.delete(e.requestId);
        }
        const what = req ? `${req.tool} ${req.summary}`.trim() : 'a request';
        markers.push({ ts: e.ts, kind: 'approval', label: `${e.allowed ? 'Approved' : 'Denied'} ${what}` });
        out.push({ ts: e.ts, botId: e.botId, kind: 'approval', text: `${e.allowed ? 'Approved' : 'Denied'} ${what}` });
        break;
      }
      case AgentEventType.Delegation:
        markers.push({ ts: e.ts, kind: 'delegation', label: `${e.from} → ${e.to}` });
        out.push({ ts: e.ts, botId: e.from, kind: 'delegation', text: `Handed to ${e.to}: ${e.instruction.split('\n')[0].slice(0, 160)}` });
        break;
      case AgentEventType.ToolCall:
        out.push({ ts: e.ts, botId: e.botId, kind: 'tool', text: `${e.name} ${e.summary}`.trim().slice(0, 200) });
        break;
      case AgentEventType.RunDone:
        out.push({ ts: e.ts, botId: e.botId, kind: 'run_done', text: `${e.ok ? 'Finished' : 'Failed'} · $${e.costUsd.toFixed(2)}` });
        break;
      case AgentEventType.Error:
        out.push({ ts: e.ts, ...(e.botId ? { botId: e.botId } : {}), kind: 'error', text: e.message.slice(0, 200) });
        break;
    }
  }
  // Still waiting at the last event: draw it up to then.
  const lastTs = events.at(-1)?.ts;
  for (const req of asked.values()) {
    if (lastTs && lastTs > req.ts) lane(HUMAN_LANE).segments.push({ start: req.ts, end: lastTs, kind: 'waiting', label: `Waiting: ${req.tool} ${req.summary}` });
  }

  // Waiting on the human: plan review (plan ready → approved).
  const approvedAt = goal.approvedAt ? Date.parse(goal.approvedAt) : NaN;
  for (const n of notifications) {
    if (n.goalId !== goal.id || n.kind !== NotificationKind.PlanReady) continue;
    const end = Number.isFinite(approvedAt) && approvedAt > n.ts ? approvedAt : null;
    if (end) {
      lane(HUMAN_LANE).segments.push({ start: n.ts, end, kind: 'waiting', label: 'Review the plan' });
      markers.push({ ts: end, kind: 'approval', label: 'Plan approved' });
    }
  }

  // Commits (checkpoints) and pull requests, from the audit log.
  for (const a of audit) {
    const ts = Date.parse(a.ts);
    if (!Number.isFinite(ts) || a.decision === 'denied') continue;
    if (a.kind === AuditKind.PullRequest) markers.push({ ts, kind: 'pr', label: a.summary.slice(0, 160) });
    else if (a.kind === AuditKind.Command && isCommit(a.summary)) markers.push({ ts, kind: 'checkpoint', label: a.summary.slice(0, 160) });
  }

  const sortedLanes = [...lanes.values()]
    .map((l) => ({ ...l, segments: l.segments.sort((a, b) => a.start - b.start) }))
    // Bots in order of first activity; the human lane last.
    .sort((a, b) => (a.botId === HUMAN_LANE ? 1 : b.botId === HUMAN_LANE ? -1 : a.segments[0]!.start - b.segments[0]!.start));
  const times = [
    ...sortedLanes.flatMap((l) => l.segments.flatMap((s) => [s.start, s.end])),
    ...markers.map((m) => m.ts),
    ...out.map((e) => e.ts),
  ];
  const created = Date.parse(goal.createdAt);
  const start = times.length ? Math.min(...times) : created;
  const end = times.length ? Math.max(...times) : Date.parse(goal.updatedAt);

  return {
    goalId: goal.id,
    start,
    end: Math.max(end, start + 1),
    totalCostUsd: Math.round(ledger.reduce((t, r) => t + r.costUsd, 0) * 1e6) / 1e6,
    lanes: sortedLanes,
    markers: markers.sort((a, b) => a.ts - b.ts).slice(-MAX_MARKERS),
    events: out.sort((a, b) => a.ts - b.ts).slice(-MAX_EVENTS),
  };
}
