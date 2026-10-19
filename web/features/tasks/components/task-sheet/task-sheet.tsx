"use client"

import { useEffect, useMemo, useState } from "react"
import {
  CheckIcon,
  CircleAlertIcon,
  CloudUploadIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { TaskKind, TaskStatus, type Task } from "@shared"
import { taskApi, type TaskUpdate } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { KIND_META, STATUS_LABEL, UNASSIGNED } from "../../constants"
import { byOrder } from "../../lib/goal-phase"
import { SaveState, useAutosave } from "../../hooks/use-autosave"
import { KindBadge } from "../kind-badge"
import { AcceptanceEditor } from "./acceptance-editor"
import { DependsOnPicker } from "./depends-on-picker"
import { DescriptionEditor } from "./description-editor"
import { FilesEditor } from "./files-editor"
import { TaskLog } from "./task-log"

/** Right-side detail editor for the selected task. Every change autosaves. */
export function TaskSheet() {
  const taskId = useAppStore((s) => s.selectedTaskId)
  const task = useAppStore((s) =>
    s.tasks.find((t) => t.id === s.selectedTaskId)
  )
  const openTask = useAppStore((s) => s.openTask)

  // Close if the task disappears (deleted elsewhere).
  useEffect(() => {
    if (taskId && !task) openTask(null)
  }, [taskId, task, openTask])

  return (
    <Sheet open={!!task} onOpenChange={(open) => !open && openTask(null)}>
      <SheetContent className="w-full gap-0 sm:max-w-[520px]">
        {task && <TaskEditor key={task.id} task={task} />}
      </SheetContent>
    </Sheet>
  )
}

type Overrides = Partial<Record<keyof Task, unknown>>

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

function TaskEditor({ task }: { task: Task }) {
  const bots = useAppStore((s) => s.bots)
  const siblings = useAppStore((s) => s.tasks)
  const openTask = useAppStore((s) => s.openTask)
  const { state, queue, flush } = useAutosave<TaskUpdate>((patch) =>
    taskApi.update(task.id, patch)
  )

  // Local edits shown immediately; each is dropped once the server echoes the same value.
  const [over, setOver] = useState<Overrides>({})
  // Adjust state when the task prop changes (React's "storing info from previous renders" pattern).
  const [seen, setSeen] = useState(task)
  if (task !== seen) {
    setSeen(task)
    const kept = Object.fromEntries(
      Object.entries(over).filter(([k, v]) => !same(task[k as keyof Task], v))
    )
    if (Object.keys(kept).length !== Object.keys(over).length) setOver(kept)
  }

  const view = { ...task, ...over } as Task
  const change = <K extends keyof TaskUpdate>(key: K, value: TaskUpdate[K]) => {
    setOver((o) => ({ ...o, [key]: value }))
    queue({ [key]: value } as Partial<TaskUpdate>)
  }

  const candidates = useMemo(
    () =>
      siblings
        .filter((t) => t.id !== task.id && t.goalId === task.goalId)
        .sort(byOrder),
    [siblings, task.id, task.goalId]
  )

  return (
    <>
      <SheetHeader className="gap-2 border-b pr-14">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            {task.id}
          </span>
          <KindBadge kind={view.kind} />
          {task.goalId && (
            <span className="text-xs text-muted-foreground">
              in {task.goalId}
            </span>
          )}
          <SaveIndicator state={state} />
        </div>
        <SheetTitle className="sr-only">{view.title}</SheetTitle>
        <SheetDescription className="sr-only">
          Edit task details. Changes save automatically.
        </SheetDescription>
        <textarea
          value={view.title}
          rows={1}
          onChange={(e) => change("title", e.target.value)}
          aria-label="Title"
          className="field-sizing-content resize-none rounded-md bg-transparent text-lg leading-snug font-semibold outline-none focus:bg-muted/40"
        />
      </SheetHeader>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {view.blockedReason && (
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <TriangleAlertIcon className="text-amber-600 dark:text-amber-300" />
            <AlertTitle>Blocked</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="whitespace-pre-wrap">{view.blockedReason}</p>
              <Button
                size="xs"
                variant="outline"
                onClick={() => change("blockedReason", null)}
              >
                <CheckIcon data-icon="inline-start" /> Mark unblocked
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Select
              value={view.status}
              onValueChange={(v) => change("status", v as TaskStatus)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TaskStatus).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Kind">
            <Select
              value={view.kind}
              onValueChange={(v) => change("kind", v as TaskKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(TaskKind).map((k) => {
                  const Icon = KIND_META[k].icon
                  return (
                    <SelectItem key={k} value={k}>
                      <Icon className="size-3.5" /> {KIND_META[k].label}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assignee">
            <Select
              value={view.assignee ?? UNASSIGNED}
              onValueChange={(v) =>
                change("assignee", v === UNASSIGNED ? null : v)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {bots.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.avatar} {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Order" hint="Lower runs first">
            <Input
              type="number"
              value={view.order}
              onChange={(e) =>
                e.target.value !== "" && change("order", Number(e.target.value))
              }
              className="tabular-nums"
            />
          </Field>
        </div>

        <Field label="Description">
          <DescriptionEditor
            value={view.description}
            onChange={(v) => change("description", v)}
          />
        </Field>

        <Field
          label="Acceptance criteria"
          hint={
            view.acceptance.length
              ? `${view.acceptance.filter((a) => a.done).length}/${view.acceptance.length} met`
              : undefined
          }
        >
          <AcceptanceEditor
            items={view.acceptance}
            onChange={(v) => change("acceptance", v)}
          />
        </Field>

        <Field label="Files">
          <FilesEditor
            files={view.files}
            onChange={(v) => change("files", v)}
          />
        </Field>

        <Field label="Depends on">
          <DependsOnPicker
            value={view.dependsOn}
            candidates={candidates}
            onChange={(v) => change("dependsOn", v)}
          />
        </Field>

        {task.notes && (
          <Field label="Notes">
            <p className="rounded-xl border bg-muted/20 p-3 text-xs whitespace-pre-wrap text-muted-foreground">
              {task.notes}
            </p>
          </Field>
        )}

        <Separator />

        <Field label="Activity">
          <TaskLog entries={task.log} />
        </Field>
      </div>

      <div className="flex items-center gap-2 border-t p-3">
        <ConfirmDelete
          title={`Delete ${task.id}?`}
          description="The task is deleted. Tasks that depend on it lose that dependency."
          onConfirm={async () => {
            openTask(null)
            await taskApi.remove(task.id)
          }}
        />
        <span className="ml-auto text-[11px] text-muted-foreground">
          by {bots.find((b) => b.id === task.createdBy)?.name ?? task.createdBy}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => flush().then(() => openTask(null))}
        >
          Done
        </Button>
      </div>
    </>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {hint && (
          <span className="text-[11px] text-muted-foreground">{hint}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === SaveState.Idle) return null
  const content = {
    [SaveState.Saving]: (
      <>
        <CloudUploadIcon className="size-3 animate-pulse" /> Saving…
      </>
    ),
    [SaveState.Saved]: (
      <>
        <CheckIcon className="size-3" /> Saved
      </>
    ),
    [SaveState.Error]: (
      <>
        <CircleAlertIcon className="size-3" /> Not saved
      </>
    ),
  }[state]
  return (
    <span
      className={`ml-auto flex items-center gap-1 text-[11px] ${state === SaveState.Error ? "text-destructive" : "text-muted-foreground"}`}
      aria-live="polite"
    >
      {content}
    </span>
  )
}
