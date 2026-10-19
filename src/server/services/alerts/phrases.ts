import { NotificationKind } from '../../../shared/enums.js';
import type { Notification } from '../../../shared/types/index.js';
import { plainText } from '../../../shared/text.js';

export { plainText };


/** Short spoken line, e.g. "Planner: plan ready for review". */
export function spokenLine(n: Pick<Notification, 'kind' | 'title'>, botName: string | undefined): string {
  const who = botName ?? 'AgentRoom';
  switch (n.kind) {
    case NotificationKind.PlanReady:
      return `${who}: plan ready for review`;
    case NotificationKind.Question:
      return `${who} has a question for you`;
    case NotificationKind.Blocked:
      return `${who} is blocked and needs you`;
    case NotificationKind.GoalDone:
      return `${who}: goal done`;
    case NotificationKind.GoalFailed:
      return `${who}: goal failed`;
    default:
      return `${who}: ${plainText(n.title, 60)}`;
  }
}
