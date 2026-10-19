import fs from 'node:fs';
import { SchedulesFileSchema, TriggersFileSchema } from '../../shared/schemas.js';
import type { Schedule, Trigger } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';

/**
 * Schedules (`.agentroom/schedules.json`) and triggers (`.agentroom/triggers.json`), committed so the
 * whole team (and a cloud runner later) sees the same automation. An invalid file reads as empty
 * and is reported, never thrown, so a typo can't take the server down.
 */
export class AutomationRepository {
  constructor(private readonly files: { schedules: string; triggers: string }) {}

  schedules(): Schedule[] {
    return this.read(this.files.schedules, (raw) => SchedulesFileSchema.parse(raw).schedules) as Schedule[];
  }

  triggers(): Trigger[] {
    return this.read(this.files.triggers, (raw) => TriggersFileSchema.parse(raw).triggers) as Trigger[];
  }

  saveSchedules(list: Schedule[]) {
    writeJson(this.files.schedules, { schedules: list });
  }

  saveTriggers(list: Trigger[]) {
    writeJson(this.files.triggers, { triggers: list });
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
