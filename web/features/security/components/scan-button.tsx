"use client"

import { useState } from "react"
import { Loader2Icon, ScanSearchIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runScan } from "../lib/actions"

/** Run the secret/risk scanner and dependency guard now. */
export function ScanButton({ goalId, label }: { goalId?: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await runScan(goalId)
        setBusy(false)
      }}
    >
      {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <ScanSearchIcon data-icon="inline-start" />}
      {busy ? "Scanning…" : (label ?? (goalId ? "Scan this goal" : "Scan working tree"))}
    </Button>
  )
}
