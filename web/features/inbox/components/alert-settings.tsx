"use client"

import { useState } from "react"
import { BellRingIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { AlertPrefsForm } from "@/features/alerts/components/alert-prefs-form"
import { useAlertPrefs } from "@/features/alerts/hooks/use-alert-prefs"

/** Inbox footer: how AgentRoom reaches you when you're not looking at it (OS notification, sound, voice). */
export function AlertSettings() {
  const [open, setOpen] = useState(false)
  const state = useAlertPrefs(open)

  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <BellRingIcon className="size-3.5" />
        Alerts when you&apos;re away
        <ChevronDownIcon className={cn("ml-auto size-3.5 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="px-3 pt-1 pb-3">
          <AlertPrefsForm state={state} compact />
        </div>
      )}
    </div>
  )
}
