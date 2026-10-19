"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import type { Task, TaskStatus } from "@shared"
import { cn } from "@/lib/utils"
import { DragType } from "@/lib/constants"
import { taskApi } from "@/lib/api/endpoints"
import { orderForDrop } from "../lib/reorder"
import { TaskCard } from "./task-card"

/** Kanban column. Dropping a card moves it here, at the position under the cursor. */
export function TaskColumn({
  status,
  label,
  hint,
  dot,
  tasks,
}: {
  status: TaskStatus
  label: string
  hint?: string
  dot: string
  tasks: Task[]
}) {
  const [over, setOver] = useState(false)
  /** Card id the dragged card would be inserted before; null = end of column. */
  const [before, setBefore] = useState<string | null>(null)

  const onHover = useCallback(
    (id: string, after: boolean) => {
      const i = tasks.findIndex((t) => t.id === id)
      setBefore(after ? (tasks[i + 1]?.id ?? null) : id)
    },
    [tasks]
  )

  const reset = () => {
    setOver(false)
    setBefore(null)
  }

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DragType.Task)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        if (!over) setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) reset()
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DragType.Task)
        const target = before
        reset()
        if (!id || target === id) return
        taskApi
          .update(id, { status, order: orderForDrop(tasks, id, target) })
          .catch((err: Error) => toast.error(err.message))
      }}
      className={cn(
        "flex min-h-0 min-w-64 flex-col rounded-2xl bg-muted/40 transition-colors",
        over && "bg-muted/70 ring-2 ring-primary/20"
      )}
    >
      <div className="flex items-baseline gap-2 px-3 pt-3 pb-2">
        <span
          className={cn(
            "size-2 shrink-0 translate-y-[-1px] self-center rounded-full",
            dot
          )}
        />
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {tasks.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            dropBefore={over && before === t.id}
            onHover={onHover}
          />
        ))}
        {over && before === null && tasks.length > 0 && (
          <div className="mx-1 h-0.5 rounded-full bg-primary" />
        )}
        {!tasks.length && (
          <div
            className={cn(
              "grid h-20 place-items-center rounded-xl border border-dashed text-xs text-muted-foreground",
              over && "border-primary/50"
            )}
          >
            {over ? "Drop here" : "Nothing here"}
          </div>
        )}
      </div>
    </div>
  )
}
