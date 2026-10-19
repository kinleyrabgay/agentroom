import type { Bot } from '../../shared/types/index.js';

/** Roles the goal workflow needs. */
export const WorkflowRole = {
  Lead: 'lead',
  Planner: 'planner',
  Developer: 'developer',
  QA: 'qa',
} as const;
export type WorkflowRole = (typeof WorkflowRole)[keyof typeof WorkflowRole];

export interface TeamRoles {
  lead: Bot;
  planner: Bot;
  developer: Bot;
  qa: Bot;
}

const byRole = (bots: Bot[], role: string) =>
  bots.find((b) => b.role.toLowerCase() === role) ?? bots.find((b) => b.id === role);

/** Security reviewers: role "security" (or an id mentioning security, e.g. "security-auditor"). */
export const isSecurityRole = (bot: Bot) => bot.role.toLowerCase() === 'security' || bot.id.includes('security');

/** The bot that runs the Security phase, if the team has one. */
export function resolveSecurity(bots: Bot[]): Bot | undefined {
  return bots.find((b) => b.role.toLowerCase() === 'security') ?? bots.find((b) => b.id.includes('security'));
}

export const isPlannerRole = (bot: Bot) => bot.role.toLowerCase() === WorkflowRole.Planner || bot.id === WorkflowRole.Planner;

/** The lead is the bot with role "lead", else the top of the tree. */
export function resolveLead(bots: Bot[]): Bot | undefined {
  return bots.find((b) => b.role.toLowerCase() === WorkflowRole.Lead) ?? bots.find((b) => !b.reportsTo);
}

/** Find the bots for each workflow role, or explain which are missing. */
export function resolveRoles(bots: Bot[]): TeamRoles | { missing: string[] } {
  const roles = {
    lead: resolveLead(bots),
    planner: byRole(bots, WorkflowRole.Planner),
    developer: byRole(bots, WorkflowRole.Developer),
    qa: byRole(bots, WorkflowRole.QA),
  };
  const missing = Object.entries(roles).filter(([, b]) => !b).map(([r]) => r);
  return missing.length ? { missing } : (roles as TeamRoles);
}
