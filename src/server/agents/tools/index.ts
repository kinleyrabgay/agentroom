import { ToolName } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import type { GoalRepository } from '../../../core/repositories/goal.repository.js';
import type { TaskRepository } from '../../../core/repositories/task.repository.js';
import type { PreviewService } from '../../preview/preview.service.js';
import type { Hub } from '../../realtime/hub.js';
import type { NotificationService } from '../../services/notification.service.js';
import type { HostToolDef } from '../../providers/provider.js';
import { isPlannerRole, isSecurityRole } from '../../workflow/roles.js';
import type { SecurityService } from '../../security/security.service.js';
import { securityTools } from './security.tools.js';
import { browserTools } from './browser.tools.js';
import { delegateTool, type Delegate } from './delegate.tool.js';
import { humanTools } from './human.tools.js';
import { planningTools, taskTools } from './task.tools.js';

export interface HostToolDeps {
  tasks: TaskRepository;
  goals: GoalRepository;
  previews: PreviewService;
  hub: Hub;
  notifications: NotificationService;
  delegate: Delegate;
  /** Board written — push it to the UI. */
  boardChanged: () => void;
  /** Goal this run belongs to, when the workflow engine started it. */
  goalId?: string;
  /** Security layer: findings tool for reviewers, untrusted-content guard for browser output. */
  security?: SecurityService;
}

/**
 * Every AgentRoom tool this bot gets: task board + human channel always, planning tools for
 * planners, browser if enabled, delegate if it has reports.
 */
export function buildHostTools(bot: Bot, team: Bot[], deps: HostToolDeps, signal: AbortSignal): HostToolDef[] {
  const board = {
    tasks: deps.tasks,
    goals: deps.goals,
    changed: deps.boardChanged,
    goalId: deps.goalId,
    roleOf: (id: string) => team.find((b) => b.id === id)?.role,
  };
  const tools = [...taskTools(board, bot.id), ...humanTools(bot, deps, signal)];
  if (isPlannerRole(bot)) tools.push(...planningTools(board, bot.id));
  if (bot.tools.includes(ToolName.Browser)) {
    const guard = deps.security
      ? (text: string, source: string) => deps.security!.guardUntrusted(text, source, { botId: bot.id, goalId: deps.goalId, runKey: signal })
      : undefined;
    tools.push(...browserTools(bot, deps.previews, deps.hub, signal, guard));
  }
  if (deps.security && isSecurityRole(bot)) tools.push(...securityTools(bot, deps.security, deps.goalId));
  const reports = team.filter((b) => b.reportsTo === bot.id).map((b) => b.id);
  if (reports.length) tools.push(delegateTool(reports, deps.delegate));
  return tools;
}
