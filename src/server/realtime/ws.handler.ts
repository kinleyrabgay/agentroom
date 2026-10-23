import { AgentEventType, ClientMessageType } from '../../shared/enums.js';
import type { ClientMessage } from '../../shared/types/index.js';
import type { PermissionGate } from '../agents/permission-gate.js';
import type { Team } from '../agents/team.js';
import type { BotQueues } from '../agents/bot-queue.js';
import type { PreviewService } from '../preview/preview.service.js';
import type { NotificationService } from '../services/notification.service.js';
import type { Client, Hub } from './hub.js';

export type ClientMessageRouter = (client: Client, raw: string) => void;

export interface RouterDeps {
  hub: Hub;
  team: Team;
  permissions: PermissionGate;
  previews: PreviewService;
  notifications: NotificationService;
  queue?: BotQueues;
}

const attachmentsOf = (a: unknown) => (Array.isArray(a) && a.length ? a.map(String) : undefined);

/** Dispatch UI → server WebSocket messages. Malformed messages are ignored. */
export function createClientMessageRouter({ hub, team, permissions, previews, notifications, queue }: RouterDeps): ClientMessageRouter {
  const fail = (botId: string) => (err: Error) => hub.emit({ type: AgentEventType.Error, botId, message: err.message });
  const guard = (botId: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      fail(botId)(err as Error);
    }
  };

  return (client, raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case ClientMessageType.Send:
        guard(msg.botId, () => team.submit(msg.botId, String(msg.text ?? ''), attachmentsOf(msg.attachments)));
        break;
      case ClientMessageType.Steer:
        guard(msg.botId, () => team.steer(msg.botId, String(msg.text ?? ''), attachmentsOf(msg.attachments)));
        break;
      case ClientMessageType.QueueEdit:
        guard(msg.botId, () => queue?.edit(msg.botId, String(msg.id), String(msg.text ?? '')));
        break;
      case ClientMessageType.QueueMove:
        queue?.move(msg.botId, String(msg.id), Number(msg.index) || 0);
        break;
      case ClientMessageType.QueueRemove:
        queue?.remove(msg.botId, String(msg.id));
        break;
      case ClientMessageType.QueueSendNow:
        team.sendNow(msg.botId, String(msg.id));
        break;
      case ClientMessageType.QueueResume:
        team.resume(msg.botId);
        break;
      case ClientMessageType.ResumeAtReset:
        team.setResumeAtReset(msg.botId, !!msg.on);
        break;
      case ClientMessageType.Stop:
        team.stop(msg.botId);
        break;
      case ClientMessageType.Permission:
        permissions.resolve(msg.requestId, msg.allow, msg.always);
        break;
      case ClientMessageType.Focus:
        hub.focus(client);
        break;
      case ClientMessageType.Presence:
        hub.setPresence(client, !!msg.active);
        break;
      case ClientMessageType.BrowserOpen:
        previews.open(msg.botId, msg.url).catch(fail(msg.botId));
        break;
      case ClientMessageType.BrowserClose:
        previews.close(msg.botId);
        break;
      case ClientMessageType.BrowserControl:
        previews.setControl(msg.botId, msg.on);
        break;
      case ClientMessageType.BridgeReady:
        previews.ready(msg.botId, msg.path, msg.title);
        break;
      case ClientMessageType.BridgeConsole:
        hub.console(msg.botId, msg.line);
        break;
      case ClientMessageType.BridgeResult:
        previews.result(msg.id, msg.ok, msg.result, msg.error);
        break;
      case ClientMessageType.Answer:
        if (typeof msg.answer === 'string' && msg.answer.trim()) notifications.answer(msg.notificationId, msg.answer.trim());
        break;
      case ClientMessageType.NotificationsRead:
        if (Array.isArray(msg.ids)) notifications.markRead(msg.ids);
        break;
    }
  };
}
