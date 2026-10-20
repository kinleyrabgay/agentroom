import { z } from 'zod';
import { FindingCategory, FindingSeverity, FindingSource, HostTool } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import type { HostToolDef } from '../../providers/provider.js';
import type { SecurityService } from '../../security/security.service.js';

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

/** Tools for security reviewers: record a finding on the goal they review. */
export function securityTools(bot: Bot, security: SecurityService, goalId?: string, repos: { ids: string[]; primary?: string } = { ids: [] }): HostToolDef[] {
  const others = repos.ids.filter((r) => r !== repos.primary);
  return [
    {
      name: HostTool.SecurityFinding,
      description:
        'Record a security finding for the human (shown on the Security page and the goal). Use "critical" only for issues that must be fixed before merge (leaked secrets, injection, broken auth); "warning" for risky code that needs a look; "info" for notes.',
      schema: {
        severity: z.enum(values(FindingSeverity)),
        category: z.enum(values(FindingCategory)),
        title: z.string().describe('Short, specific: "SQL injection in /api/orders search"'),
        detail: z.string().describe('Markdown: what is wrong, how it can be exploited, how to fix it'),
        file: z.string().optional(),
        line: z.number().int().optional(),
        ...(others.length ? { repo: z.string().optional().describe(`Workspace repo the file is in, when it isn't the primary repo: one of ${others.join(', ')}`) } : {}),
      },
      handler: async ({ severity, category, title, detail, file, line, repo }) => {
        const inRepo = typeof repo === 'string' && others.includes(repo) ? repo : undefined;
        if (typeof repo === 'string' && repo && repo !== repos.primary && !inRepo) return `Unknown repo "${repo}". Use one of: ${others.join(', ')} (or leave it out for the primary repo).`;
        const [f] = security.findings.record(
          [{ severity, category, source: FindingSource.Review, rule: `review.${category}`, title, detail, ...(file ? { file } : {}), ...(line ? { line } : {}), snippet: title }],
          { botId: bot.id, ...(goalId ? { goalId } : {}), ...(inRepo ? { repo: inRepo } : {}) },
        );
        return `Recorded ${severity} finding ${f.id.slice(0, 8)}: ${title}`;
      },
    },
  ];
}
