"use client"

import { BellRingIcon, ChevronRightIcon } from "lucide-react"
import { useAppStore } from "@/lib/store/app-store"

/** Bell footer: alert preferences live in Settings → Alerts. */
export function AlertSettings({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="border-t">
      <button
        onClick={() => {
          useAppStore.getState().showSettings("alerts")
          onNavigate?.()
        }}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:bg-accent"
      >
        <BellRingIcon className="size-3.5" />
        Alert settings: sound, voice and desktop notifications
        <ChevronRightIcon className="ml-auto size-3.5" />
      </button>
    </div>
  )
}
