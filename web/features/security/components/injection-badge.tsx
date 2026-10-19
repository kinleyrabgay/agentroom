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
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px font-sans text-[10px] text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
      title="This tool returned content that looked like instructions to the bot. Open Security."
    >
      <ShieldAlertIcon className="size-3" /> Untrusted content flagged
    </button>
  )
}
