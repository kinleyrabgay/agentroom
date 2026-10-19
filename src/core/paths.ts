import path from 'node:path';
import { PROJECT_DIR } from '../shared/constants.js';

/** Every on-disk location AgentRoom uses inside a project. */
export class ProjectPaths {
  readonly root: string;
  readonly dir: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.dir = path.join(this.root, PROJECT_DIR);
  }

  get config() { return path.join(this.dir, 'config.json'); }
  get bots() { return path.join(this.dir, 'bots'); }
  /** The shared skill library, also the library plugin root's `skills/`. */
  get skills() { return path.join(this.dir, 'skills'); }
  get tasksFile() { return path.join(this.dir, 'tasks', 'board.json'); }
  /** Gitignored: run logs, sessions, preview output. */
  get runs() { return path.join(this.dir, 'runs'); }
  get sessionsFile() { return path.join(this.runs, 'sessions.json'); }
  get inboxFile() { return path.join(this.runs, 'inbox.json'); }
  /** Personal alert preferences (OS notifications, sound, voice). */
  get alertsFile() { return path.join(this.runs, 'alerts.json'); }
  /** `.agentroom/github/` — committed GitHub board setup. */
  get githubDir() { return path.join(this.dir, 'github'); }
  get githubProjectFile() { return path.join(this.githubDir, 'project.json'); }
  /** Local cache of the GitHub board's cards. */
  get githubItemsCache() { return path.join(this.runs, 'github-items.json'); }
  /** Team-wide settings (committed). */
  get settingsFile() { return path.join(this.dir, 'settings.json'); }
  /** One row per bot run (budgets, insights, replay). */
  get ledgerFile() { return path.join(this.runs, 'ledger.jsonl'); }
  /** Append-only audit log. */
  get auditFile() { return path.join(this.runs, 'audit.jsonl'); }
  /** Local integration secrets (webhooks, SMTP). Never committed; mode 0600. */
  get secretsFile() { return path.join(this.runs, 'secrets.json'); }
  get gitignore() { return path.join(this.root, '.gitignore'); }
  get claudeMd() { return path.join(this.root, 'CLAUDE.md'); }

  botDir(dir: string) { return path.join(this.bots, dir); }
  botFile(dir: string) { return path.join(this.botDir(dir), 'bot.md'); }
  botSkills(dir: string) { return path.join(this.botDir(dir), 'skills'); }
  botPluginManifest(dir: string) { return path.join(this.botDir(dir), '.claude-plugin', 'plugin.json'); }
}
