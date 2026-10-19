import { describe, expect, it } from 'vitest';
import { buildInsights, failureBucket, median } from '../src/server/services/insights.js';
import { buildTimeline, HUMAN_LANE } from '../src/server/services/timeline.js';
import type { AuditEntry, Goal, LedgerEntry, Notification, StampedEvent } from '../src/shared/types/index.js';

const T0 = Date.parse('2026-10-19T09:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const row = (p: Partial<LedgerEntry> & { botId: string; start: number; end: number }): LedgerEntry => ({
  id: Math.random().toString(36),
  ts: iso(p.end),
  startedAt: iso(p.start),
  botId: p.botId,
  goalId: p.goalId ?? 'G-1',
  ...(p.taskId ? { taskId: p.taskId } : {}),
  ...(p.phase ? { phase: p.phase } : {}),
  model: 'haiku',
  ok: p.ok ?? true,
  ...(p.aborted ? { aborted: true } : {}),
  costUsd: p.costUsd ?? 0.1,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  durationMs: p.end - p.start,
  turns: 1,
  skills: p.skills ?? [],
  tools: {},
  ...(p.error ? { error: p.error } : {}),
});

const goal = (p: Partial<Goal> & { id: string }): Goal =>
  ({ title: p.id, brief: '', status: 'done', plan: '', summary: '', sources: [], securityReview: 'auto', attachments: [], round: 0, createdAt: iso(T0), updatedAt: iso(T0 + 60 * MIN), ...p }) as Goal;

let seq = 0;
const ev = <E extends Record<string, unknown>>(ts: number, e: E) => ({ ...e, ts, seq: ++seq, goalId: 'G-1' }) as unknown as StampedEvent;

describe('buildTimeline', () => {
  const ledger = [
    row({ botId: 'planner', phase: 'planning', start: T0, end: T0 + 5 * MIN, costUsd: 0.2 }),
    row({ botId: 'developer', phase: 'build', taskId: 'T-1', start: T0 + 10 * MIN, end: T0 + 30 * MIN, costUsd: 0.5 }),
    row({ botId: 'qa', phase: 'testing', taskId: 'T-2', start: T0 + 31 * MIN, end: T0 + 40 * MIN, ok: false, error: '3 tests failing', costUsd: 0.3 }),
  ];
  const events = [
    ev(T0 + 12 * MIN, { type: 'permission_request', botId: 'developer', requestId: 'r1', tool: 'Bash', summary: 'git commit -m x', input: {}, reason: '' }),
    ev(T0 + 14 * MIN, { type: 'permission_resolved', botId: 'developer', requestId: 'r1', allowed: true }),
    ev(T0 + 9 * MIN, { type: 'delegation', from: 'lead', to: 'developer', instruction: 'Build T-1\nmore' }),
    ev(T0 + 11 * MIN, { type: 'tool_call', botId: 'developer', toolUseId: 't', name: 'Edit', summary: 'src/a.ts', input: {} }),
  ];
  const notifications: Notification[] = [{ id: 'n', ts: T0 + 5 * MIN, kind: 'plan_ready', title: 'Plan ready', body: '', goalId: 'G-1', read: true }];
  const audit: AuditEntry[] = [
    { id: 'a', ts: iso(T0 + 14 * MIN), kind: 'command', actor: { type: 'human', name: 'k' }, goalId: 'G-1', summary: 'git commit -m "T-1"', decision: 'allowed' },
    { id: 'b', ts: iso(T0 + 45 * MIN), kind: 'pull_request', actor: { type: 'human', name: 'k' }, goalId: 'G-1', summary: 'gh pr create', decision: 'allowed' },
  ];
  const t = buildTimeline({ goal: goal({ id: 'G-1', approvedAt: iso(T0 + 8 * MIN) }), ledger, events, notifications, audit });

  it('draws one lane per bot in order of first activity, the human last', () => {
    expect(t.lanes.map((l) => l.botId)).toEqual(['planner', 'developer', 'qa', HUMAN_LANE]);
    expect(t.lanes[0]!.segments[0]).toMatchObject({ kind: 'planning', costUsd: 0.2 });
    expect(t.lanes[1]!.segments[0]).toMatchObject({ kind: 'working', label: 'T-1 · Building' });
    expect(t.lanes[2]!.segments[0]).toMatchObject({ kind: 'error', label: 'T-2 · Failed: 3 tests failing' });
  });

  it('shows waits on the human: the permission and the plan review', () => {
    const human = t.lanes.find((l) => l.botId === HUMAN_LANE)!.segments;
    expect(human.map((s) => [s.start - T0, s.end - T0, s.kind])).toEqual([
      [5 * MIN, 8 * MIN, 'waiting'],
      [12 * MIN, 14 * MIN, 'waiting'],
    ]);
  });

  it('marks approvals, delegation, commits, the PR and the failure, and sums cost', () => {
    expect(t.markers.map((m) => m.kind)).toEqual(['approval', 'delegation', 'approval', 'checkpoint', 'failure', 'pr']);
    expect(t.totalCostUsd).toBe(1);
    expect(t.start).toBe(T0);
    expect(t.end).toBe(T0 + 45 * MIN);
    expect(t.events.map((e) => e.kind)).toEqual(['delegation', 'tool', 'approval_asked', 'approval']);
  });
});

