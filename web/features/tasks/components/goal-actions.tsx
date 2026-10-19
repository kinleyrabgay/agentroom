"use client"

import { useState } from "react"
import {
  PauseIcon,
  PlayIcon,
  MessageSquareDiffIcon,
  OctagonXIcon,
} from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, type Goal } from "@shared"
import { goalApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { isFinished, isRunning } from "../lib/goal-phase"
import { RequestChangesDialog } from "./request-changes-dialog"

const run = (p: Promise<unknown>) =>
  p.catch((e: Error) => toast.error(e.message))

/** Actions that make sense for the goal's current status (approval itself lives in the banner). */
export function GoalActions({ goal }: { goal: Goal }) {
  const selectGoal = useAppStore((s) => s.selectGoal)
  const [changes, setChanges] = useState(false)

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {goal.status === GoalStatus.Paused && (
        <Button size="sm" onClick={() => run(goalApi.resume(goal.id))}>
          <PlayIcon data-icon="inline-start" /> Resume
        </Button>
      )}
      {goal.status === GoalStatus.Paused && (
        <Button size="sm" variant="outline" onClick={() => setChanges(true)}>
          <MessageSquareDiffIcon data-icon="inline-start" /> Request changes
        </Button>
      )}
      {isRunning(goal.status) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => run(goalApi.pause(goal.id))}
        >
          <PauseIcon data-icon="inline-start" /> Pause
        </Button>
      )}
      {!isFinished(goal.status) && <CancelGoal goal={goal} />}
      {isFinished(goal.status) && goal.status !== GoalStatus.Done && (
        <ConfirmDelete
          title={`Delete ${goal.id}?`}
          description="Removes the goal and all of its tasks."
          label="Delete goal"
          onConfirm={async () => {
            await run(goalApi.remove(goal.id))
            selectGoal(null)
          }}
        />
      )}
      <RequestChangesDialog
        goal={goal}
        open={changes}
        onOpenChange={setChanges}
      />
    </div>
  )
}

function CancelGoal({ goal }: { goal: Goal }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground">
          <OctagonXIcon data-icon="inline-start" /> Cancel
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {goal.id}?</AlertDialogTitle>
          <AlertDialogDescription>
            Any bot working on it is stopped. Its tasks stay, and
            changes already made to the code are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep going</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => run(goalApi.cancel(goal.id))}
          >
            Cancel goal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
