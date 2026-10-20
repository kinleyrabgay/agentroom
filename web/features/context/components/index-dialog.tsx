"use client"

import { useEffect, useState } from "react"
import { CopyIcon } from "lucide-react"
import { toast } from "sonner"
import type { ContextIndexView } from "@shared"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ErrorState, LoadingState } from "@/components/kit/state-view"
import { ToneBadge } from "@/components/kit/badge"
import { setContext, useContextStore } from "../lib/context-store"

/** "What bots see": INDEX.md exactly as it goes into every bot's instructions, with its size. */
export function IndexDialog() {
  const open = useContextStore((s) => s.indexOpen)
  const indexedAt = useContextStore((s) => s.status?.indexedAt)
  const [state, setState] = useState<{ data?: ContextIndexView; error?: string; for?: string }>({})

  useEffect(() => {
    if (!open) return
    let live = true
    contextApi
      .index()
      .then((data) => live && setState({ data, for: indexedAt ?? "" }))
      .catch((e) => live && setState({ error: (e as Error).message }))
    return () => {
      live = false
    }
  }, [open, indexedAt])

  const { data, error } = state
  return (
    <Dialog open={open} onOpenChange={(v) => setContext({ indexOpen: v })}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle className="flex items-center gap-2">
            What bots see
            {data && (
              <ToneBadge tone={data.tokens > 1500 ? "warning" : "success"} size="sm">
                ≈ {data.tokens.toLocaleString()} tokens
              </ToneBadge>
            )}
          </DialogTitle>
          <DialogDescription>
            Every bot gets this map in its instructions, then reads module cards and code with the context tools as it needs them. It stays the same between
            runs, so it’s cached and cheap after the first message.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto bg-sunken/60 px-5 py-4">
          {error ? <ErrorState error={error} /> : !data ? <LoadingState /> : <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{data.text}</pre>}
        </div>
        <footer className="flex items-center justify-between gap-2 border-t px-4 py-2.5">
          <p className="text-xs text-muted-foreground">
            Saved as <span className="font-mono">.agentroom/context/INDEX.md</span>. Copy it into CLAUDE.md with <span className="font-mono">agentroom context export</span>.
          </p>
          <Button size="sm" variant="outline" disabled={!data} onClick={() => data && void navigator.clipboard.writeText(data.text).then(() => toast.success("Copied"))}>
            <CopyIcon data-icon="inline-start" /> Copy
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
