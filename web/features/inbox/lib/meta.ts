import {
  BellIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  MessageCircleQuestionIcon,
  OctagonXIcon,
  ShieldAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { NotificationKind } from "@shared"

/** Icon, tone and primary action label per notification kind. */
export const NOTIFICATION_META: Record<
  NotificationKind,
  { icon: LucideIcon; tone: string; action?: string }
> = {
  [NotificationKind.PlanReady]: {
    icon: ClipboardCheckIcon,
    tone: "text-amber-600 dark:text-amber-300",
    action: "Review plan",
  },
  [NotificationKind.Question]: {
    icon: MessageCircleQuestionIcon,
    tone: "text-sky-600 dark:text-sky-300",
    action: "Answer",
  },
  [NotificationKind.Blocked]: {
    icon: CircleAlertIcon,
    tone: "text-amber-600 dark:text-amber-300",
    action: "Open task",
  },
  [NotificationKind.Security]: {
    icon: ShieldAlertIcon,
    tone: "text-red-600 dark:text-red-300",
    action: "Review",
  },
  [NotificationKind.GoalDone]: {
    icon: CircleCheckIcon,
    tone: "text-emerald-600 dark:text-emerald-300",
    action: "View report",
  },
  [NotificationKind.GoalFailed]: {
    icon: OctagonXIcon,
    tone: "text-destructive",
    action: "Open goal",
  },
  [NotificationKind.Info]: { icon: BellIcon, tone: "text-muted-foreground" },
}
