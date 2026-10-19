"use client"

import { FileDiffIcon, HistoryIcon, ListChecksIcon, ShieldIcon, type LucideIcon } from "lucide-react"
import { GoalTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { Segmented } from "@/components/kit/segmented"
import { TONE_CLASS } from "@/components/kit/tone"
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
  { id: GoalTab.Timeline, label: "Timeline", icon: HistoryIcon },
]

export function GoalTabs({ goalId }: { goalId: string }) {
  const tab = useAppStore((s) => s.goalTab)
  const setTab = useAppStore((s) => s.setGoalTab)
  const counts = useFindingCounts(goalId)
  const open = counts.openCritical + counts.openWarning

  return (
    <Segmented<GoalTab>
      aria-label="Goal sections"
      value={tab}
      onChange={setTab}
      options={GOAL_TABS.map(({ id, label, icon: Icon }) => ({
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
          </>
        ),
      }))}
    />
  )
}
