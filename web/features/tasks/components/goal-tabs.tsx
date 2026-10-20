"use client"

import { ClapperboardIcon, FileDiffIcon, HistoryIcon, ListChecksIcon, MessagesSquareIcon, ShieldIcon, type LucideIcon } from "lucide-react"
import { useRoomStore } from "@/features/room/lib/room-store"
import { useUnreadDiscussion } from "@/features/room/components/goal-discussion"
import { GoalTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Segmented } from "@/components/kit/segmented"
import { TONE_CLASS } from "@/components/kit/tone"
import { ToneDot } from "@/components/kit/badge"
import { cn } from "@/lib/utils"
import { useFindingCounts } from "@/features/security/hooks/use-finding-counts"

interface TabDef {
  id: GoalTab
  label: string
  icon: LucideIcon
}

/** Tabs under a goal's header. Add a tab here (and a panel in TaskBoard) to extend the goal page. */
export const GOAL_TABS: TabDef[] = [
  { id: GoalTab.Tasks, label: "Tasks", icon: ListChecksIcon },
  { id: GoalTab.Changes, label: "Changes", icon: FileDiffIcon },
  { id: GoalTab.Security, label: "Security", icon: ShieldIcon },
  { id: GoalTab.Proof, label: "Proof", icon: ClapperboardIcon },
  { id: GoalTab.Timeline, label: "Timeline", icon: HistoryIcon },
  { id: GoalTab.Discussion, label: "Discussion", icon: MessagesSquareIcon },
]

export function GoalTabs({ goalId }: { goalId: string }) {
  const tab = useAppStore((s) => s.goalTab)
  const setTab = useAppStore((s) => s.setGoalTab)
  const counts = useFindingCounts(goalId)
  const open = counts.openCritical + counts.openWarning
  const goal = useAppStore((s) => s.goals.find((g) => g.id === goalId))
  // Discussion: only once the team room is in use (or this goal already has comments).
  const roomOn = useRoomStore((s) => !!s.me?.roomEnabled || (s.comments[goalId]?.length ?? 0) > 0)
  const unreadComments = useUnreadDiscussion(goalId)
  const proofAlert = !!goal?.proof && (goal.proof.status === "failed" || (goal.proof.failing.length > 0 && goal.proofOverride?.round !== goal.round))

  return (
    <Segmented<GoalTab>
      aria-label="Goal sections"
      value={tab}
      onChange={setTab}
      options={GOAL_TABS.filter((t) => t.id !== GoalTab.Discussion || roomOn).map(({ id, label, icon: Icon }) => ({
        value: id,
        label: (
          <>
            <Icon className="size-3.5" /> {label}
            {id === GoalTab.Security && open > 0 && (
              <span
                className={cn(TONE_CLASS[counts.openCritical ? "danger" : "warning"], "tone-soft rounded-full border px-1.5 text-xs tabular-nums")}
                aria-label={counts.openCritical ? `${counts.openCritical} open critical` : `${counts.openWarning} open warnings`}
              >
                {open}
              </span>
            )}
            {id === GoalTab.Proof && proofAlert && <ToneDot tone="danger" className="ml-0.5" />}
            {id === GoalTab.Discussion && unreadComments > 0 && (
              <span className={cn(TONE_CLASS.brand, "tone-soft rounded-full border px-1.5 text-xs tabular-nums")} aria-label={`${unreadComments} new comments for you`}>
                {unreadComments}
              </span>
            )}
          </>
        ),
      }))}
    />
  )
}
