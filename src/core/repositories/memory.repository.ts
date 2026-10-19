import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Bot, BotMemory, MemoryNote, MemorySuggestion } from '../../shared/types/index.js';
import { readJson, writeJson } from '../fs/json.js';
import type { ProjectPaths } from '../paths.js';

/** Marks a pinned note in memory.md ("- 📌 …"); pinned notes come first and are never trimmed. */
export const PIN = '📌';
/** Most memory a bot gets in its context. */
export const MEMORY_CONTEXT_LIMIT = 4096;
const NOTE_MAX = 500;
const SUGGESTIONS_PER_BOT = 20;

type SuggestionFile = Record<string, MemorySuggestion[]>;

/**
 * What a bot has learned about the repo: `bots/<dir>/memory.md` (committed, one "- " line per note).
 * Bots only *suggest* notes (`runs/memory-suggestions.json`); the human keeps or ignores them.
 */
export class MemoryRepository {
  constructor(private readonly paths: ProjectPaths) {}

  get(bot: Bot): BotMemory {
    return { notes: this.notes(bot), suggestions: this.suggestions(bot.id) };
  }

  notes(bot: Bot): MemoryNote[] {
    const file = this.paths.botMemory(bot.dir);
    if (!fs.existsSync(file)) return [];
    return parseMemory(fs.readFileSync(file, 'utf8'));
  }

  setNotes(bot: Bot, notes: MemoryNote[]): MemoryNote[] {
    const clean = notes
      .map((n) => ({ text: oneLine(n.text), pinned: !!n.pinned }))
      .filter((n) => n.text)
      .map((n) => ({ ...n, text: n.text.slice(0, NOTE_MAX) }));
    const file = this.paths.botMemory(bot.dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatMemory(bot.name, clean));
    return clean;
  }

  suggestions(botId: string): MemorySuggestion[] {
    return this.readSuggestions()[botId] ?? [];
  }

  suggest(botId: string, note: string, reason?: string): MemorySuggestion {
    const text = oneLine(note).slice(0, NOTE_MAX);
    if (!text) throw new Error('The note is empty.');
    const all = this.readSuggestions();
    const list = all[botId] ?? [];
    const dup = list.find((s) => s.note.toLowerCase() === text.toLowerCase());
    if (dup) return dup;
    const s: MemorySuggestion = { id: randomUUID().slice(0, 8), botId, note: text, ...(reason?.trim() ? { reason: oneLine(reason).slice(0, 300) } : {}), ts: new Date().toISOString() };
    all[botId] = [...list, s].slice(-SUGGESTIONS_PER_BOT);
    writeJson(this.paths.memorySuggestionsFile, all);
    return s;
  }

  /** Keep a suggestion: add it to memory.md. Returns the updated memory. */
  keep(bot: Bot, suggestionId: string, text?: string): BotMemory {
    const s = this.take(bot.id, suggestionId);
    const note = oneLine(text ?? s.note);
    const notes = this.notes(bot);
    if (!notes.some((n) => n.text.toLowerCase() === note.toLowerCase())) this.setNotes(bot, [...notes, { text: note, pinned: false }]);
    return this.get(bot);
  }

  ignore(bot: Bot, suggestionId: string): BotMemory {
    this.take(bot.id, suggestionId);
    return this.get(bot);
  }

  /** The block added to the bot's system prompt, pinned notes first, capped in size. */
  contextBlock(bot: Bot): string {
    const notes = this.notes(bot);
    if (!notes.length) return '';
    const ordered = [...notes.filter((n) => n.pinned), ...notes.filter((n) => !n.pinned)];
    const lines: string[] = [];
    let size = 0;
    for (const n of ordered) {
      const line = `- ${n.text}`;
      if (size + line.length + 1 > MEMORY_CONTEXT_LIMIT && !n.pinned) break;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.join('\n');
  }

  private take(botId: string, id: string): MemorySuggestion {
    const all = this.readSuggestions();
    const list = all[botId] ?? [];
    const s = list.find((x) => x.id === id);
    if (!s) throw new Error('That suggestion is gone (already kept or ignored).');
    all[botId] = list.filter((x) => x.id !== id);
    writeJson(this.paths.memorySuggestionsFile, all);
    return s;
  }

  private readSuggestions(): SuggestionFile {
    return readJson<SuggestionFile>(this.paths.memorySuggestionsFile, {});
  }
}

export function parseMemory(text: string): MemoryNote[] {
  const notes: MemoryNote[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (!m) continue;
    let t = m[1].trim();
    const pinned = t.startsWith(PIN);
    if (pinned) t = t.slice(PIN.length).trim();
    if (t) notes.push({ text: t, pinned });
  }
  return notes;
}

export function formatMemory(botName: string, notes: MemoryNote[]): string {
  const body = notes.map((n) => `- ${n.pinned ? `${PIN} ` : ''}${n.text}`).join('\n');
  return `# What ${botName} has learned about this repo\n\nOne note per line. Lines starting with ${PIN} are pinned. Edit freely; AgentRoom adds this to ${botName}'s instructions.\n\n${body}\n`;
}

const oneLine = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim();
