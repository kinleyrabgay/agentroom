"use client"

import { useEffect, useRef, useState } from "react"
import { BoxIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"
import type { ContextFilePeek } from "@shared"
import { cn } from "@/lib/utils"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ErrorState, LoadingState } from "@/components/kit/state-view"
import { openModule, setContext, useContextStore } from "../lib/context-store"

/** Read-only view of the code a card or search hit points at, scrolled to the cited line. */
export function CodePeekDialog() {
  const target = useContextStore((s) => s.peek)
  const key = target ? `${target.path}:${target.line ?? ""}` : ""
  const [state, setState] = useState<{ key: string; data?: ContextFilePeek; error?: string }>({ key: "" })
  const focusRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!target) return
    let live = true
    contextApi
      .peek(target.path, target.line)
      .then((data) => live && setState({ key, data }))
      .catch((e) => live && setState({ key, error: (e as Error).message }))
    return () => {
      live = false
    }
  }, [key, target])

  const current = state.key === key ? state : { key }
  useEffect(() => {
    focusRef.current?.scrollIntoView({ block: "center" })
  }, [current.data])

  const loc = target ? `${target.path}${target.line ? `:${target.line}` : ""}` : ""
  const data = current.data
  const more = (dir: -1 | 1) => {
    if (!data) return
    const start = dir < 0 ? Math.max(1, data.start - 120) : data.end + 1
    void loadRange(data.path, start, key, setState, data)
  }

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && setContext({ peek: null })}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-3.5 pr-14">
          <DialogTitle className="truncate font-mono text-sm">{loc}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2 text-xs">
            {data ? (
              <>
                <span>
                  Lines {data.start}–{data.end} of {data.total}
                </span>
                {data.moduleId && (
                  <button className="inline-flex items-center gap-1 text-brand hover:underline" onClick={() => openModule(data.moduleId)}>
                    <BoxIcon className="size-3.5" /> {data.moduleId}
                  </button>
                )}
              </>
            ) : (
              "Read-only view of the indexed file"
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto bg-sunken/60">
          {current.error ? (
            <ErrorState error={current.error} />
          ) : !data ? (
            <LoadingState />
          ) : (
            <div className="py-2 font-mono text-xs leading-5">
              {data.start > 1 && (
                <button className="block w-full px-4 py-1 text-left text-muted-foreground hover:text-foreground" onClick={() => more(-1)}>
                  ↑ Show earlier lines
                </button>
              )}
              {data.lines.map((l, i) => {
                const n = data.start + i
                const hit = n === data.focus
                return (
                  <div key={n} ref={hit ? focusRef : undefined} className={cn("flex", hit && "tone-brand tone-soft border-y-0")}>
                    <span className="w-14 shrink-0 pr-3 text-right text-muted-foreground/70 select-none tabular-nums">{n}</span>
                    <pre className="min-w-0 flex-1 pr-4 whitespace-pre">{l || " "}</pre>
                  </div>
                )
              })}
              {data.end < data.total && (
                <button className="block w-full px-4 py-1 text-left text-muted-foreground hover:text-foreground" onClick={() => more(1)}>
                  ↓ Show more
                </button>
              )}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(loc).then(() => toast.success(`Copied ${loc}`))
            }}
          >
            <CopyIcon data-icon="inline-start" /> Copy path:line
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

async function loadRange(
  path: string,
  start: number,
  key: string,
  setState: (s: { key: string; data?: ContextFilePeek; error?: string }) => void,
  prev: ContextFilePeek
) {
  const res = await fetchRange(path, start)
  if (!res) return
  // Merge with what's on screen so the cited line stays in view.
  const from = Math.min(prev.start, res.start)
  const to = Math.max(prev.end, res.end)
  if (to - from + 1 > 600) return setState({ key, data: { ...res, focus: prev.focus } })
  const lines: string[] = []
  for (let n = from; n <= to; n++) lines.push(n >= res.start && n <= res.end ? res.lines[n - res.start]! : prev.lines[n - prev.start] ?? "")
  setState({ key, data: { ...prev, start: from, end: to, lines } })
}

async function fetchRange(path: string, start: number): Promise<ContextFilePeek | null> {
  try {
    return await contextApi.peekRange(path, start, start + 119)
  } catch {
    return null
  }
}
