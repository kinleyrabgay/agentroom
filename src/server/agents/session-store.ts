import { readJson, writeJson } from '../../core/fs/json.js';

/** Remembers each bot's provider session id so conversations resume across runs and restarts. */
export class SessionStore {
  private sessions: Record<string, string>;

  constructor(private readonly file: string) {
    this.sessions = readJson<Record<string, string>>(file, {});
  }

  get(botId: string): string | undefined {
    return this.sessions[botId];
  }

  set(botId: string, sessionId: string) {
    if (this.sessions[botId] === sessionId) return;
    this.sessions[botId] = sessionId;
    writeJson(this.file, this.sessions);
  }

  clear(botId: string) {
    delete this.sessions[botId];
    writeJson(this.file, this.sessions);
  }
}
