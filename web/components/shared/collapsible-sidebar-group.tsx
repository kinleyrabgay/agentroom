"use client"

import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePersistentFlag } from "@/hooks/use-persistent-flag"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { SidebarGroup, SidebarGroupLabel } from "@/components/ui/sidebar"

/**
 * A sidebar group whose label toggles its content (shadcn collapsible-group pattern).
 * Open state is remembered per browser under `agentroom-sidebar-<id>`.
 */
export function CollapsibleSidebarGroup({
  id,
  label,
  count,
  action,
  className,
  children,
}: {
  id: string
  label: string
  /** Shown after the label in muted text (e.g. number of bots). */
  count?: number
  /** Rendered next to the label (e.g. a SidebarGroupAction); stays visible when collapsed. */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = usePersistentFlag(`agentroom-sidebar-${id}`, true)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group/collapsible"
    >
      <SidebarGroup className={className}>
        <SidebarGroupLabel asChild>
          {/* Looks like the plain group labels; the chevron at the far right says it folds. */}
          <CollapsibleTrigger
            aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
            className={cn(
              "group/label w-full cursor-pointer gap-1.5 rounded-md outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              action && "pr-8"
            )}
          >
            <span>{label}</span>
            {count !== undefined && count > 0 && <span className="tabular-nums opacity-60">{count}</span>}
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "ml-auto size-3.5 opacity-50 transition-[transform,opacity] group-hover/label:opacity-100",
                open && "rotate-90"
              )}
            />
          </CollapsibleTrigger>
        </SidebarGroupLabel>
        {action}
        <CollapsibleContent>{children}</CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}
