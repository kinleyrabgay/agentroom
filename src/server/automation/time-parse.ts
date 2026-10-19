import * as chrono from 'chrono-node';
import { Cron } from 'croner';
import type { TimeParse } from '../../shared/types/index.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const DAY_LABEL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** Words that stand for a time of day when no clock time is given. */
const PART_OF_DAY: Record<string, [number, number]> = {
  morning: [9, 0],
  noon: [12, 0],
  midday: [12, 0],
  afternoon: [14, 0],
  evening: [18, 0],
  night: [22, 0],
  tonight: [22, 0],
  midnight: [0, 0],
};

const TIME = String.raw`(?:\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?|\s+(?:in\s+the\s+)?(morning|noon|midday|afternoon|evening|night|midnight))?`;
const RECURRING = [
  { re: new RegExp(String.raw`\bevery\s+(?:week\s?day|weekdays|working\s+day)s?` + TIME, 'i'), dow: '1-5', label: 'Weekdays' },
  { re: new RegExp(String.raw`\b(?:every\s+day|everyday|daily|each\s+day)` + TIME, 'i'), dow: '*', label: 'Every day' },
  { re: new RegExp(String.raw`\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?` + TIME, 'i'), dow: 'day', label: '' },
] as const;

function clock(h?: string, m?: string, ampm?: string, part?: string): [number, number] {
  if (part) return PART_OF_DAY[part.toLowerCase()] ?? [9, 0];
  if (!h) return [9, 0];
  let hour = Number(h) % 24;
  const minute = m ? Number(m) : 0;
  if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
  if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;
  return [hour, Math.min(59, minute)];
}

const hhmm = ([h, m]: [number, number]) => {
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

/** Remove the phrase and tidy what's left ("Start the feature tomorrow at 9" → "Start the feature"). */
function without(text: string, phrase: string): string {
  return text
    .replace(phrase, ' ')
    .replace(/\s+(at|on|by|from)\s*([.,!?]|$)/i, '$2')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

/** Next time a cron expression fires after `from`, ISO (local time zone). */
export function nextCronRun(cron: string, from: Date): string | null {
  try {
    return new Cron(cron).nextRun(from)?.toISOString() ?? null;
  } catch {
    return null;
  }
}

/** Check a cron expression; returns an error message or null. */
export function cronError(cron: string): string | null {
  try {
    new Cron(cron);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * Find a time in plain words: "tomorrow at 9", "tonight", "in 2 hours", "Monday morning",
 * "every weekday at 8:30", "every day at 10pm", "every Monday 9am".
 * Times are local. `phrase` is the exact substring, so the UI can highlight it.
 */
export function parseWhen(text: string, now = new Date()): TimeParse {
  for (const rule of RECURRING) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const day = rule.dow === 'day' ? DAYS.indexOf(m[1]!.toLowerCase() as (typeof DAYS)[number]) : -1;
    const off = rule.dow === 'day' ? 1 : 0;
    const t = clock(m[1 + off], m[2 + off], m[3 + off], m[4 + off]);
    const dow = rule.dow === 'day' ? String(day) : rule.dow;
    const cron = `${t[1]} ${t[0]} * * ${dow}`;
    const label = `${rule.dow === 'day' ? DAY_LABEL[day] : rule.label} at ${hhmm(t)}`;
    return { at: nextCronRun(cron, now), phrase: m[0].trim(), recurring: { cron, label }, rest: without(text, m[0].trim()) };
  }

  const results = chrono.parse(text, { instant: now, timezone: undefined } as never, { forwardDate: true });
  const r = results[0];
  if (!r) return { at: null, phrase: null, recurring: null, rest: text.trim() };
  const date = r.start.date();
  // "Monday morning" / "tonight" without a clock time: use our part-of-day defaults.
  if (!r.start.isCertain('hour')) {
    const part = /\b(morning|noon|midday|afternoon|evening|night|tonight|midnight)\b/i.exec(r.text)?.[1];
    const [h, m] = part ? PART_OF_DAY[part.toLowerCase()]! : [9, 0];
    date.setHours(h, m, 0, 0);
  } else if (!r.start.isCertain('minute')) {
    date.setMinutes(0, 0, 0);
  }
  if (date.getTime() <= now.getTime()) {
    // Only a time was given and it has passed today: next occurrence.
    if (!r.start.isCertain('day')) date.setDate(date.getDate() + 1);
  }
  return { at: date.toISOString(), phrase: r.text, recurring: null, rest: without(text, r.text) };
}
