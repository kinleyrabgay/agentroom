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
import { memoryTools } from './memory.tools.js';
import { contextTools } from './context.tools.js';
import { autopilotTools, type AutopilotReporter } from './autopilot.tools.js';
import type { ContextReader } from '../../../core/context/index.js';
import type { MemoryRepository } from '../../../core/repositories/memory.repository.js';
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
  /** Bot memory: lets the bot suggest notes (`memory_note`). */
  memory?: MemoryRepository;
  /** Repo context (read-only map); absent when context is off. */
  context?: ContextReader;
  /** Incident autopilot: `autopilot_report` on autopilot goals. */
  autopilot?: AutopilotReporter;
  /** Multi-repo workspaces: repo ids tasks may name (`repo` on task_create/task_update). */
  repos?: string[];
  primaryRepo?: string;
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
    ...(deps.repos ? { repos: deps.repos, primaryRepo: deps.primaryRepo } : {}),
  };
  const tools = [...taskTools(board, bot.id), ...humanTools(bot, deps, signal)];
  if (deps.memory) tools.push(...memoryTools(bot, deps.memory, deps.notifications));
  if (deps.context) tools.push(...contextTools(deps.context));
  if (isPlannerRole(bot)) tools.push(...planningTools(board, bot.id));
  if (deps.autopilot && deps.goalId && deps.goals.get(deps.goalId)?.autopilot) tools.push(...autopilotTools(deps.autopilot, deps.goalId, (deps.repos ?? []).filter((r) => r !== deps.primaryRepo)));
  if (bot.tools.includes(ToolName.Browser)) {
    const guard = deps.security
      ? (text: string, source: string) => deps.security!.guardUntrusted(text, source, { botId: bot.id, goalId: deps.goalId, runKey: signal })
      : undefined;
    tools.push(...browserTools(bot, deps.previews, deps.hub, signal, guard));
  }
  if (deps.security && isSecurityRole(bot)) tools.push(...securityTools(bot, deps.security, deps.goalId, { ids: deps.repos ?? [], ...(deps.primaryRepo ? { primary: deps.primaryRepo } : {}) }));
  const reports = team.filter((b) => b.reportsTo === bot.id).map((b) => b.id);
  if (reports.length) tools.push(delegateTool(reports, deps.delegate));
  return tools;
}
