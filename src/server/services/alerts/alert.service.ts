import { AgentEventType } from '../../../shared/enums.js';
import { APP_NAME, DEFAULT_ALERT_PREFS } from '../../../shared/constants.js';
import type { AlertCapabilities, AlertPrefs, Notification } from '../../../shared/types/index.js';
import { readJson, writeJson } from '../../../core/fs/json.js';
import { VOICE_DEDUPE_MS, VOICE_MIN_GAP_MS } from '../../config/constants.js';
import type { Hub } from '../../realtime/hub.js';
import type { AlertChannel } from './channels.js';
import { plainText, spokenLine } from './phrases.js';

export interface AlertServiceDeps {
  hub: Hub;
  channel: AlertChannel;
  /** `.agentroom/runs/alerts.json` — personal, not committed. */
  prefsFile: string;
  projectName: string;
  /** UI address opened when a notification is clicked (where supported). */
  url: () => string | undefined;
  botName: (botId: string | undefined) => string | undefined;
}

/**
 * Alerts that reach the human when they're not looking at AgentRoom:
 * native OS notifications, a sound, and an optional spoken line.
 */
export class AlertService {
  private prefs: AlertPrefs;
  private lastSpoken = 0;
  private recentLines = new Map<string, number>();

  constructor(private readonly deps: AlertServiceDeps) {
    this.prefs = { ...DEFAULT_ALERT_PREFS, ...readJson<Partial<AlertPrefs>>(deps.prefsFile, {}) };
    deps.hub.onNotification((n) => this.onNotification(n));
    deps.hub.onEvent((e) => {
      if (e.type === AgentEventType.PermissionRequest) {
        this.alert({
          title: `${this.deps.botName(e.botId) ?? e.botId} needs approval`,
          body: `${e.tool}: ${plainText(e.summary, 140)}`,
          spoken: `${this.deps.botName(e.botId) ?? 'A bot'} needs your approval`,
          group: `approval-${e.requestId}`,
        });
      }
    });
  }

  get(): { prefs: AlertPrefs; capabilities: AlertCapabilities } {
    return { prefs: this.prefs, capabilities: this.deps.channel.capabilities() };
  }

  update(patch: Partial<AlertPrefs>): AlertPrefs {
    const next = { ...this.prefs };
    for (const key of Object.keys(DEFAULT_ALERT_PREFS) as (keyof AlertPrefs)[]) {
      const v = patch[key];
      if (v === undefined) continue;
      if (typeof v !== typeof DEFAULT_ALERT_PREFS[key]) throw new Error(`invalid value for ${key}`);
      (next as Record<string, unknown>)[key] = v;
    }
    this.prefs = next;
    writeJson(this.deps.prefsFile, this.prefs);
    return this.prefs;
  }

  /** Fire a sample alert regardless of presence. */
  test() {
    this.alert({ title: 'AgentRoom alerts are on', body: 'You will hear from your bots like this.', spoken: 'Team Lead: alerts are working', force: true });
  }

  private onNotification(n: Notification) {
    const bot = this.deps.botName(n.botId);
    this.alert({ title: plainText(n.title, 80), body: plainText(n.body), spoken: spokenLine(n, bot), group: n.id });
  }

  private alert(a: { title: string; body: string; spoken: string; group?: string; force?: boolean }) {
    const { prefs, channel } = { prefs: this.prefs, channel: this.deps.channel };
    if (!a.force && prefs.onlyWhenAway && this.deps.hub.isActive) return;
    const sound = prefs.sound ? prefs.soundName : undefined;
    if (prefs.system) {
      channel.notify({ title: a.title, subtitle: `${APP_NAME} · ${this.deps.projectName}`, body: a.body, sound, url: this.deps.url(), group: a.group });
    } else if (sound) {
      channel.play(sound);
    }
    if (prefs.voice) this.say(a.spoken);
  }

  /** Speak, but never talk over itself or repeat the same line within a short window. */
  private say(line: string) {
    const now = Date.now();
    if (now - this.lastSpoken < VOICE_MIN_GAP_MS) return;
    const last = this.recentLines.get(line);
    if (last && now - last < VOICE_DEDUPE_MS) return;
    this.lastSpoken = now;
    this.recentLines.set(line, now);
    this.deps.channel.speak(line);
  }
}
