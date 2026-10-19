import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AlertCapabilities } from '../../../shared/types/index.js';

export interface SystemAlert {
  title: string;
  subtitle?: string;
  body: string;
  /** System sound name, or undefined for silent. */
  sound?: string;
  /** Opened when the notification is clicked (where supported). */
  url?: string;
  /** Replaces an earlier notification with the same group (where supported). */
  group?: string;
}

/** One OS's way of notifying, playing sounds and speaking. All arguments are passed as argv — never through a shell. */
export interface AlertChannel {
  capabilities(): AlertCapabilities;
  notify(alert: SystemAlert): void;
  speak(text: string): void;
  /** Play a sound on its own (used when notifications are off but sound is on). */
  play(sound: string): void;
}

const run = (cmd: string, args: string[]) => execFile(cmd, args, { timeout: 10_000 }, () => {});
const has = (cmd: string) => {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const MAC_SOUNDS = ['Glass', 'Ping', 'Hero', 'Submarine', 'Funk', 'Pop', 'Purr', 'Tink', 'Blow', 'Bottle', 'Frog', 'Morse', 'Sosumi', 'Basso'];

/** macOS: terminal-notifier when installed (click opens AgentRoom), else osascript; `say` for voice; afplay for sounds. */
export class MacChannel implements AlertChannel {
  private readonly notifier = has('terminal-notifier');

  capabilities(): AlertCapabilities {
    return { platform: 'darwin', system: true, sound: true, voice: true, clickToOpen: this.notifier, sounds: MAC_SOUNDS };
  }

  notify(a: SystemAlert) {
    if (this.notifier) {
      const args = ['-title', a.title, '-message', a.body || ' ', '-group', a.group ?? 'agentroom'];
      if (a.subtitle) args.push('-subtitle', a.subtitle);
      if (a.sound) args.push('-sound', a.sound);
      if (a.url) args.push('-open', a.url);
      run('terminal-notifier', args);
      return;
    }
    // AppleScript reads the strings from argv, so nothing in them is ever interpreted as code.
    const script = a.sound
      ? 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv) sound name (item 4 of argv)\nend run'
      : 'on run argv\ndisplay notification (item 2 of argv) with title (item 1 of argv) subtitle (item 3 of argv)\nend run';
    run('osascript', ['-e', script, a.title, a.body || ' ', a.subtitle ?? '', ...(a.sound ? [a.sound] : [])]);
  }

  speak(text: string) {
    run('say', [text]);
  }

  play(sound: string) {
    const file = `/System/Library/Sounds/${sound}.aiff`;
    if (fs.existsSync(file)) run('afplay', [file]);
  }
}

/** Linux desktops: notify-send, canberra/paplay for sounds, spd-say/espeak for voice. */
export class LinuxChannel implements AlertChannel {
  private readonly notifySend = has('notify-send');
  private readonly speaker = has('spd-say') ? 'spd-say' : has('espeak') ? 'espeak' : null;
  private readonly player = has('canberra-gtk-play') ? 'canberra-gtk-play' : has('paplay') ? 'paplay' : null;

  capabilities(): AlertCapabilities {
    return {
      platform: 'linux',
      system: this.notifySend,
      sound: !!this.player,
      voice: !!this.speaker,
      clickToOpen: false,
      sounds: ['complete', 'message', 'bell'],
    };
  }

  notify(a: SystemAlert) {
    if (this.notifySend) run('notify-send', ['-a', 'AgentRoom', a.subtitle ? `${a.title} · ${a.subtitle}` : a.title, a.body]);
    if (a.sound) this.play(a.sound);
  }

  speak(text: string) {
    if (this.speaker) run(this.speaker, [text]);
  }

  play(sound: string) {
    if (this.player === 'canberra-gtk-play') run(this.player, ['-i', sound]);
    else if (this.player === 'paplay') {
      const file = `/usr/share/sounds/freedesktop/stereo/${sound}.oga`;
      if (fs.existsSync(file)) run('paplay', [file]);
    }
  }
}

/** Platforms without a supported channel: alerts stay in the in-app inbox. */
export class NoopChannel implements AlertChannel {
  capabilities(): AlertCapabilities {
    return { platform: process.platform, system: false, sound: false, voice: false, clickToOpen: false, sounds: [] };
  }
  notify() {}
  speak() {}
  play() {}
}

export function createAlertChannel(): AlertChannel {
  if (process.platform === 'darwin') return new MacChannel();
  if (process.platform === 'linux') return new LinuxChannel();
  return new NoopChannel();
}
