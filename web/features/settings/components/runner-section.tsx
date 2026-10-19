"use client"

import { useEffect, useState } from "react"
import type { RunnerStatus } from "@shared"
import { runnerApi } from "@/lib/api/endpoints"
import { RunnerCallout } from "@/features/automation/components/runner-callout"
import { PropertyGrid } from "@/components/kit/property-grid"
import { SettingsCard } from "./settings-card"
import { SettingsSection } from "../lib/constants"

/** Where automation runs: this Mac (with optional background mode) now, the cloud later. */
export function RunnerSection() {
  const [st, setSt] = useState<RunnerStatus | null>(null)
  useEffect(() => {
    runnerApi.status().then(setSt).catch(() => {})
  }, [])
  return (
    <SettingsCard id={SettingsSection.Runner}>
      <div className="space-y-4">
        <RunnerCallout />
        {st && (
          <PropertyGrid
            items={[
              { label: "Background agent", value: <span className="font-mono text-xs">{st.label}</span>, wide: true },
              { label: "Status", value: st.installed ? (st.running ? "Running" : "Installed, not running") : "Not installed" },
              { label: "This window", value: st.isDaemon ? "Served by background mode" : "Started from the terminal" },
              { label: "Log", value: <span className="font-mono text-xs">{st.logFile}</span>, wide: true },
            ]}
          />
        )}
        <p className="text-xs text-muted-foreground">
          From a terminal: <code className="font-mono">agentroom daemon install</code>, <code className="font-mono">status</code> or <code className="font-mono">uninstall</code>. With background mode on,{" "}
          <code className="font-mono">agentroom start</code> opens the running instance instead of starting a second one. Runs while this Mac is awake.
        </p>
      </div>
    </SettingsCard>
  )
}
