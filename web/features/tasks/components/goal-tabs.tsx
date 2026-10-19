"use client"

import { ListChecksIcon, ShieldIcon, type LucideIcon } from "lucide-react"
import { GoalTab } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
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
  { id: GoalTab.Security, label: "Security", icon: ShieldIcon },
]

export function GoalTabs({ goalId }: { goalId: string }) {
  const tab = useAppStore((s) => s.goalTab)
  const setTab = useAppStore((s) => s.setGoalTab)
  const counts = useFindingCounts(goalId)
  const open = counts.openCritical + counts.openWarning

  const badge = (id: GoalTab) =>
    id === GoalTab.Security && open > 0 ? (
      <span
        className={cn(
          "rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
          counts.openCritical ? "bg-red-500/15 text-red-700 dark:text-red-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
        )}
        title={counts.openCritical ? `${counts.openCritical} open critical` : `${counts.openWarning} open warnings`}
      >
        {open}
      </span>
    ) : null

  return (
    <div role="tablist" aria-label="Goal sections" className="flex items-center gap-1 border-b">
      {GOAL_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={tab === id}
          onClick={() => setTab(id)}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-1.5 text-sm transition-colors",
            tab === id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Icon className="size-3.5" /> {label} {badge(id)}
        </button>
      ))}
    </div>
  )
}
