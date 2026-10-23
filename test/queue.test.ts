import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentEventType, ProviderId, QueueHoldReason, RateLimitStatus, SteerStatus } from '../src/shared/enums.js';
import { Project } from '../src/core/project.js';
import { BotQueues } from '../src/server/agents/bot-queue.js';
import { PermissionGate } from '../src/server/agents/permission-gate.js';
import { SessionStore } from '../src/server/agents/session-store.js';
import { CONTINUE_PROMPT, Team } from '../src/server/agents/team.js';
import { TurnTracker, unifiedDiff } from '../src/server/agents/turn-changes.js';
import { PreviewService } from '../src/server/preview/preview.service.js';
import type { Provider, RunRequest, RunResult } from '../src/server/providers/provider.js';
import { Hub } from '../src/server/realtime/hub.js';
import { NotificationService } from '../src/server/services/notification.service.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentroom-queue-'));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A provider whose runs wait until the test finishes them; it takes steers while running. */
class HeldProvider implements Provider {
  readonly id = 'held';
  readonly prompts: string[] = [];
  steered: string[] = [];
  private finishers: ((r: RunResult) => void)[] = [];
  private current: RunRequest | null = null;
  steerable = true;

  run(req: RunRequest): Promise<RunResult> {
    this.prompts.push(req.prompt);
    this.current = req;
    if (this.steerable) {
      req.steering?.attach({
        steer: (id, text) => {
          this.steered.push(text);
          queueMicrotask(() => req.steering?.status(id, SteerStatus.Delivered));
          return true;
        },
      });
    }
    return new Promise((resolve) => this.finishers.push(resolve));
  }
  limit(resetsAt: number) {
    this.current!.emit({ type: AgentEventType.RateLimit, provider: ProviderId.Claude, window: 'five_hour', status: RateLimitStatus.Rejected, resetsAt });
  }
  finish(r: RunResult = { ok: true, result: 'done' }) {
    this.current?.steering?.attach(null);
    this.finishers.shift()!(r);
  }
  get running() {
    return this.finishers.length;
  }
  async listModels() {
    return [];
  }
}

function setup(queueFile?: string) {
  const root = tmp();
  const project = new Project(root);
  project.init();
  const hub = new Hub(project.paths.runs);
  const provider = new HeldProvider();
  const queue = new BotQueues(queueFile ?? path.join(project.paths.runs, 'queue.json'));
  const team = new Team({
    project,
    hub,
    provider,
    previews: new PreviewService(hub),
    permissions: new PermissionGate(hub, () => project.config.get(), root),
    sessions: new SessionStore(project.paths.sessionsFile),
    notifications: new NotificationService(hub, project.paths.inboxFile),
    boardChanged: () => {},
    queue,
  });
  const bot = project.bots.list()[0]!.id;
  return { project, hub, provider, queue, team, bot };
}

describe('message queue', () => {
  it('sends right away when free, queues while busy, and drains after a clean run', async () => {
    const { provider, queue, team, bot } = setup();
    team.submit(bot, 'first');
    await until(() => provider.running === 1);
    team.submit(bot, 'second');
    team.submit(bot, 'third');
    expect(queue.get(bot).items.map((m) => m.text)).toEqual(['second', 'third']);
    provider.finish();
    await until(() => provider.prompts.length === 2);
    expect(provider.prompts[1]).toBe('second');
    expect(queue.get(bot).items.map((m) => m.text)).toEqual(['third']);
    provider.finish();
    await until(() => provider.prompts.length === 3);
    provider.finish();
    await tick();
    expect(queue.get(bot).items).toEqual([]);
  });

  it('holds after a failed or stopped run until you resume', async () => {
    const { provider, queue, team, bot } = setup();
    team.submit(bot, 'first');
    await until(() => provider.running === 1);
    team.submit(bot, 'second');
    provider.finish({ ok: false, result: 'boom' });
    await until(() => !!queue.get(bot).hold);
    expect(queue.get(bot).hold!.reason).toBe(QueueHoldReason.Failed);
    expect(provider.prompts).toHaveLength(1);
    team.resume(bot);
    await until(() => provider.prompts.length === 2);
    expect(queue.get(bot).hold).toBeNull();
    provider.finish();
  });

  it('edits, reorders, removes and sends a queued message now', async () => {
    const { provider, queue, team, bot } = setup();
    team.submit(bot, 'first');
    await until(() => provider.running === 1);
    team.submit(bot, 'a');
    team.submit(bot, 'b');
    team.submit(bot, 'c');
    const [a, b, c] = queue.get(bot).items;
    queue.edit(bot, a!.id, 'A');
    queue.move(bot, c!.id, 0);
    queue.remove(bot, b!.id);
    expect(queue.get(bot).items.map((m) => m.text)).toEqual(['c', 'A']);
    team.sendNow(bot, a!.id);
    await until(() => provider.steered.length === 1);
    expect(provider.steered).toEqual(['A']);
    expect(queue.get(bot).items.map((m) => m.text)).toEqual(['c']);
    provider.finish();
    await until(() => provider.prompts.length === 2);
    provider.finish();
  });

  it('keeps queued messages across a restart, held until you resume', async () => {
    const file = path.join(tmp(), 'queue.json');
    const first = new BotQueues(file);
    first.add('developer', 'later');
    const again = new BotQueues(file);
    expect(again.get('developer').items.map((m) => m.text)).toEqual(['later']);
    expect(again.get('developer').hold?.reason).toBe(QueueHoldReason.Restart);
  });
});

