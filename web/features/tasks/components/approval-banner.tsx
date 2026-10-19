"use client"

import { useState } from "react"
import {
  ClipboardCheckIcon,
  MessageSquareDiffIcon,
  RocketIcon,
} from "lucide-react"
import { toast } from "sonner"
import type { Goal } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { RequestChangesDialog } from "./request-changes-dialog"

/** Shown while a plan waits for the human: review, edit, then approve. */
export function ApprovalBanner({
  goal,
  taskCount,
}: {
  goal: Goal
  taskCount: number
}) {
  const [changes, setChanges] = useState(false)
  const [busy, setBusy] = useState(false)

  const approve = async () => {
    setBusy(true)
    try {
      await goalApi.approve(goal.id)
      toast.success("Plan approved", {
        description: "The Developer is starting on the first task.",
      })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 backdrop-blur">
      <ClipboardCheckIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-300" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          Review the plan, edit anything, then approve
        </div>
        <div className="text-xs text-muted-foreground">
          {taskCount} {taskCount === 1 ? "task" : "tasks"} planned. Click a card
          to change its details. Nothing is built until you approve.
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => setChanges(true)}>
        <MessageSquareDiffIcon data-icon="inline-start" /> Request changes
      </Button>
      <Button size="sm" onClick={approve} disabled={busy || taskCount === 0}>
        <RocketIcon data-icon="inline-start" /> Approve plan &amp; start
        building
      </Button>
      <RequestChangesDialog
        goal={goal}
        open={changes}
        onOpenChange={setChanges}
      />
    </div>
  )
}
