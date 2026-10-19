"use client"

import { useState } from "react"
import {
  ChevronRightIcon,
  FileTextIcon,
  PencilIcon,
  ScrollTextIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Goal } from "@shared"
import { cn } from "@/lib/utils"
import { goalApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Textarea } from "@/components/ui/textarea"
import { Markdown } from "@/components/shared/markdown"

function Section({
  icon: Icon,
  title,
  defaultOpen,
  aside,
  children,
}: {
  icon: typeof FileTextIcon
  title: string
  defaultOpen?: boolean
  aside?: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border bg-muted/20"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2 text-left text-sm font-medium">
          <ChevronRightIcon
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-90"
            )}
          />
          <Icon className="size-3.5 text-muted-foreground" />
          {title}
        </CollapsibleTrigger>
        {open && aside}
      </div>
      <CollapsibleContent className="border-t px-4 py-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The Planner's approach, editable by the human. */
export function PlanSection({ goal }: { goal: Goal }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(goal.plan)

  const save = async () => {
    try {
      await goalApi.update(goal.id, { plan: draft })
      setEditing(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Section
      icon={FileTextIcon}
      title="Plan"
      aside={
        !editing && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setDraft(goal.plan)
              setEditing(true)
            }}
          >
            <PencilIcon data-icon="inline-start" /> Edit
          </Button>
        )
      }
    >
      {editing ? (
        <div className="grid gap-2">
          <Textarea
            rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="font-mono text-xs leading-relaxed"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save plan
            </Button>
          </div>
        </div>
      ) : goal.plan ? (
        <Markdown text={goal.plan} />
      ) : (
        <p className="text-xs text-muted-foreground">
          The Planner hasn&apos;t written an overview yet.
        </p>
      )}
    </Section>
  )
}

export function ReportSection({ goal }: { goal: Goal }) {
  if (!goal.summary) return null
  return (
    <Section icon={ScrollTextIcon} title="Team Lead's report" defaultOpen>
      <Markdown text={goal.summary} />
    </Section>
  )
}
