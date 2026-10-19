import fs from 'node:fs';
import { APP_VERSION, BOT_PLUGIN_PREFIX } from '../../shared/constants.js';
import { SkillScope } from '../../shared/enums.js';
import { BotFrontmatterSchema } from '../../shared/schemas.js';
import type { Bot, BotPatch, NewBotInput } from '../../shared/types/index.js';
import { parseFrontmatter, stringifyFrontmatter } from '../fs/frontmatter.js';
import { writeJson } from '../fs/json.js';
import type { ProjectPaths } from '../paths.js';
import { slugify } from '../slug.js';
import { FsSkillRepository, type SkillRepository } from './skill.repository.js';

export const ROOT_BOT_ID = 'team-lead';
const NO_ORDER = 999;
/** Optional fields a PATCH can clear by sending null or "" (JSON can't carry undefined). */
const CLEARABLE = ['model', 'effort', 'reportsTo'] as const;

export interface BotRepository {
  list(): Bot[];
  get(id: string): Bot | undefined;
  create(input: NewBotInput): Bot;
  update(id: string, patch: BotPatch): Bot;
  delete(id: string): void;
  /** The bot's own skills folder. */
  skillsOf(bot: Bot): SkillRepository;
  /** Make the bot folder loadable as a Claude plugin (needed once it has its own skills). */
  ensurePlugin(bot: Bot): void;
}

/** Bots live in `bots/<NN>-<id>/bot.md`; the number orders them on the canvas. */
export class FsBotRepository implements BotRepository {
  constructor(private readonly paths: ProjectPaths) {}

  list(): Bot[] {
    if (!fs.existsSync(this.paths.bots)) return [];
    const bots: Bot[] = [];
    for (const dir of fs.readdirSync(this.paths.bots).sort()) {
      const file = this.paths.botFile(dir);
      if (!fs.existsSync(file)) continue;
      try {
        bots.push(this.read(dir, file));
      } catch (err) {
        console.warn(`[agentroom] skipping invalid bots/${dir}/bot.md: ${(err as Error).message}`);
      }
    }
    return bots;
  }

  get(id: string): Bot | undefined {
    return this.list().find((b) => b.id === id);
  }

  create({ name, role = 'custom', reportsTo }: NewBotInput): Bot {
    const id = slugify(name, 'bot');
    if (this.get(id)) throw new Error(`bot "${id}" already exists`);
    const order = Math.max(0, ...this.list().map((b) => (b.order === NO_ORDER ? 0 : b.order))) + 1;
    const dir = `${String(order).padStart(2, '0')}-${id}`;
    fs.mkdirSync(this.paths.botDir(dir), { recursive: true });
    const bot: Bot = {
      ...BotFrontmatterSchema.parse({ name, role, reportsTo: reportsTo ?? (id === ROOT_BOT_ID ? undefined : ROOT_BOT_ID) }),
      id,
      dir,
      order,
      prompt: `You are ${name}, a ${role} on this repository's AI team. Describe how this bot should behave here.`,
      localSkills: [],
    };
    this.write(bot);
    return bot;
  }

  update(id: string, patch: BotPatch): Bot {
    const bot = this.require(id);
    // Identity and derived fields come from disk, never from the patch.
    const { id: _i, dir: _d, order: _o, localSkills: _l, ...editable } = patch as Partial<Bot>;
    const next: Bot = { ...bot, ...editable };
    for (const key of CLEARABLE) {
      const v = (editable as Record<string, unknown>)[key];
      if (v === null || v === '') delete next[key];
    }
    BotFrontmatterSchema.parse(next);
    this.write(next);
    return next;
  }

  delete(id: string): void {
    fs.rmSync(this.paths.botDir(this.require(id).dir), { recursive: true, force: true });
  }

  skillsOf(bot: Bot): SkillRepository {
    return new FsSkillRepository(this.paths.botSkills(bot.dir), SkillScope.Bot, bot.id);
  }

  ensurePlugin(bot: Bot): void {
    const manifest = this.paths.botPluginManifest(bot.dir);
    if (fs.existsSync(manifest)) return;
    writeJson(manifest, {
      name: `${BOT_PLUGIN_PREFIX}${bot.id}`,
      version: APP_VERSION,
      description: `Skills owned by the ${bot.name} bot. Managed by AgentRoom.`,
    });
  }

  private require(id: string): Bot {
    const bot = this.get(id);
    if (!bot) throw new Error(`bot "${id}" not found`);
    return bot;
  }

  private read(dir: string, file: string): Bot {
    const m = /^(\d+)-(.+)$/.exec(dir);
    const id = m ? m[2] : dir;
    const doc = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const fm = BotFrontmatterSchema.parse(doc.data);
    const localSkills = new FsSkillRepository(this.paths.botSkills(dir), SkillScope.Bot, id).list();
    return { ...fm, id, dir, order: m ? Number(m[1]) : NO_ORDER, prompt: doc.body, localSkills };
  }

  private write(bot: Bot) {
    const fm = {
      name: bot.name,
      role: bot.role,
      color: bot.color,
      avatar: bot.avatar,
      model: bot.model || undefined,
      effort: bot.effort || undefined,
      reportsTo: bot.reportsTo || undefined,
      tools: bot.tools,
      skills: bot.skills,
    };
    fs.writeFileSync(this.paths.botFile(bot.dir), stringifyFrontmatter(fm, bot.prompt));
  }
}
