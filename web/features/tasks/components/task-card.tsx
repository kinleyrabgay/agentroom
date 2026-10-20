"use client"

import { memo } from "react"
import {
  CircleAlertIcon,
  FileCodeIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react"
import { TaskStatus, type Task } from "@shared"
import { cn } from "@/lib/utils"
import { DragType, isBusy } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { KindBadge } from "./kind-badge"
import { ToneBadge } from "@/components/kit/badge"
import { RepoBadge } from "@/features/workspaces/components/repo-badge"

/** A task card. Click opens the detail sheet; drag moves/reorders. */
export const TaskCard = memo(function TaskCard({
  task,
  dropBefore,
  onHover,
}: {
  task: Task
  /** Show the insertion line above this card. */
  dropBefore: boolean
  /** Report where a dragged card would land relative to this one. */
  onHover: (taskId: string, after: boolean) => void
}) {
  const assignee = useAppStore((s) =>
    s.bots.find((b) => b.id === task.assignee)
  )
  const status = useAppStore((s) =>
    task.assignee ? s.statuses[task.assignee] : undefined
  )
  const openTask = useAppStore((s) => s.openTask)
  const selected = useAppStore((s) => s.selectedTaskId === task.id)

  const live = task.status === TaskStatus.Doing && isBusy(status?.status)
  const checked = task.acceptance.filter((a) => a.done).length
  const total = task.acceptance.length

  return (
    <div className="relative">
      {dropBefore && (
        <div className="absolute -top-1.5 right-1 left-1 h-0.5 rounded-full bg-brand" />
      )}
      <div
        role="button"
        tabIndex={0}
        aria-label={`${task.id}: ${task.title}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DragType.Task, task.id)
          e.dataTransfer.effectAllowed = "move"
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DragType.Task)) return
          const r = e.currentTarget.getBoundingClientRect()
          onHover(task.id, e.clientY > r.top + r.height / 2)
        }}
        onClick={() => openTask(task.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            openTask(task.id)
          }
        }}
        style={assignee ? { ["--bot" as string]: assignee.color } : undefined}
        className={cn(
          "group cursor-pointer space-y-2.5 rounded-xl border bg-card p-3 text-sm shadow-xs transition-[border-color,box-shadow] outline-none hover:border-foreground/15 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 active:cursor-grabbing",
          selected && "border-brand/50 ring-2 ring-brand/20",
          live &&
            "ring-2 ring-[color-mix(in_oklch,var(--bot)_45%,transparent)]",
          task.status === TaskStatus.Done && "opacity-75"
        )}
      >
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs text-muted-foreground">
            {task.id}
          </span>
          <KindBadge kind={task.kind} />
          <RepoBadge task={task} />
          {task.blockedReason && (
            <ToneBadge tone="warning" icon={CircleAlertIcon} size="sm">
              Blocked
            </ToneBadge>
          )}
          <span className="ml-auto">
            {assignee && (
              <BotAvatar bot={assignee} className="size-6 rounded-md text-xs" />
            )}
          </span>
        </div>

        <p
          className={cn(
            "line-clamp-2 leading-snug font-medium",
            task.status === TaskStatus.Done &&
              "line-through decoration-muted-foreground/50"
          )}
        >
          {task.title}
        </p>

        {live && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon
              className="size-3.5 shrink-0 animate-spin"
              style={{ color: assignee?.color }}
            />
            <span className="truncate">
              {status?.activity ?? `${assignee?.name} is working on this`}
            </span>
          </div>
        )}

        {(total > 0 || task.files.length > 0 || task.dependsOn.length > 0) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {total > 0 && (
              <span
                className="flex items-center gap-1.5"
                title={`${checked} of ${total} acceptance criteria met`}
              >
                <ListChecksIcon className="size-3.5" />
                <span className="tabular-nums">
                  {checked}/{total}
                </span>
                <span className="h-1 w-10 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-success"
                    style={{ width: `${(checked / total) * 100}%` }}
                  />
                </span>
              </span>
            )}
            {task.files.length > 0 && (
              <span
                className="flex items-center gap-1"
                title={task.files.join("\n")}
              >
                <FileCodeIcon className="size-3.5" /> {task.files.length}
              </span>
            )}
            {task.dependsOn.slice(0, 2).map((d) => (
              <span
                key={d}
                className="rounded-md border px-1.5 font-mono text-xs"
              >
                after {d}
              </span>
            ))}
            {task.dependsOn.length > 2 && (
              <span>+{task.dependsOn.length - 2}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
})
