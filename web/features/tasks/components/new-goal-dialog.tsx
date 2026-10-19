"use client"

import { useState } from "react"
import { RocketIcon } from "lucide-react"
import { SecurityReviewMode } from "@shared"
import { ReviewModeSelect } from "@/features/security/components/review-mode-select"
import { REVIEW_MODE_META } from "@/features/security/constants"
import { toast } from "sonner"
import { goalApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** Start a goal run: the Planner breaks the brief into tasks for the human to review. */
export function NewGoalDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const [brief, setBrief] = useState("")
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  // Starts from the team default in Settings → Security.
  const teamDefault = useAppStore((s) => s.settings?.security.review) ?? SecurityReviewMode.Auto
  const [review, setReview] = useState<SecurityReviewMode | null>(null)
  const reviewMode = review ?? teamDefault

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!brief.trim()) return
    setBusy(true)
    try {
      const goal = await goalApi.create(brief.trim(), title.trim() || undefined, reviewMode)
      showOnTasks({ goalId: goal.id })
      setBrief("")
      setTitle("")
      setReview(null)
      onOpenChange(false)
      toast.success(`${goal.id} started`, {
        description: "The Planner is breaking it into tasks.",
      })
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
            <DialogTitle>New goal</DialogTitle>
            <DialogDescription>
              Describe the outcome you want. The Planner turns it into tasks;
              you review and approve them before anything is built.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="goal-brief">What should the team do?</Label>
            <Textarea
              id="goal-brief"
              autoFocus
              rows={6}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(e)
              }}
              placeholder="Add a dark mode toggle to the settings page, persisted per user…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-title">
              Title{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="goal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Generated from the brief if empty"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="goal-security">Security review</Label>
            <ReviewModeSelect id="goal-security" size="default" value={reviewMode} onChange={setReview} className="w-full" />
            <p className="text-xs text-muted-foreground">{REVIEW_MODE_META[reviewMode].description}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!brief.trim() || busy}>
              <RocketIcon data-icon="inline-start" /> Start planning
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
