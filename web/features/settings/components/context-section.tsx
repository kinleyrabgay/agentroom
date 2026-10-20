"use client"

import { useState } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Dropdown } from "@/components/kit/dropdown"
import { useModels } from "@/features/models/hooks/use-models"
import { useContextStore } from "@/features/context/lib/context-store"
import { View } from "@/lib/constants"
import { useSettingsSection } from "../hooks/use-settings-section"
import { SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

const DEFAULT_CARD_MODEL = "claude-haiku-4-5-20251001"

/** Repo context: the map in every bot's instructions, and the cards written about each module. */
export function ContextSection() {
  const { value, update, status } = useSettingsSection("context")
  const { models } = useModels()
  const ctx = useContextStore((s) => s.status)
  if (!value) return <SettingsCard id={SettingsSection.Context}>{null}</SettingsCard>
  const options = models?.models.map((m) => ({ label: m.label, value: m.value, ...(m.description ? { sublabel: m.description } : {}) })) ?? []
  if (!options.some((o) => o.value === value.cardModel)) options.unshift({ label: value.cardModel, value: value.cardModel })
  return (
    <SettingsCard id={SettingsSection.Context} aside={<SaveIndicator status={status} />}>
      <div className="space-y-4">
        <Row
          id="ctx-enabled"
          label="Give bots the repo map"
          hint="A short map of modules goes into every bot's instructions, with tools to read cards, search code and check what a change affects."
        >
          <Switch id="ctx-enabled" checked={value.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </Row>
        <Separator />
        <Row id="ctx-auto" label="Keep it current after goals" hint="When a goal finishes: note the change in the cards it touched, update the map and rewrite cards that are out of date.">
          <Switch id="ctx-auto" checked={value.autoSync} disabled={!value.enabled} onCheckedChange={(autoSync) => update({ autoSync })} />
        </Row>
        <Separator />
        <Row id="ctx-model" label="Card writer" hint="Cards are short summaries; a small model is plenty. Every card run is in the ledger.">
          <div className="w-full sm:w-64">
            <Dropdown<string>
              datas={options}
              selectedValue={value.cardModel}
              onSelect={(v) => update({ cardModel: v as string })}
              placeholder={DEFAULT_CARD_MODEL}
              disabled={!value.enabled}
            />
          </div>
        </Row>
        <Separator />
        <MaxCards value={value.maxCardsPerSync} disabled={!value.enabled} onChange={(maxCardsPerSync) => update({ maxCardsPerSync })} />
        {ctx?.built && (
          <p className="text-xs text-muted-foreground">
            {ctx.modules} modules · cards: {ctx.cards.fresh} up to date, {ctx.cards.stale} stale, {ctx.cards.missing} missing.{" "}
            <button className="font-medium text-brand hover:underline" onClick={() => useAppStore.getState().setView(View.Context)}>
              Open the map
            </button>
          </p>
        )}
      </div>
    </SettingsCard>
  )
}

function Row({ id, label, hint, children }: { id: string; label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-48 flex-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function MaxCards({ value, disabled, onChange }: { value: number; disabled: boolean; onChange: (v: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? String(value)
  const n = Number(text)
  const valid = Number.isInteger(n) && n >= 1 && n <= 500
  const commit = () => {
    if (typed !== null && valid && n !== value) onChange(n)
    setTyped(null)
  }
  return (
    <Row id="ctx-max" label="Cards per sync" hint={`At most this many cards are written in one sync, about two cents each (≈ $${(value * 0.02).toFixed(2)} at most).`}>
      <Input
        id="ctx-max"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-invalid={!valid}
        className="w-24 text-right tabular-nums"
      />
    </Row>
  )
}
