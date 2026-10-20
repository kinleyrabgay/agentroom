import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { SecurityReviewMode } from '../../shared/enums.js';
import type { GoalTemplate, GoalTemplateList } from '../../shared/types/index.js';
import { parseFrontmatter } from '../fs/frontmatter.js';
import { copyTreeIfMissing, templatesDir } from '../fs/templates.js';

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

const FrontmatterSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  icon: z.string().optional(),
  order: z.number().default(100),
  securityReview: z.enum(values(SecurityReviewMode)).optional(),
  budgetUsd: z.number().positive().optional(),
  design: z.boolean().optional(),
  fields: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_-]*$/i),
        label: z.string().min(1),
        placeholder: z.string().optional(),
        multiline: z.boolean().optional(),
        required: z.boolean().optional(),
        image: z.boolean().optional(),
      }),
    )
    .default([]),
});

/**
 * Goal templates: `.agentroom/goal-templates/<id>.md` (committed). Frontmatter describes the form,
 * the body is guidance for the Planner. Projects without the folder get AgentRoom's built-in set.
 */
export class GoalTemplateRepository {
  constructor(
    private readonly dir: string,
    private readonly builtInDir: () => string = () => path.join(templatesDir(), 'goal-templates'),
  ) {}

  list(): GoalTemplateList {
    const own = fs.existsSync(this.dir);
    return { templates: readDir(own ? this.dir : this.builtInDir()), builtIn: !own };
  }

  get(id: string): GoalTemplate | undefined {
    return this.list().templates.find((t) => t.id === id);
  }

  /** Copy the built-in templates into the project so the team can edit them. Returns created paths. */
  saveDefaults(): string[] {
    return copyTreeIfMissing(this.builtInDir(), this.dir);
  }
}

function readDir(dir: string): GoalTemplate[] {
  if (!fs.existsSync(dir)) return [];
  const out: GoalTemplate[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    try {
      out.push(parseTemplate(file.replace(/\.md$/, ''), fs.readFileSync(path.join(dir, file), 'utf8')));
    } catch (err) {
      console.warn(`[agentroom] skipping goal template ${file}: ${(err as Error).message}`);
    }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function parseTemplate(id: string, text: string): GoalTemplate {
  const { data, body } = parseFrontmatter(text);
  const fm = FrontmatterSchema.parse(data);
  return {
    id,
    name: fm.name,
    description: fm.description,
    ...(fm.icon ? { icon: fm.icon } : {}),
    order: fm.order,
    fields: fm.fields,
    ...(fm.securityReview ? { securityReview: fm.securityReview } : {}),
    ...(fm.budgetUsd ? { budgetUsd: fm.budgetUsd } : {}),
    ...(fm.design ? { design: true } : {}),
    guidance: body,
  };
}

/**
 * The goal brief from a template's filled-in fields: one "**Label**" paragraph per answered field.
 * Throws when a required field is empty.
 */
export function composeBrief(template: GoalTemplate, values: Record<string, string>, extra = ''): string {
  const parts: string[] = [];
  for (const f of template.fields) {
    const v = String(values[f.id] ?? '').trim();
    if (!v) {
      if (f.required) throw new Error(`"${f.label}" is required for a ${template.name} goal.`);
      continue;
    }
    // Image fields hold an upload id: the image itself is attached to the goal.
    parts.push(`**${f.label}**\n${f.image ? 'Attached image (see the goal attachments).' : v}`);
  }
  if (extra.trim()) parts.push(extra.trim());
  if (!parts.length) throw new Error('Fill in the template first.');
  return `${template.name}: ${firstValue(template, values)}\n\n${parts.join('\n\n')}`;
}

function firstValue(t: GoalTemplate, values: Record<string, string>) {
  const f = t.fields.find((x) => !x.image && String(values[x.id] ?? '').trim());
  return f ? String(values[f.id]).trim().split('\n')[0].slice(0, 100) : t.name;
}
