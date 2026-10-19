"use client"

import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import type { RunnerStatus } from "@shared"
import { runnerApi } from "@/lib/api/endpoints"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/kit/segmented"
import { ToneDot } from "@/components/kit/badge"

/** Whether automation can run with the tab closed, and the switch to make it so. */
export function RunnerCallout({ compact }: { compact?: boolean }) {
  const [st, setSt] = useState<RunnerStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    runnerApi.status().then(setSt).catch(() => {})
  }, [])

  const toggle = async () => {
    if (!st) return
    setBusy(true)
    try {
      const next = st.installed ? await runnerApi.uninstall() : await runnerApi.install()
      setSt(next)
      toast.success(next.installed ? "Background mode is on" : "Background mode is off")
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const on = !!st?.installed
  return (
    <div className={cn(on ? "tone-success" : "tone-warning", "tone-soft flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-sm")}>
      <ToneDot tone={on ? "success" : "warning"} pulse={on && st?.running} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{!st ? "Checking background mode…" : on ? "Background mode is on" : st.supported ? "Background mode is off" : "Background mode isn't available here"}</p>
        {!compact && (
          <p className="text-xs text-foreground/70">
            {!st
              ? ""
              : on
                ? "Schedules and triggers run even when the AgentRoom tab is closed, while this Mac is awake."
                : st.supported
                  ? "Schedules only run while AgentRoom is open. Turn this on to run them with the tab closed."
                  : "Background mode is macOS-only for now. Keep AgentRoom running for schedules to fire."}
          </p>
        )}
      </div>
      <Segmented<"local" | "cloud">
        size="sm"
        aria-label="Runner"
        value="local"
        onChange={() => toast.message("The cloud runner is coming soon.")}
        options={[{ value: "local", label: "This Mac" }, { value: "cloud", label: "Cloud · soon" }]}
      />
      {st?.supported && (
        <Button size="sm" variant={on ? "outline" : "default"} onClick={toggle} disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          {on ? "Turn off" : "Turn on"}
        </Button>
      )}
    </div>
  )
}