describe('buildInsights', () => {
  const now = Date.parse('2026-10-19T15:00:00');
  const day = 86_400_000;
  const goals = [
    goal({ id: 'G-1', status: 'done', updatedAt: iso(now - day) }),
    goal({ id: 'G-2', status: 'done', updatedAt: iso(now - 2 * day) }),
    goal({ id: 'G-3', status: 'failed', updatedAt: iso(now - day), reason: 'Budget reached at $5.00' }),
    goal({ id: 'G-4', status: 'done', updatedAt: iso(now - 40 * day) }),
  ];
  const ledger = [
    row({ botId: 'developer', goalId: 'G-1', start: now - day - 10 * MIN, end: now - day, costUsd: 1, skills: ['testing'] }),
    row({ botId: 'developer', goalId: 'G-2', start: now - 2 * day - 10 * MIN, end: now - 2 * day, costUsd: 2, ok: false, error: 'Command failed: exit code 1' }),
    row({ botId: 'qa', goalId: 'G-1', start: now - day - 5 * MIN, end: now - day, costUsd: 0.5, ok: false, error: '2 tests failing', skills: ['testing'] }),
    row({ botId: 'qa', goalId: 'G-2', start: now - day, end: now - day + MIN, costUsd: 0.25, aborted: true, ok: false }),
    row({ botId: 'developer', goalId: 'G-4', start: now - 40 * day - MIN, end: now - 40 * day, costUsd: 9 }),
  ];
  const notifications: Notification[] = [{ id: 'q', ts: now - 2 * day, kind: 'question', title: '?', body: '', goalId: 'G-2', read: true }];
  const events = [
    ev(now - day, { type: 'permission_request', botId: 'developer', requestId: 'a', tool: 'Bash', summary: '', input: {}, reason: '' }),
    ev(now - day + 2 * MIN, { type: 'permission_resolved', botId: 'developer', requestId: 'a', allowed: true }),
    ev(now - day, { type: 'permission_request', botId: 'developer', requestId: 'b', tool: 'Bash', summary: '', input: {}, reason: '' }),
    ev(now - day + 6 * MIN, { type: 'permission_resolved', botId: 'developer', requestId: 'b', allowed: true }),
  ];
  const ins = buildInsights({ period: '7d', now, ledger, goals, notifications, events, audit: [], dailyCapUsd: 10 });

  it('counts goals and spend inside the period only', () => {
    expect(ins.goalsFinished).toBe(2);
    expect(ins.goalsFailed).toBe(1);
    expect(ins.finishedWithoutHelpPct).toBe(50);
    expect(ins.spendUsd).toBe(3.75);
    expect(ins.spendPerGoal).toBe(1.875);
    expect(ins.dailySpend).toHaveLength(7);
    expect(ins.dailySpend.reduce((t, d) => t + d.usd, 0)).toBeCloseTo(3.75);
    expect(ins.dailyCapUsd).toBe(10);
  });

  it('computes success per bot without counting stopped runs', () => {
    const qa = ins.perBot.find((b) => b.botId === 'qa')!;
    expect(qa).toMatchObject({ runs: 2, successRate: 0 });
    expect(ins.perBot.find((b) => b.botId === 'developer')!.successRate).toBe(0.5);
  });

  it('groups failures into readable reasons and takes the median wait', () => {
    expect(Object.fromEntries(ins.failureReasons.map((r) => [r.reason, r.count]))).toEqual({
      'Tool or command error': 1,
      'Tests failing': 1,
      'Budget reached': 1,
    });
    expect(ins.approvalWaitMedianMs).toBe(4 * MIN);
    expect(ins.skills[0]).toEqual({ skill: 'testing', runs: 2, successRate: 0.5 });
  });

  it('helpers', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(failureBucket('Permission denied by the human')).toBe('Approval denied or timed out');
    expect(failureBucket(undefined)).toBe('Other');
  });
});
