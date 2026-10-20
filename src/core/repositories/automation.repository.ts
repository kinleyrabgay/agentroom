import fs from 'node:fs';
import { SchedulesFileSchema, TriggersFileSchema } from '../../shared/schemas.js';
import type { AutomationOwner, AutomationScope, Schedule, Trigger } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';

export interface AutomationFiles {
  /** Team (committed): `.agentroom/schedules.json`. */
  schedules: string;
  /** Team (committed): `.agentroom/triggers.json`. */
  triggers: string;
  /** Personal (local): `runs/schedules.json`. */
  personalSchedules: string;
  /** Personal (local): `runs/triggers.json`. */
  personalTriggers: string;
}

type Scoped = { scope?: AutomationScope; owner?: AutomationOwner };

/**
 * Schedules and triggers in two places:
 * - personal (`runs/*.json`, default): only this machine, never committed;
 * - team (`.agentroom/*.json`, committed): everyone sees them, but each runs only on its owner's machine,
 *   so three teammates don't run the same nightly job three times.
 * Items come back with `scope` set from the file they live in. Team items without an owner (written by
 * 0.0.2) are adopted by the current git user once. An invalid file reads as empty and is reported.
 */
export class AutomationRepository {
  constructor(
    private readonly files: AutomationFiles,
    private readonly me: () => AutomationOwner,
  ) {}

  /** The current git user, the owner of team items created here. */
  owner(): AutomationOwner {
    return this.me();
  }

  schedules(): Schedule[] {
    const parse = (raw: unknown) => SchedulesFileSchema.parse(raw).schedules as Schedule[];
    return [
      ...this.read(this.files.personalSchedules, parse).map((s) => ({ ...s, scope: 'personal' as const })),
      ...this.adopt(this.files.schedules, this.read(this.files.schedules, parse), (list) => this.write(this.files.schedules, 'schedules', list)),
    ];
  }

  triggers(): Trigger[] {
    const parse = (raw: unknown) => TriggersFileSchema.parse(raw).triggers as Trigger[];
    return [
      ...this.read(this.files.personalTriggers, parse).map((t) => ({ ...t, scope: 'personal' as const })),
      ...this.adopt(this.files.triggers, this.read(this.files.triggers, parse), (list) => this.write(this.files.triggers, 'triggers', list)),
    ];
  }

  saveSchedules(list: Schedule[]) {
    this.split(list, this.files.schedules, this.files.personalSchedules, 'schedules');
  }

  saveTriggers(list: Trigger[]) {
    this.split(list, this.files.triggers, this.files.personalTriggers, 'triggers');
  }

  /** Each item to its own file; `scope` is never stored (it is where the item lives). */
  private split<T extends Scoped>(list: T[], teamFile: string, personalFile: string, key: string) {
    const team = list.filter((i) => i.scope === 'team').map(strip);
    const personal = list.filter((i) => i.scope !== 'team').map(({ owner: _o, ...rest }) => strip(rest as T));
    if (team.length || fs.existsSync(teamFile)) this.write(teamFile, key, team);
    if (personal.length || fs.existsSync(personalFile)) this.write(personalFile, key, personal);
  }

  /** Team items without an owner (from 0.0.2) belong to whoever opens them first; saved once. */
  private adopt<T extends Scoped>(file: string, list: T[], save: (l: unknown[]) => void): (T & { scope: 'team' })[] {
    const orphans = list.filter((i) => !i.owner?.email);
    const me = orphans.length ? this.me() : null;
    if (me?.email) {
      list = list.map((i) => (i.owner?.email ? i : { ...i, owner: me }));
      try {
        save(list.map(strip));
        console.log(`  [agentroom] ${orphans.length} team automation item(s) in ${file} now run on ${me.name || me.email}'s machine`);
      } catch {
        // read-only checkout: keep the adoption in memory
      }
    }
    return list.map((i) => ({ ...i, scope: 'team' as const }));
  }

  private write(file: string, key: string, list: unknown[]) {
    writeJson(file, { [key]: list });
  }

  private read<T>(file: string, parse: (raw: unknown) => T[]): T[] {
    if (!fs.existsSync(file)) return [];
    try {
      return parse(readJson(file, {}));
    } catch (err) {
      console.error(`[agentroom] Ignoring invalid ${file}: ${(err as Error).message.slice(0, 300)}`);
      return [];
    }
  }
}

function strip<T extends Scoped>(item: T): Omit<T, 'scope'> {
  const { scope: _s, ...rest } = item;
  return rest;
}

/** "Name <email>" → owner. */
export function parseOwner(user: string): AutomationOwner {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(user.trim());
  if (m) return { name: m[1]!.trim() || m[2]!, email: m[2]!.trim().toLowerCase() };
  return user.includes('@') ? { name: user, email: user.toLowerCase() } : { name: user || 'me', email: '' };
}

/** A team item runs here only for its owner; personal items always run here. */
export function runsHere(item: Scoped, me: AutomationOwner): boolean {
  if (item.scope !== 'team') return true;
  return !!item.owner?.email && !!me.email && item.owner.email.toLowerCase() === me.email.toLowerCase();
}
