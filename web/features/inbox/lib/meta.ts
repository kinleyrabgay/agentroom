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
import type { Tone } from "@/components/kit/tone"

/** Icon, tone and primary action label per notification kind. */
export const NOTIFICATION_META: Record<
  NotificationKind,
  { icon: LucideIcon; tone: Tone; action?: string }
> = {
  [NotificationKind.PlanReady]: {
    icon: ClipboardCheckIcon,
    tone: "warning",
    action: "Review plan",
  },
  [NotificationKind.Question]: {
    icon: MessageCircleQuestionIcon,
    tone: "info",
    action: "Answer",
  },
  [NotificationKind.Blocked]: {
    icon: CircleAlertIcon,
    tone: "warning",
    action: "Open task",
  },
  [NotificationKind.Security]: {
    icon: ShieldAlertIcon,
    tone: "danger",
    action: "Review",
  },
  [NotificationKind.GoalDone]: {
    icon: CircleCheckIcon,
    tone: "success",
    action: "View report",
  },
  [NotificationKind.GoalFailed]: {
    icon: OctagonXIcon,
    tone: "danger",
    action: "Open goal",
  },
  [NotificationKind.Info]: { icon: BellIcon, tone: "neutral" },
}
