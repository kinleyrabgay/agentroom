"use client"

import { ShieldAlertIcon } from "lucide-react"
import { useAppStore } from "@/lib/store/app-store"

/** Shown on a tool step whose output the server flagged as possible prompt injection. */
export function InjectionBadge({ goalId }: { goalId?: string }) {
  const showSecurity = useAppStore((s) => s.showSecurity)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        showSecurity(goalId)
      }}
      className="tone-warning tone-soft inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 font-sans text-xs outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring/60"
      aria-label="Untrusted content flagged: this tool returned content that looked like instructions to the bot. Open Security."
    >
      <ShieldAlertIcon className="size-3.5" /> Untrusted content flagged
    </button>
  )
}
