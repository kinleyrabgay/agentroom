"use client"

import { useState } from "react"
import type { SecurityFinding } from "@shared"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { resolveFinding } from "../lib/actions"

export type ResolveMode = "approved" | "dismissed"

const COPY: Record<ResolveMode, { title: string; description: string; action: string; required: boolean; placeholder: string }> = {
  approved: {
    title: "Approve this risk",
    description: "The finding stays on record as accepted, and the gate it blocks is lifted. Say why, for whoever reads the audit log later.",
    action: "Approve risk",
    required: true,
    placeholder: "Test fixture only, the key is a dummy value…",
  },
  dismissed: {
    title: "Dismiss as false positive",
    description: "Mark the finding as not a real issue. It's kept in the audit log.",
    action: "Dismiss",
    required: false,
    placeholder: "Optional: why this isn't a problem",
  },
}

/** Approve a risk (note required) or dismiss a false positive (note optional). */
export function ResolveDialog({ finding, mode, onClose }: { finding: SecurityFinding; mode: ResolveMode; onClose: () => void }) {
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const copy = COPY[mode]
  const canSubmit = !busy && (!copy.required || note.trim().length >= 3)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    const ok = await resolveFinding(finding.id, mode, note.trim() || undefined)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{finding.title}</p>
          <div className="grid gap-2">
            <Label htmlFor="resolve-note">
              Note {!copy.required && <span className="font-normal text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea id="resolve-note" autoFocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={copy.placeholder} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={mode === "approved" ? "default" : "secondary"} disabled={!canSubmit}>
              {copy.action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
