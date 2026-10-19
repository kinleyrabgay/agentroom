import { z } from 'zod';
import { HostTool, NotificationKind } from '../../../shared/enums.js';
import type { Bot } from '../../../shared/types/index.js';
import type { MemoryRepository } from '../../../core/repositories/memory.repository.js';
import type { NotificationService } from '../../services/notification.service.js';
import type { HostToolDef } from '../../providers/provider.js';

/** Suggest a durable note about this repo for the bot's memory; the human decides whether to keep it. */
export function memoryTools(bot: Bot, memory: MemoryRepository, notifications: NotificationService): HostToolDef[] {
  return [
    {
      name: HostTool.MemoryNote,
      description:
        'Suggest a short, durable note about this repository for your memory (a convention, a command, where something lives, a gotcha). ' +
        'The human reviews it; kept notes are in your instructions from then on. Never include secrets, tokens, personal data or task-specific details.',
      schema: { note: z.string().min(3).max(500), reason: z.string().max(300).optional() },
      handler: async ({ note, reason }) => {
        const s = memory.suggest(bot.id, note, reason);
        notifications.create({ kind: NotificationKind.Info, title: `${bot.name} suggests remembering`, body: s.note, botId: bot.id });
        return 'Suggested. The human will keep or ignore it; do not repeat it.';
      },
    },
  ];
}
