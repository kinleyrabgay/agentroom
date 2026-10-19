import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_DIR } from '../shared/constants.js';
import { SkillScope } from '../shared/enums.js';
import type { Bot, ProjectInfo, Skill, SkillInput } from '../shared/types/index.js';
import { copyTreeIfMissing, templatesDir } from './fs/templates.js';
import { gitBranch } from './git.js';
import { ProjectPaths } from './paths.js';
import { FsBotRepository, type BotRepository } from './repositories/bot.repository.js';
import { FsConfigRepository, type ConfigRepository } from './repositories/config.repository.js';
import { FsSkillRepository, type SkillRepository } from './repositories/skill.repository.js';
import { BoardStore } from './repositories/board.store.js';
import { FsGoalRepository, type GoalRepository } from './repositories/goal.repository.js';
import { FsTaskRepository, type TaskRepository } from './repositories/task.repository.js';
import { FsSettingsRepository, type SettingsRepository } from './repositories/settings.repository.js';
import { MemoryRepository } from './repositories/memory.repository.js';
import { GoalTemplateRepository } from './repositories/goal-template.repository.js';

/**
 * Facade over a project's `.agentroom/` folder. Repositories own each kind of file;
 * this class adds the operations that span them (scaffolding, skill assignment rules).
 */
export class Project {
  readonly paths: ProjectPaths;
  readonly bots: BotRepository;
  /** The shared skill library (`.agentroom/skills/`). */
  readonly library: SkillRepository;
  readonly tasks: TaskRepository;
  readonly goals: GoalRepository;
  readonly config: ConfigRepository;
  /** Team-wide settings (`.agentroom/settings.json`). */
  readonly settings: SettingsRepository;
  /** What each bot has learned (`bots/<dir>/memory.md`) and notes bots suggested. */
  readonly memory: MemoryRepository;
  /** Goal templates (`goal-templates/*.md`, or the built-in set). */
  readonly goalTemplates: GoalTemplateRepository;

  constructor(root: string) {
    this.paths = new ProjectPaths(root);
    this.bots = new FsBotRepository(this.paths);
    this.library = new FsSkillRepository(this.paths.skills, SkillScope.Library);
    const board = new BoardStore(this.paths.tasksFile);
    this.tasks = new FsTaskRepository(board);
    this.goals = new FsGoalRepository(board);
    this.config = new FsConfigRepository(this.paths.config);
    this.settings = new FsSettingsRepository(this.paths.settingsFile);
    this.memory = new MemoryRepository(this.paths);
    this.goalTemplates = new GoalTemplateRepository(this.paths.goalTemplates);
  }

  get root() { return this.paths.root; }

  exists(): boolean {
    return fs.existsSync(this.paths.config);
  }

  /** Scaffold `.agentroom/` from templates. Never overwrites existing files. Returns created paths. */
  init(): string[] {
    const created = copyTreeIfMissing(templatesDir(), this.paths.dir);
    if (!fs.existsSync(this.paths.tasksFile)) {
      new BoardStore(this.paths.tasksFile).write({ version: 2, goals: [], tasks: [] });
      created.push(this.paths.tasksFile);
    }
    fs.mkdirSync(this.paths.runs, { recursive: true });
    this.ensureGitignore();
    return created.map((p) => path.relative(this.root, p));
  }

  info(): ProjectInfo {
    const config = this.config.get();
    return { root: this.root, name: path.basename(this.root), branch: gitBranch(this.root), provider: config.provider, model: config.model, config };
  }

  // ---------- skills across library and bots ----------

  /** Delete a library skill and unassign it from every bot. */
  deleteLibrarySkill(name: string): void {
    this.library.delete(name);
    for (const bot of this.bots.list()) {
      if (bot.skills.includes(name)) this.bots.update(bot.id, { skills: bot.skills.filter((s) => s !== name) });
    }
  }

  saveBotSkill(botId: string, input: SkillInput): Skill {
    const bot = this.requireBot(botId);
    const skill = this.bots.skillsOf(bot).save(input);
    this.bots.ensurePlugin(bot);
    return skill;
  }

  deleteBotSkill(botId: string, name: string): void {
    this.bots.skillsOf(this.requireBot(botId)).delete(name);
  }

  /**
   * Copy a library skill into the bot's own folder so it can diverge, and drop the
   * library assignment so the bot doesn't load both.
   */
  customizeSkill(botId: string, name: string): Bot {
    const bot = this.requireBot(botId);
    const source = this.library.get(name);
    if (!source) throw new Error(`library skill "${name}" not found`);
    const own = this.bots.skillsOf(bot);
    if (own.get(name)) throw new Error(`${bot.name} already has its own "${name}" skill`);
    own.save(source);
    this.bots.ensurePlugin(bot);
    return this.bots.update(bot.id, { skills: bot.skills.filter((s) => s !== name) });
  }

  private requireBot(id: string): Bot {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`bot "${id}" not found`);
    return bot;
  }

  private ensureGitignore() {
    const line = `${PROJECT_DIR}/runs/`;
    const current = fs.existsSync(this.paths.gitignore) ? fs.readFileSync(this.paths.gitignore, 'utf8') : '';
    if (current.split(/\r?\n/).includes(line)) return;
    const sep = current && !current.endsWith('\n') ? '\n' : '';
    fs.writeFileSync(this.paths.gitignore, `${current}${sep}${line}\n`);
  }
}
