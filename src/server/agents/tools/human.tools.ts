import { z } from 'zod';
import { AgentEventType, BotStatus, HostTool, NotificationKind } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import type { TaskRepository } from '../../../core/repositories/task.repository.js';
import type { Hub } from '../../realtime/hub.js';
import type { NotificationService } from '../../services/notification.service.js';
import type { HostToolDef } from '../../providers/provider.js';

export interface HumanToolDeps {
  hub: Hub;
  notifications: NotificationService;
  tasks: TaskRepository;
}

/** Reach the human: a non-blocking notification, or a question the bot waits on. */
export function humanTools(bot: Bot, { hub, notifications, tasks }: HumanToolDeps, signal: AbortSignal): HostToolDef[] {
  const goalOf = (taskId?: string) => (taskId ? tasks.get(taskId)?.goalId : undefined);
  return [
    {
      name: HostTool.NotifyHuman,
      description: 'Send the human a notification (does not wait). Use for progress worth their attention, not for questions.',
      schema: { title: z.string(), body: z.string(), taskId: z.string().optional() },
      handler: async ({ title, body, taskId }) => {
        notifications.create({ kind: NotificationKind.Info, title, body, botId: bot.id, taskId, goalId: goalOf(taskId) });
        return 'Notified.';
      },
    },
    {
      name: HostTool.AskHuman,
      description:
        'Ask the human a question and WAIT for the answer. Use when you are blocked on a decision only they can make ' +
        '(credentials, product choice, a URL). Offer options when you can.',
      schema: { question: z.string(), options: z.array(z.string()).optional(), taskId: z.string().optional() },
      handler: async ({ question, options, taskId }) => {
        const prev = hub.statuses[bot.id];
        hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Waiting, activity: 'Waiting for your answer' });
        try {
          const answer = await notifications.ask(
            { title: `${bot.name} asks`, body: question, options, botId: bot.id, taskId, goalId: goalOf(taskId) },
            signal,
          );
          return `The human answered: ${answer}`;
        } finally {
          hub.emit({ type: AgentEventType.BotStatus, botId: bot.id, status: BotStatus.Working, activity: prev?.activity });
        }
      },
    },
  ];
}
