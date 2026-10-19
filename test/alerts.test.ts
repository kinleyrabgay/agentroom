import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentEventType, NotificationKind } from '../src/shared/enums.js';
import { Hub } from '../src/server/realtime/hub.js';
import { AlertService } from '../src/server/services/alerts/alert.service.js';
import type { AlertChannel, SystemAlert } from '../src/server/services/alerts/channels.js';
import { plainText, spokenLine } from '../src/server/services/alerts/phrases.js';

class FakeChannel implements AlertChannel {
  notified: SystemAlert[] = [];
  spoken: string[] = [];
  played: string[] = [];
  capabilities() {
    return { platform: 'test', system: true, sound: true, voice: true, clickToOpen: false, sounds: ['Glass'] };
  }
  notify(a: SystemAlert) { this.notified.push(a); }
  speak(t: string) { this.spoken.push(t); }
  play(s: string) { this.played.push(s); }
}

function setup(prefs: object = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-alerts-'));
  const prefsFile = path.join(dir, 'alerts.json');
  fs.writeFileSync(prefsFile, JSON.stringify(prefs));
  const hub = new Hub(path.join(dir, 'runs'));
  const channel = new FakeChannel();
  const alerts = new AlertService({
    hub, channel, prefsFile, projectName: 'demo', url: () => 'http://x', botName: (id) => (id === 'planner' ? 'Planner' : id),
  });
  const notify = (kind: string, title: string, body = '') =>
    hub.notification({ id: Math.random().toString(), ts: 0, kind: kind as any, title, body, botId: 'planner', read: false }, true);
  return { hub, channel, alerts, notify, prefsFile };
}

describe('alert phrases', () => {
  it('turns markdown into one short line', () => {
    expect(plainText('## Report\n\n**Outcome** added `subtract`\n\n| a | b |\n|---|---|', 40)).toBe('Report Outcome added subtract');
    expect(plainText('x'.repeat(300), 10)).toHaveLength(10);
  });
  it('speaks the bot name with a short phrase', () => {
    expect(spokenLine({ kind: NotificationKind.PlanReady, title: '' }, 'Planner')).toBe('Planner: plan ready for review');
  });
});

describe('AlertService', () => {
  it('alerts with sound when nobody is looking, stays quiet while a tab is active', () => {
    const { hub, channel, notify } = setup();
    notify(NotificationKind.PlanReady, 'Plan ready: G-1');
    expect(channel.notified).toHaveLength(1);
    expect(channel.notified[0]).toMatchObject({ title: 'Plan ready: G-1', sound: 'Glass', subtitle: 'AgentRoom · demo' });

    const client = { send() {} };
    hub.add(client);
    hub.setPresence(client, true);
    notify(NotificationKind.Info, 'hello');
    expect(channel.notified).toHaveLength(1);
    hub.setPresence(client, false);
    notify(NotificationKind.Info, 'again');
    expect(channel.notified).toHaveLength(2);
  });

  it('speaks when voice is on, without repeating itself', () => {
    const { channel, notify } = setup({ voice: true });
    notify(NotificationKind.PlanReady, 'a');
    notify(NotificationKind.PlanReady, 'b');
    expect(channel.spoken).toEqual(['Planner: plan ready for review']);
  });

  it('alerts on permission requests and honours prefs', () => {
    const { hub, channel, alerts } = setup();
    alerts.update({ system: false });
    hub.emit({ type: AgentEventType.PermissionRequest, botId: 'qa', requestId: 'r1', tool: 'Bash', summary: 'npm test', input: {}, reason: '' });
    expect(channel.notified).toHaveLength(0);
    expect(channel.played).toEqual(['Glass']);
    expect(() => alerts.update({ voice: 'yes' as unknown as boolean })).toThrow();
  });
});
