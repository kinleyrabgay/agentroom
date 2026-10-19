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
  /** Goal templates (committed): `goal-templates/<id>.md`. */
  get goalTemplates() { return path.join(this.dir, 'goal-templates'); }
  /** Memory notes bots proposed, waiting for the human (local). */
  get memorySuggestionsFile() { return path.join(this.runs, 'memory-suggestions.json'); }
  get tasksFile() { return path.join(this.dir, 'tasks', 'board.json'); }
  /** Gitignored: run logs, sessions, preview output. */
  get runs() { return path.join(this.dir, 'runs'); }
  get sessionsFile() { return path.join(this.runs, 'sessions.json'); }
  get inboxFile() { return path.join(this.runs, 'inbox.json'); }
  /** Files the human attached to messages (local, never committed). */
  get uploads() { return path.join(this.runs, 'uploads'); }
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
  /** Security findings (scanner, dependency guard, reviews, prompt injection). */
  get securityFile() { return path.join(this.runs, 'security.json'); }
  /** Sentry org/projects for the Sentry page (committed; the token is a local secret). */
  get sentryFile() { return path.join(this.dir, 'sentry.json'); }
  /** Team MCP servers (committed; secrets are `${secret:NAME}` references). */
  get mcpFile() { return path.join(this.dir, 'mcp.json'); }
  /** This machine's own MCP servers (claude.ai connectors, private servers). */
  get mcpLocalFile() { return path.join(this.runs, 'mcp.local.json'); }
  /** Scheduled work (committed). */
  get schedulesFile() { return path.join(this.dir, 'schedules.json'); }
  /** Event-based automation (committed). */
  get triggersFile() { return path.join(this.dir, 'triggers.json'); }
  /** Scheduler/trigger bookkeeping: last runs, seen issues, presence (local). */
  get automationStateFile() { return path.join(this.runs, 'automation-state.json'); }
  /** One row per automation run (local). */
  get automationHistoryFile() { return path.join(this.runs, 'automation.jsonl'); }
  /** Port and token of the running server, so `agentroom start` can reuse it (local, 0600). */
  get sessionFile() { return path.join(this.runs, 'session.json'); }
  /** Background-mode server output. */
  get daemonLog() { return path.join(this.runs, 'daemon.log'); }
  get gitignore() { return path.join(this.root, '.gitignore'); }
  get claudeMd() { return path.join(this.root, 'CLAUDE.md'); }

  botDir(dir: string) { return path.join(this.bots, dir); }
  botFile(dir: string) { return path.join(this.botDir(dir), 'bot.md'); }
  botSkills(dir: string) { return path.join(this.botDir(dir), 'skills'); }
  botMemory(dir: string) { return path.join(this.botDir(dir), 'memory.md'); }
  botPluginManifest(dir: string) { return path.join(this.botDir(dir), '.claude-plugin', 'plugin.json'); }
}