describe('steering', () => {
  it('writes into the running turn and shows the message where the run took it', async () => {
    const { provider, queue, team, bot, hub } = setup();
    const seen: string[] = [];
    hub.onEvent((e) => {
      if (e.type === AgentEventType.UserMessage) seen.push(e.text);
    });
    team.submit(bot, 'build it');
    await until(() => provider.running === 1);
    team.steer(bot, 'use tabs, not spaces');
    expect(provider.steered).toEqual(['use tabs, not spaces']);
    await until(() => seen.includes('use tabs, not spaces'));
    expect(queue.get(bot).steers).toEqual([]);
    expect(provider.prompts).toHaveLength(1);
    provider.finish();
  });

  it('puts the message first in line when the run cannot take it', async () => {
    const { provider, queue, team, bot } = setup();
    provider.steerable = false;
    team.submit(bot, 'build it');
    await until(() => provider.running === 1);
    team.submit(bot, 'queued');
    team.steer(bot, 'urgent');
    expect(queue.get(bot).items.map((m) => m.text)).toEqual(['urgent', 'queued']);
    provider.finish();
    await until(() => provider.prompts.length === 2);
    expect(provider.prompts[1]).toBe('urgent');
    provider.finish();
  });

  it('requeues a steer the run never took', async () => {
    const { provider, queue, team, bot } = setup();
    team.submit(bot, 'build it');
    await until(() => provider.running === 1);
    // A run that accepts the steer but reports it failed (it ended before taking it).
    provider.steerable = false;
    const req = (provider as unknown as { current: RunRequest }).current;
    req.steering!.attach({ steer: (id) => (queueMicrotask(() => req.steering!.status(id, SteerStatus.Failed)), true) });
    team.steer(bot, 'too late');
    await until(() => queue.get(bot).items.length === 1);
    expect(queue.get(bot).items[0]!.text).toBe('too late');
    provider.finish();
    await until(() => provider.prompts.length === 2);
    provider.finish();
  });
});

describe('usage limit', () => {
  it('holds the queue until the reset and continues on its own when asked to', async () => {
    const { provider, queue, team, bot } = setup();
    team.setResumeAtReset(bot, true);
    team.submit(bot, 'work');
    await until(() => provider.running === 1);
    team.submit(bot, 'next');
    // Resets right away (the slack is a few seconds, so drive the timer by hand below).
    provider.limit(Math.floor(Date.now() / 1000));
    provider.finish({ ok: false, result: 'limit' });
    await until(() => queue.get(bot).hold?.reason === QueueHoldReason.Limited);
    expect(queue.get(bot).hold!.until).toBeTypeOf('number');
    // Sending into a held queue with items keeps it held.
    expect(provider.prompts).toHaveLength(1);
    team.resume(bot);
    await until(() => provider.prompts.length === 2);
    expect(provider.prompts[1]).toBe('next');
    provider.finish();
  });

  it('says continue first when the reset timer fires', async () => {
    const { provider, queue, team, bot } = setup();
    team.submit(bot, 'work');
    await until(() => provider.running === 1);
    provider.limit(Math.floor(Date.now() / 1000) - 10);
    provider.finish({ ok: false, result: 'limit' });
    await until(() => queue.get(bot).hold?.reason === QueueHoldReason.Limited);
    // Turning it on with the reset already passed fires after the short slack.
    team.setResumeAtReset(bot, true);
    await until(() => provider.prompts.length === 2, 8000);
    expect(provider.prompts[1]).toBe(CONTINUE_PROMPT);
    provider.finish();
  }, 10000);
});

describe('turn changes', () => {
  it('diffs what the run wrote and leaves out files changed in between', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'x\n');
    const t = new TurnTracker(root);
    t.before('1', 'Edit', { file_path: 'a.txt' });
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\nTWO\n');
    t.after('1');
    t.before('2', 'Write', { file_path: path.join(root, 'new.txt') });
    fs.writeFileSync(path.join(root, 'new.txt'), 'hello\n');
    t.after('2');
    t.before('3', 'Edit', { file_path: 'b.txt' });
    fs.writeFileSync(path.join(root, 'b.txt'), 'y\n');
    t.after('3');
    fs.writeFileSync(path.join(root, 'b.txt'), 'someone else\n');
    t.before('4', 'Edit', { file_path: 'b.txt' });
    fs.writeFileSync(path.join(root, 'b.txt'), 'z\n');
    t.after('4');
    t.before('5', 'Edit', { file_path: '../outside.txt' });
    t.before('6', 'Bash', { command: 'echo hi > c.txt' });
    const out = (await t.finish())!;
    expect(out.files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['a.txt', 'modified', 1, 1],
      ['new.txt', 'added', 1, 0],
    ]);
    expect(out.files[0]!.patch).toContain('+TWO');
    expect(out.skipped.map((s) => s.path)).toEqual(['b.txt']);
  });

  it('returns null when nothing changed', async () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, 'a.txt'), 'same\n');
    const t = new TurnTracker(root);
    t.before('1', 'Edit', { file_path: 'a.txt' });
    t.after('1');
    expect(await t.finish()).toBeNull();
    expect(await unifiedDiff(Buffer.from('a\n'), Buffer.from('a\n'))).toBe('');
  });
});
