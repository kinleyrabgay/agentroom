"use client"

import type { EffortLevel } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { Separator } from "@/components/ui/separator"
import { ModelEffortPicker } from "@/features/models/components/model-effort-picker"
import { useModels } from "@/features/models/hooks/use-models"
import { effectiveModel, formatModel } from "@/features/models/lib/models"
import { useSettingsSection } from "../hooks/use-settings-section"
import { PHASES, SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

const INHERIT = { label: "Bot's own setting", description: "Each bot uses the model and effort from its Config tab" }

/** Model + effort per workflow phase. */
export function GeneralSection() {
  const { value, update, status } = useSettingsSection("models")
  const info = useAppStore((s) => s.info)
  const { models } = useModels()
  const projectDefault = formatModel(effectiveModel(models, {}, info?.config))

  return (
    <SettingsCard id={SettingsSection.General} aside={<SaveIndicator status={status} />}>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Model per phase</h3>
        <p className="text-xs text-muted-foreground">
          Inside goal runs the phase setting wins; in direct chats each bot uses its own model.
        </p>
      </div>
      <ul className="mt-4 divide-y rounded-xl border">
        {PHASES.map((phase) => {
          const current = value?.[phase.id] ?? {}
          return (
            <li key={phase.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-40 flex-1">
                <div className="text-sm font-medium">{phase.label}</div>
                <div className="text-xs text-muted-foreground">{phase.hint}</div>
              </div>
              <div className="w-full sm:w-80">
                <ModelEffortPicker
                  value={current}
                  inherit={INHERIT}
                  // Send the whole section so clearing a phase's model/effort takes effect; keep its provider route.
                  onChange={(next: { model?: string; effort?: EffortLevel }) =>
                    value && update({ ...value, [phase.id]: { ...current, model: next.model, effort: next.effort } })
                  }
                />
              </div>
            </li>
          )
        })}
      </ul>
      <Separator className="my-4" />
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">Project default model</span>
        <span className="font-medium">{info ? projectDefault : "…"}</span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Used when neither the phase nor the bot sets a model. Change it with <code className="font-mono">agentroom start --model</code> or in{" "}
        <code className="font-mono">.agentroom/config.json</code>; per-bot models live in each bot&apos;s Config tab.
      </p>
    </SettingsCard>
  )
}
