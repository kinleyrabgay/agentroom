import { describe, expect, it } from 'vitest';
import { AgentEventType, type StampedEvent } from '../../src/shared/index.js';
import { buildTranscript } from '../../web/features/chat/lib/transcript.js';
import { describeSteps } from '../../web/features/chat/lib/tool-kinds.js';

let seq = 0;
const ev = (e: Record<string, unknown>, ts = 1000): StampedEvent => ({ ...e, botId: 'dev', ts, seq: ++seq }) as unknown as StampedEvent;

const turn = () => [
  ev({ type: AgentEventType.UserMessage, text: 'fix it', from: 'human' }, 1000),
  ev({ type: AgentEventType.Message, text: 'Looking.' }),
  ev({ type: AgentEventType.ToolCall, toolUseId: 't1', name: 'Read', summary: 'a.ts', input: { file_path: 'a.ts' } }),
  ev({ type: AgentEventType.ToolResult, toolUseId: 't1', ok: true, output: 'code' }),
  ev({ type: AgentEventType.ToolCall, toolUseId: 't2', name: 'Bash', summary: 'npm test', input: { command: 'npm test' } }),
  ev({ type: AgentEventType.ToolResult, toolUseId: 't2', ok: true, output: 'ok' }),
  ev({ type: AgentEventType.Message, text: 'Fixed.' }),
  ev({ type: AgentEventType.RunDone, ok: true, costUsd: 0.1, durationMs: 130_000, turns: 3, result: 'Fixed.' }),
  ev({ type: AgentEventType.TurnChanges, files: [{ path: 'a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }], skipped: [] }),
];

describe('transcript folding', () => {
  it('folds narration and tools behind one row and keeps the answer, done line and changes visible', () => {
    const items = buildTranscript(turn(), undefined, false);
    expect(items.map((i) => i.kind)).toEqual(['user', 'activity', 'text', 'done', 'changes']);
    const activity = items[1] as Extract<(typeof items)[number], { kind: 'activity' }>;
    expect(activity.items.map((i) => i.kind)).toEqual(['text', 'tools']);
    expect(activity.endedAt! - activity.startedAt).toBe(130_000);
    expect(activity.live).toBe(false);
    expect((items[2] as { text: string }).text).toBe('Fixed.');
    const tools = activity.items[1] as Extract<(typeof items)[number], { kind: 'tools' }>;
    expect(tools.steps[1]).toMatchObject({ input: { command: 'npm test' }, output: 'ok' });
  });

  it('keeps the running turn open with everything inside', () => {
    const evs = turn().slice(0, 5);
    const items = buildTranscript(evs, undefined, true);
    expect(items.map((i) => i.kind)).toEqual(['user', 'activity']);
    expect((items[1] as { live: boolean }).live).toBe(true);
  });

  it('leaves turns without tools alone', () => {
    const items = buildTranscript([ev({ type: AgentEventType.UserMessage, text: 'hi', from: 'human' }), ev({ type: AgentEventType.Message, text: 'hello' })], undefined, false);
    expect(items.map((i) => i.kind)).toEqual(['user', 'text']);
  });
});

describe('tool sentences', () => {
  it('counts each kind once per file and in order of first use', () => {
    const step = (id: string, name: string, summary = '') => ({ id, name, summary, state: 'done' as const });
    expect(describeSteps([step('1', 'Read', 'a.ts'), step('2', 'Read', 'a.ts'), step('3', 'Read', 'b.ts'), step('4', 'Bash'), step('5', 'Grep'), step('6', 'Grep')])).toBe(
      'Read 2 files · Ran 1 command · Ran 2 searches',
    );
    expect(describeSteps([step('1', 'TodoWrite'), step('2', 'mcp__x__y')])).toBe('Updated the plan · Used 1 tool');
  });
});
