"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { ProofScenario } from "@shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { TONE_CLASS } from "@/components/kit/tone"
import { cn } from "@/lib/utils"

const EXAMPLE: ProofScenario[] = [
  {
    name: "Export reports as CSV",
    path: "/reports",
    steps: [
      { action: "click", target: "text=Export", label: "Open the export menu" },
      { action: "click", target: "text=CSV" },
      { action: "expect", value: "Download ready" },
    ],
  },
]

/** Edit the proof scenario as JSON (the same format QA writes). */
export function ScenarioDialog({
  open,
  onOpenChange,
  scenarios,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scenarios: ProofScenario[]
  onSave: (list: ProofScenario[]) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Proof scenario</DialogTitle>
          <DialogDescription>
            What the browser does to show the feature working. Actions: goto, click, fill, press, wait, expect, screenshot. Targets are CSS selectors or <code className="font-mono">text=…</code>; paths stay on the app.
          </DialogDescription>
        </DialogHeader>
        {open && <ScenarioForm initial={scenarios.length ? scenarios : EXAMPLE} onCancel={() => onOpenChange(false)} onSave={async (l) => {
          await onSave(l)
          onOpenChange(false)
        }} />}
      </DialogContent>
    </Dialog>
  )
}

function ScenarioForm({ initial, onCancel, onSave }: { initial: ProofScenario[]; onCancel: () => void; onSave: (list: ProofScenario[]) => Promise<void> }) {
  const [text, setText] = useState(() => JSON.stringify(initial, null, 2))
  const [busy, setBusy] = useState(false)
  let parsed: ProofScenario[] | null = null
  let problem: string | null = null
  try {
    const v = JSON.parse(text) as unknown
    if (!Array.isArray(v)) problem = "Use a list: [ { name, path, steps } ]"
    else parsed = v as ProofScenario[]
  } catch (e) {
    problem = (e as Error).message
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!parsed) return
    setBusy(true)
    try {
      await onSave(parsed)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        aria-label="Scenario JSON"
        aria-invalid={!!problem}
        className="max-h-[55vh] min-h-64 font-mono text-xs"
      />
      {problem && <p className={cn(TONE_CLASS.danger, "tone-text text-xs")}>{problem}</p>}
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!parsed || busy}>
          Save scenario
        </Button>
      </DialogFooter>
    </form>
  )
}
