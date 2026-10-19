"use client"

import { useState } from "react"
import { CheckIcon, ChevronsUpDownIcon, XIcon } from "lucide-react"
import type { Task } from "@shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/** Pick which tasks must be finished first. */
export function DependsOnPicker({
  value,
  candidates,
  onChange,
}: {
  value: string[]
  candidates: Task[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (id: string) =>
    onChange(
      value.includes(id) ? value.filter((v) => v !== id) : [...value, id]
    )
  const byId = new Map(candidates.map((t) => [t.id, t]))

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => (
            <span
              key={id}
              className="flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-xs"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {id}
              </span>
              <span className="truncate">
                {byId.get(id)?.title ?? "(removed)"}
              </span>
              <button
                onClick={() => toggle(id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${id}`}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between font-normal text-muted-foreground"
          >
            {value.length ? "Change dependencies" : "No dependencies"}
            <ChevronsUpDownIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-(--radix-popover-trigger-width) p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search tasks…" />
            <CommandList>
              <CommandEmpty>No other tasks in this goal.</CommandEmpty>
              {candidates.map((t) => (
                <CommandItem
                  key={t.id}
                  value={`${t.id} ${t.title}`}
                  onSelect={() => toggle(t.id)}
                >
                  <CheckIcon
                    className={cn(
                      "size-3.5",
                      value.includes(t.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t.id}
                  </span>
                  <span className="truncate">{t.title}</span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
