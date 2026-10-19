"use client"

import { useState } from "react"
import { PlusIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { SecurityReviewMode, type Settings } from "@shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { REVIEW_MODE_META, SCANNER_CHECKS } from "@/features/security/constants"
import { useSettingsSection } from "../hooks/use-settings-section"
import { SettingsSection } from "../lib/constants"
import { SaveIndicator } from "./save-indicator"
import { SettingsCard } from "./settings-card"

type BlockOn = Settings["security"]["blockOn"]

const BLOCK_OPTIONS: { value: BlockOn; label: string }[] = [
  { value: "critical", label: "Critical findings" },
  { value: "warning", label: "Critical findings and warnings" },
  { value: "none", label: "Never" },
]

/** Mirrors the server defaults, for "Reset to defaults". */
const DEFAULT_SENSITIVE_PATHS = [
  "**/auth/**",
  "**/*auth*",
  "**/payment*/**",
  "**/billing/**",
  "**/migrations/**",
  "**/*.sql",
  "**/.env*",
  "**/secrets/**",
]

/** Team-wide security policy (committed in settings.json). */
export function SecuritySection() {
  const { value, update, status } = useSettingsSection("security")
  if (!value) return null

  return (
    <SettingsCard id={SettingsSection.Security} aside={<SaveIndicator status={status} />}>
      <div className="space-y-5">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Security review for new goals</legend>
          <p className="text-xs text-muted-foreground">Each goal can override this when it&apos;s created or from its header.</p>
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
            {Object.values(SecurityReviewMode).map((m) => {
              const meta = REVIEW_MODE_META[m]
              const checked = value.review === m
              return (
                <button
                  key={m}
                  role="radio"
                  aria-checked={checked}
                  onClick={() => update({ review: m })}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
                    checked && "tone-brand border-[color-mix(in_oklch,var(--tone)_45%,transparent)] bg-[color-mix(in_oklch,var(--tone)_7%,transparent)]"
                  )}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <span className={cn("grid size-3.5 place-items-center rounded-full border", checked && "border-brand")}>
                      {checked && <span className="size-1.5 rounded-full bg-brand" />}
                    </span>
                    {meta.label}
                    {m === SecurityReviewMode.Auto && (
                      <ToneBadge tone="brand" size="sm" className="font-normal">
                        Recommended
                      </ToneBadge>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">{meta.description}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <Separator />

        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-48 flex-1">
            <Label className="text-sm font-medium">
              Block commits and PRs on
            </Label>
            <p className="text-xs text-muted-foreground">Blocked actions wait for you to approve or deny, with the findings shown.</p>
          </div>
          <div className="w-64">
            <Dropdown<BlockOn>
              datas={BLOCK_OPTIONS}
              selectedValue={value.blockOn}
              showSearch={false}
              onSelect={(v) => update({ blockOn: v as BlockOn })}
            />
          </div>
        </div>
        {value.blockOn === "none" && (
          <Callout tone="warning">
            Findings are still recorded, but bots can commit, push and open PRs without stopping. Only use this for throwaway repos.
          </Callout>
        )}

        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor="sec-gates" className="text-sm font-medium">
              Approval gates for high-risk goals
            </Label>
            <p className="text-xs text-muted-foreground">High risk scores pause before Test and before the PR until you approve.</p>
          </div>
          <Switch id="sec-gates" checked={value.riskGates} onCheckedChange={(v) => update({ riskGates: v })} />
        </div>

        <Separator />

        <SensitivePaths paths={value.sensitivePaths} onChange={(sensitivePaths) => update({ sensitivePaths })} />

        <Separator />

        <div>
          <h3 className="mb-2 text-sm font-medium">What the scanner checks</h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {SCANNER_CHECKS.map(({ label, detail, icon: Icon }) => (
              <li key={label} className="flex items-start gap-2 rounded-lg border px-3 py-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-sm">{label}</span>
                  <span className="block text-xs text-muted-foreground">{detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </SettingsCard>
  )
}

function SensitivePaths({ paths, onChange }: { paths: string[]; onChange: (paths: string[]) => void }) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const v = draft.trim()
    if (v && !paths.includes(v)) onChange([...paths, v])
    setDraft("")
  }
  const isDefault = paths.length === DEFAULT_SENSITIVE_PATHS.length && paths.every((p, i) => p === DEFAULT_SENSITIVE_PATHS[i])

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Sensitive paths</h3>
          <p className="text-xs text-muted-foreground">Changes under these globs always turn on the security review and raise the risk score.</p>
        </div>
        <Button size="xs" variant="ghost" disabled={isDefault} onClick={() => onChange(DEFAULT_SENSITIVE_PATHS)}>
          <RotateCcwIcon data-icon="inline-start" /> Reset to defaults
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {paths.map((p) => (
          <span key={p} className="inline-flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pr-1 pl-2 font-mono text-xs">
            {p}
            <button onClick={() => onChange(paths.filter((x) => x !== p))} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${p}`}>
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        {!paths.length && <span className="text-xs text-muted-foreground">No sensitive paths.</span>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="**/payments/**" className="h-8 max-w-xs font-mono text-xs" aria-label="Add a sensitive path glob" />
        <Button type="submit" size="sm" variant="outline" disabled={!draft.trim()}>
          <PlusIcon data-icon="inline-start" /> Add
        </Button>
      </form>
    </div>
  )
}
