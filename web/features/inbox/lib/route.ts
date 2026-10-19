import { NotificationKind, type Notification } from "@shared"
import { BotTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** Take the human to whatever a notification is about. */
export function openNotificationTarget(n: Notification) {
  const { showOnTasks, select, showSecurity } = useAppStore.getState()
  switch (n.kind) {
    case NotificationKind.Question:
      if (n.botId) select(n.botId, BotTab.Chat)
      return
    case NotificationKind.PlanReady:
    case NotificationKind.GoalDone:
    case NotificationKind.GoalFailed:
      if (n.goalId) showOnTasks({ goalId: n.goalId })
      return
    case NotificationKind.Security:
      showSecurity(n.goalId)
      return
    case NotificationKind.Blocked:
      showOnTasks({ goalId: n.goalId, taskId: n.taskId })
      return
    default:
      if (n.taskId || n.goalId)
        showOnTasks({ goalId: n.goalId, taskId: n.taskId })
      else if (n.botId) select(n.botId, BotTab.Chat)
  }
}

export const needsAnswer = (n: Notification) =>
  n.kind === NotificationKind.Question && !n.answer
