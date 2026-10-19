"use client"

import { useState } from "react"
import { ClipboardCheckIcon, MessageSquareDiffIcon, RocketIcon } from "lucide-react"
import { toast } from "sonner"
import type { Goal } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/kit/callout"
import { RequestChangesDialog } from "./request-changes-dialog"

/** Shown while a plan waits for the human: review, edit, then approve. */
export function ApprovalBanner({ goal, taskCount }: { goal: Goal; taskCount: number }) {
  const [changes, setChanges] = useState(false)
  const [busy, setBusy] = useState(false)

  const approve = async () => {
    setBusy(true)
    try {
      await goalApi.approve(goal.id)
      toast.success("Plan approved", { description: "The Developer is starting on the first task." })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Callout
        tone="warning"
        icon={ClipboardCheckIcon}
        title="Review the plan, edit anything, then approve"
        action={
          <>
            <Button variant="outline" size="sm" className="bg-surface" onClick={() => setChanges(true)}>
              <MessageSquareDiffIcon data-icon="inline-start" /> Request changes
            </Button>
            <Button size="sm" onClick={approve} disabled={busy || taskCount === 0}>
              <RocketIcon data-icon="inline-start" /> Approve and build
            </Button>
          </>
        }
      >
        {taskCount} {taskCount === 1 ? "task" : "tasks"} planned. Open a card to change its details. Nothing is built until you approve.
      </Callout>
      <RequestChangesDialog goal={goal} open={changes} onOpenChange={setChanges} />
    </>
  )
}
