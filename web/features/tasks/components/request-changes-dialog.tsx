"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { Goal } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

/** Send the plan back to the Planner with feedback. */
export function RequestChangesDialog({
  goal,
  open,
  onOpenChange,
}: {
  goal: Goal
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [feedback, setFeedback] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!feedback.trim()) return
    setBusy(true)
    try {
      await goalApi.replan(goal.id, feedback.trim())
      setFeedback("")
      onOpenChange(false)
      toast.success("Sent back to the Planner")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Request changes</DialogTitle>
            <DialogDescription>
              Tell the Planner what to change. It revises the tasks, then the
              plan comes back for your review.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Split T-3 into backend and UI tasks, and add a QA task for mobile…"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!feedback.trim() || busy}>
              Send to Planner
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
