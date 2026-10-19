"use client"

import { ChevronDownIcon } from "lucide-react"
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
  action,
  className,
  children,
}: {
  id: string
  label: string
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
          <CollapsibleTrigger
            className={cn(
              "w-full cursor-pointer gap-1 rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
              action && "pr-8"
            )}
          >
            {label}
            <ChevronDownIcon
              className={cn(
                "size-3.5 transition-transform",
                !open && "-rotate-90"
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
