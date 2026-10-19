"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckIcon, CircleAlertIcon, CloudUploadIcon, XIcon } from "lucide-react"
import { TaskKind, TaskStatus, type Task } from "@shared"
import { taskApi, type TaskUpdate } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
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

/** The selected task, in the Inspector. Every change autosaves. */
export function TaskInspector() {
  const taskId = useAppStore((s) => s.selectedTaskId)
  const task = useAppStore((s) => s.tasks.find((t) => t.id === s.selectedTaskId))
  const openTask = useAppStore((s) => s.openTask)

  // Close if the task disappears (deleted elsewhere).
  useEffect(() => {
    if (taskId && !task) openTask(null)
  }, [taskId, task, openTask])

  return task ? <TaskEditor key={task.id} task={task} /> : null
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
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 pt-3 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{task.id}</span>
          <KindBadge kind={view.kind} />
          {task.goalId && <span className="text-xs text-muted-foreground">in {task.goalId}</span>}
          <SaveIndicator state={state} />
          <Button
            variant="ghost"
            size="icon-sm"
            className={state === SaveState.Idle ? "ml-auto" : undefined}
            onClick={() => flush().then(() => openTask(null))}
            aria-label={`Close ${task.id}`}
          >
            <XIcon />
          </Button>
        </div>
        <textarea
          value={view.title}
          rows={1}
          onChange={(e) => change("title", e.target.value)}
          aria-label="Title"
          className="-mx-1.5 field-sizing-content w-[calc(100%+0.75rem)] resize-none rounded-lg bg-transparent px-1.5 text-lg leading-snug font-semibold tracking-tight outline-none hover:bg-accent/50 focus:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {view.blockedReason && (
          <Callout
            tone="warning"
            title="Blocked"
            action={
              <Button size="sm" variant="outline" className="bg-surface" onClick={() => change("blockedReason", null)}>
                <CheckIcon data-icon="inline-start" /> Mark unblocked
              </Button>
            }
          >
            <p className="whitespace-pre-wrap">{view.blockedReason}</p>
          </Callout>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <Dropdown<TaskStatus>
              datas={Object.values(TaskStatus).map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
              selectedValue={view.status}
              showSearch={false}
              onSelect={(v) => change("status", v as TaskStatus)}
            />
          </Field>
          <Field label="Kind">
            <Dropdown<TaskKind>
              datas={Object.values(TaskKind).map((k) => ({ value: k, label: KIND_META[k].label }))}
              selectedValue={view.kind}
              showSearch={false}
              onSelect={(v) => change("kind", v as TaskKind)}
            />
          </Field>
          <Field label="Assignee">
            <Dropdown<string>
              datas={[{ value: UNASSIGNED, label: "Unassigned" }, ...bots.map((b) => ({ value: b.id, label: b.name, sublabel: b.role }))]}
              selectedValue={view.assignee ?? UNASSIGNED}
              hint="Find a bot"
              onSelect={(v) => change("assignee", v === UNASSIGNED ? null : (v as string))}
            />
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
            <p className="rounded-xl border bg-sunken p-3 text-sm whitespace-pre-wrap text-muted-foreground">
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
        <span className="ml-auto text-xs text-muted-foreground">
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
    </div>
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
          <span className="text-xs text-muted-foreground">{hint}</span>
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
      className={`ml-auto flex items-center gap-1 text-xs ${state === SaveState.Error ? "text-danger-ink" : "text-muted-foreground"}`}
      aria-live="polite"
    >
      {content}
    </span>
  )
}
