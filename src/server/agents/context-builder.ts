import fs from 'node:fs';
import { APP_NAME } from '../../shared/constants.js';
import { HostTool, ToolName } from '../../shared/enums.js';
import type { Bot } from '../../shared/types/index.js';
import { CLAUDE_MD_LIMIT } from '../config/constants.js';
import { UNTRUSTED_RULE } from '../security/injection.js';

const BROWSER_GUIDE =
  'You have an in-app browser (browser_* tools) shown live to the human, who may also click and type in it. ' +
  'Use browser_snapshot to read the page; act on elements by their [ref=…]. Refs go stale after the page changes, so re-snapshot. ' +
  'Use browser_console to check errors and failed requests. Never enter passwords or payment details; ask the human to do that in the browser view.';

/** The system-prompt addendum every bot gets: who it is on the team, what AgentRoom tools mean, project instructions. */
export function buildContext(bot: Bot, team: Bot[], claudeMdPath: string): string {
  const roster = team.map((b) => `- ${b.id}: ${b.name} (${b.role})${b.id === bot.id ? ' ← you' : ''}`).join('\n');
  const reports = team.filter((b) => b.reportsTo === bot.id);
  const parts = [
    `# ${APP_NAME}`,
    `You are one bot on an AI team running inside ${APP_NAME}. A human watches your tool calls live and approves risky actions.`,
    `Task board tools: ${HostTool.TaskList}, ${HostTool.TaskGet}, ${HostTool.TaskCreate}, ${HostTool.TaskUpdate}. Keep task status accurate (todo → doing → review → done), log progress with appendLog and tick acceptance criteria as you meet them.`,
    `Reach the human with ${HostTool.NotifyHuman} (no reply needed) or ${HostTool.AskHuman} (waits for their answer — use it when blocked instead of guessing).`,
    UNTRUSTED_RULE,
    bot.tools.includes(ToolName.Browser) ? BROWSER_GUIDE : '',
    reports.length ? `You can hand work to your reports with the \`${HostTool.Delegate}\` tool: ${reports.map((b) => b.id).join(', ')}.` : '',
    `## Team\n${roster}`,
  ];
  if (fs.existsSync(claudeMdPath)) parts.push(`## Project instructions (CLAUDE.md)\n${fs.readFileSync(claudeMdPath, 'utf8').slice(0, CLAUDE_MD_LIMIT)}`);
  return parts.filter(Boolean).join('\n\n');
}
