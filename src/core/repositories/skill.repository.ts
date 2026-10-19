import fs from 'node:fs';
import path from 'node:path';
import { SkillScope } from '../../shared/enums.js';
import { SkillFrontmatterSchema } from '../../shared/schemas.js';
import type { Skill, SkillInput } from '../../shared/types/index.js';
import { parseFrontmatter, stringifyFrontmatter } from '../fs/frontmatter.js';
import { assertSlug, slugify } from '../slug.js';

const SKILL_FILE = 'SKILL.md';

/** A folder of `<name>/SKILL.md` skills: the shared library, or one bot's own skills. */
export interface SkillRepository {
  list(): Skill[];
  get(name: string): Skill | undefined;
  save(input: SkillInput): Skill;
  delete(name: string): void;
}

export class FsSkillRepository implements SkillRepository {
  constructor(
    private readonly dir: string,
    private readonly scope: SkillScope,
    private readonly botId?: string,
  ) {}

  list(): Skill[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .sort()
      .map((name) => this.read(name))
      .filter((s): s is Skill => !!s);
  }

  get(name: string): Skill | undefined {
    return this.read(assertSlug(name, 'skill'));
  }

  save(input: SkillInput): Skill {
    const name = assertSlug(slugify(input.name, ''), 'skill');
    fs.mkdirSync(path.join(this.dir, name), { recursive: true });
    fs.writeFileSync(path.join(this.dir, name, SKILL_FILE), stringifyFrontmatter({ name, description: input.description }, input.body));
    return this.skill(name, input.description, input.body.trim());
  }

  delete(name: string): void {
    fs.rmSync(path.join(this.dir, assertSlug(name, 'skill')), { recursive: true, force: true });
  }

  private read(name: string): Skill | undefined {
    const file = path.join(this.dir, name, SKILL_FILE);
    if (!fs.existsSync(file)) return undefined;
    const doc = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const fm = SkillFrontmatterSchema.parse(doc.data);
    return this.skill(name, fm.description, doc.body);
  }

  private skill(name: string, description: string, body: string): Skill {
    return { name, description, body, scope: this.scope, ...(this.botId ? { botId: this.botId } : {}) };
  }
}
