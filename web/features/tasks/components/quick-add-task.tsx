"use client"

import { useState } from "react"
import { PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { taskApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** Add a task to the current goal (or as a standalone task) and open it for details. */
export function QuickAddTask({
  goalId,
  nextOrder,
}: {
  goalId?: string
  nextOrder: number
}) {
  const openTask = useAppStore((s) => s.openTask)
  const [title, setTitle] = useState("")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const task = await taskApi.create({
        title: title.trim(),
        goalId,
        order: nextOrder,
      })
      setTitle("")
      openTask(task.id)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-1 gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Add a task…"
        className="h-8"
      />
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={!title.trim()}
      >
        <PlusIcon data-icon="inline-start" /> Add
      </Button>
    </form>
  )
}
