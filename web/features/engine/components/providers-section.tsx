"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckIcon, ChevronRightIcon, KeyRoundIcon, RotateCwIcon, ShieldCheckIcon, ShieldAlertIcon } from "lucide-react"
import { toast } from "sonner"
import type { CostEstimate, ProviderStatus, Settings } from "@shared"
import { cn } from "@/lib/utils"
import { engineApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToneBadge } from "@/components/kit/badge"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { Segmented } from "@/components/kit/segmented"
import type { Tone } from "@/components/kit/tone"
import { useSettingsSection } from "@/features/settings/hooks/use-settings-section"
import { PHASES, SettingsSection } from "@/features/settings/lib/constants"
import { SaveIndicator } from "@/features/settings/components/save-indicator"
import { SettingsCard } from "@/features/settings/components/settings-card"

type Engine = Settings["engine"]
type PhaseRoute = Settings["models"][keyof Settings["models"]]

const PROJECT_DEFAULT = "__default"
const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini", "openai-compat": "OpenAI-compatible" }
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`)

/** Providers besides Claude: status and guarantees, per-phase routing with fallbacks, and a cost preview. */
export function ProvidersSection() {
  const engine = useSettingsSection("engine")
  const models = useSettingsSection("models")
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null)
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [checking, setChecking] = useState(false)

  const fetchAll = useCallback(
    () =>
      Promise.all([engineApi.providers(), engineApi.estimate().catch(() => null)])
        .then(([p, e]) => {
          setProviders(p)
          setEstimate(e)
        })
        .catch((err: Error) => toast.error(`Couldn't check providers: ${err.message}`)),
    []
  )

  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  const load = () => {
    setChecking(true)
    void fetchAll().finally(() => setChecking(false))
  }

  // Re-estimate after a routing change (debounced by the settings autosave).
  const routing = models.value
  useEffect(() => {
    if (!routing) return
    const t = setTimeout(() => void engineApi.estimate().then(setEstimate).catch(() => {}), 900)
    return () => clearTimeout(t)
  }, [routing])

  const status = engine.status !== "idle" ? engine.status : models.status

  return (
    <SettingsCard id={SettingsSection.Providers} aside={<SaveIndicator status={status} />}>
      {!engine.value || !models.value ? null : (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-sm font-medium">Providers</h3>
              <Button variant="ghost" size="xs" onClick={load} disabled={checking}>
                <RotateCwIcon className={cn(checking && "animate-spin")} data-icon="inline-start" /> Check again
              </Button>
            </div>
            {!providers ? (
              <div className="space-y-2">
                <Skeleton className="h-14 w-full rounded-xl" />
                <Skeleton className="h-14 w-full rounded-xl" />
              </div>
            ) : (
              <ul className="divide-y rounded-xl border">
                {providers.map((p) => (
                  <ProviderRow key={p.id} p={p} engine={engine.value!} update={engine.update} onKeyChanged={load} />
                ))}
              </ul>
            )}
          </div>

          <Separator />
          <Routing value={models.value} update={models.update} providers={providers} />

          <Separator />
          <Fallback value={engine.value.fallback} onChange={(fallback) => engine.update({ fallback })} />

          <Separator />
          <EstimateView estimate={estimate} />
        </div>
      )}
    </SettingsCard>
  )
}

function readiness(p: ProviderStatus): { tone: Tone; label: string } {
  if (!p.available) return { tone: "neutral", label: p.id === "openai-compat" ? "Not reachable" : "Not installed" }
  if (p.auth === "missing") return { tone: "warning", label: "Not signed in" }
  return { tone: "success", label: "Ready" }
}

function ProviderRow({ p, engine, update, onKeyChanged }: { p: ProviderStatus; engine: Engine; update: (patch: Partial<Engine>) => void; onKeyChanged: () => void }) {
  const ready = readiness(p)
  const g = p.guarantees
  return (
    <li>
      <Collapsible>
        <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left">
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{p.name}</span>
              {p.version && <span className="font-mono text-xs text-muted-foreground">{p.version}</span>}
              {p.experimental && (
                <ToneBadge tone="info" size="sm">
                  Experimental
                </ToneBadge>
              )}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {g.perCommandApproval ? <ShieldCheckIcon className="size-3.5 shrink-0" /> : <ShieldAlertIcon className="size-3.5 shrink-0" />}
              <span className="truncate">{g.perCommandApproval ? "You approve risky commands" : g.sandbox}</span>
            </span>
          </span>
          <ToneBadge tone={ready.tone} dot size="sm">
            {ready.label}
          </ToneBadge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 border-t bg-sunken/50 px-4 py-4 pl-11">
            {p.hint && (
              <Callout tone={p.available ? "warning" : "info"} className="py-2">
                {p.hint}
              </Callout>
            )}
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <Fact label="Approvals" value={g.perCommandApproval ? "Each risky command" : "Provider sandbox"} ok={g.perCommandApproval} />
              <Fact label="AgentRoom tools" value={g.hostTools ? "Yes" : "No"} ok={g.hostTools} />
              <Fact label="Chat history" value={g.resume ? "Kept" : "Fresh each run"} ok={g.resume} />
              <Fact label="Spend" value={g.exactCost ? "Exact" : "Estimated"} ok={g.exactCost} />
            </dl>
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {g.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
            {p.id === "codex" && <CodexConfig value={engine.codex} onChange={(codex) => update({ codex })} />}
            {p.id === "gemini" && <GeminiConfig value={engine.gemini} onChange={(gemini) => update({ gemini })} />}
            {p.id === "openai-compat" && <CompatConfig value={engine.openaiCompat} models={p.models} onChange={(openaiCompat) => update({ openaiCompat })} />}
            {p.id !== "claude" && <KeyField provider={p.id} hasKey={!!p.hasKey} onChanged={onKeyChanged} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate font-medium", !ok && "text-muted-foreground")}>{value}</dd>
    </div>
  )
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-40 flex-1">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

/** A number input that commits on blur / Enter. */
function NumberInput({ id, value, min = 0, max, step, onCommit, className }: { id: string; value: number; min?: number; max?: number; step?: number; onCommit: (n: number) => void; className?: string }) {
  const [typed, setTyped] = useState<string | null>(null)
  const text = typed ?? String(value)
  const n = Number(text)
  const valid = text.trim() !== "" && Number.isFinite(n) && n >= min && (max === undefined || n <= max)
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      step={step}
      aria-invalid={!valid}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        if (typed !== null && valid && n !== value) onCommit(n)
        setTyped(null)
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={cn("w-24 text-right tabular-nums", className)}
    />
  )
}

/** A text input that commits on blur / Enter. */
function TextInput({ id, value, placeholder, onCommit, className }: { id: string; value: string; placeholder?: string; onCommit: (v: string) => void; className?: string }) {
  const [typed, setTyped] = useState<string | null>(null)
  return (
    <Input
      id={id}
      value={typed ?? value}
      placeholder={placeholder}
      onChange={(e) => setTyped(e.target.value)}
      onBlur={() => {
        if (typed !== null && typed.trim() !== value) onCommit(typed.trim())
        setTyped(null)
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className={className}
    />
  )
}

function Prices({ idPrefix, inPer, outPer, onChange }: { idPrefix: string; inPer: number; outPer: number; onChange: (p: { priceInPerMtok?: number; priceOutPerMtok?: number }) => void }) {
  return (
    <Field id={`${idPrefix}-in`} label="Price per million tokens" hint="To estimate spend and apply budgets. 0 when you pay by plan.">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        in $<NumberInput id={`${idPrefix}-in`} value={inPer} onCommit={(n) => onChange({ priceInPerMtok: n })} className="w-20" />
        out $<NumberInput id={`${idPrefix}-out`} value={outPer} onCommit={(n) => onChange({ priceOutPerMtok: n })} className="w-20" />
      </div>
    </Field>
  )
}

function CodexConfig({ value, onChange }: { value: Engine["codex"]; onChange: (v: Engine["codex"]) => void }) {
  return (
    <div className="space-y-3">
      <Field id="codex-sandbox" label="Sandbox" hint="What Codex may change. It can't ask you about single commands.">
        <Segmented<Engine["codex"]["sandbox"]>
          aria-label="Codex sandbox"
          size="sm"
          value={value.sandbox}
          onChange={(sandbox) => onChange({ ...value, sandbox })}
          options={[
            { value: "read-only", label: "Read-only" },
            { value: "workspace-write", label: "Goal folder" },
          ]}
        />
      </Field>
      <Field id="codex-net" label="Network access" hint="Let commands reach the internet (package installs, APIs).">
        <Switch id="codex-net" checked={value.network} onCheckedChange={(network) => onChange({ ...value, network })} />
      </Field>
      <Prices idPrefix="codex" inPer={value.priceInPerMtok} outPer={value.priceOutPerMtok} onChange={(p) => onChange({ ...value, ...p })} />
    </div>
  )
}

function GeminiConfig({ value, onChange }: { value: Engine["gemini"]; onChange: (v: Engine["gemini"]) => void }) {
  return (
    <div className="space-y-3">
      <Field id="gemini-approval" label="Approval mode" hint="Headless Gemini can't ask you; this decides what it may do on its own.">
        <div className="w-full sm:w-56">
          <Dropdown<Engine["gemini"]["approvalMode"]>
            datas={[
              { value: "default", label: "Refuse risky tools", sublabel: "Reads only" },
              { value: "auto_edit", label: "Allow file edits", sublabel: "No shell" },
              { value: "yolo", label: "Allow everything", sublabel: "Use with the sandbox" },
            ]}
            selectedValue={value.approvalMode}
            onSelect={(v) => onChange({ ...value, approvalMode: v as Engine["gemini"]["approvalMode"] })}
            showSearch={false}
          />
        </div>
      </Field>
      <Field id="gemini-sandbox" label="Sandbox" hint="Run tools in Gemini's sandbox (Seatbelt on macOS, Docker elsewhere).">
        <Switch id="gemini-sandbox" checked={value.sandbox} onCheckedChange={(sandbox) => onChange({ ...value, sandbox })} />
      </Field>
      {value.approvalMode === "yolo" && !value.sandbox && (
        <Callout tone="warning" className="py-2">
          Gemini will run any command without asking and outside a sandbox.
        </Callout>
      )}
      <Prices idPrefix="gemini" inPer={value.priceInPerMtok} outPer={value.priceOutPerMtok} onChange={(p) => onChange({ ...value, ...p })} />
    </div>
  )
}

function CompatConfig({ value, models, onChange }: { value: Engine["openaiCompat"]; models: string[]; onChange: (v: Engine["openaiCompat"]) => void }) {
  return (
    <div className="space-y-3">
      <Field id="compat-url" label="Endpoint" hint="Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1">
        <TextInput id="compat-url" value={value.baseUrl} onCommit={(baseUrl) => onChange({ ...value, baseUrl })} className="w-full font-mono text-xs sm:w-72" />
      </Field>
      <Field id="compat-model" label="Default model" hint="Pick one trained for tool use.">
        <div className="w-full sm:w-72">
          {models.length ? (
            <Dropdown<string>
              datas={models.map((m) => ({ value: m, label: m }))}
              selectedValue={value.model || undefined}
              placeholder="Choose a model"
              onSelect={(v) => onChange({ ...value, model: v as string })}
            />
          ) : (
            <TextInput id="compat-model" value={value.model} placeholder="e.g. qwen2.5-coder:14b" onCommit={(model) => onChange({ ...value, model })} className="font-mono text-xs" />
          )}
        </div>
      </Field>
      <Field id="compat-turns" label="Turns per run" hint="The tool loop stops after this many model calls.">
        <NumberInput id="compat-turns" value={value.maxTurns} min={1} max={200} onCommit={(maxTurns) => onChange({ ...value, maxTurns: Math.round(maxTurns) })} />
      </Field>
      <Prices idPrefix="compat" inPer={value.priceInPerMtok} outPer={value.priceOutPerMtok} onChange={(p) => onChange({ ...value, ...p })} />
    </div>
  )
}

/** Write-only API key: stored in runs/secrets.json, never shown again. */
function KeyField({ provider, hasKey, onChanged }: { provider: string; hasKey: boolean; onChanged: () => void }) {
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (value: string) => {
    setBusy(true)
    try {
      await engineApi.setKey(provider, value)
      setKey("")
      toast.success(value ? "Key saved on this machine" : "Key removed")
      onChanged()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Field id={`${provider}-key`} label="API key" hint="Optional. Kept in .agentroom/runs/secrets.json on this machine only.">
      <div className="flex w-full items-center gap-2 sm:w-auto">
        {hasKey && !key ? (
          <>
            <ToneBadge tone="success" icon={KeyRoundIcon} size="sm">
              Key saved
            </ToneBadge>
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => void save("")}>
              Remove
            </Button>
          </>
        ) : null}
        <Input id={`${provider}-key`} type="password" autoComplete="off" value={key} placeholder={hasKey ? "Replace key" : "Paste key"} onChange={(e) => setKey(e.target.value)} className="w-full sm:w-48" />
        <Button size="sm" variant="outline" disabled={busy || !key.trim()} onClick={() => void save(key)}>
          Save
        </Button>
      </div>
    </Field>
  )
}

function Routing({ value, update, providers }: { value: Settings["models"]; update: (patch: Partial<Settings["models"]>) => void; providers: ProviderStatus[] | null }) {
  const options = [
    { value: PROJECT_DEFAULT, label: "Project default", sublabel: "config.json provider" },
    ...Object.entries(PROVIDER_LABEL).map(([id, label]) => {
      const st = providers?.find((p) => p.id === id)
      return { value: id, label, ...(st ? { sublabel: readiness(st).label } : {}) }
    }),
  ]
  const set = (phase: keyof Settings["models"], next: PhaseRoute) => update({ [phase]: next } as Partial<Settings["models"]>)
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Provider per phase</h3>
        <p className="text-xs text-muted-foreground">
          Claude models are chosen in General. For other providers, name the model here (empty = the provider&apos;s default). Fallbacks are tried in order when a run can&apos;t
          start; a run that already did something is never retried elsewhere.
        </p>
      </div>
      <ul className="divide-y rounded-xl border">
        {PHASES.map((phase) => {
          const cur: PhaseRoute = value[phase.id] ?? {}
          const provider = cur.provider ?? PROJECT_DEFAULT
          const external = provider !== PROJECT_DEFAULT && provider !== "claude"
          const fallbacks = (cur.fallbacks ?? []).map((f) => f.provider)
          return (
            <li key={phase.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_9.5rem_8.5rem] sm:items-center sm:gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{phase.label}</div>
                <div className="truncate text-xs text-muted-foreground">{phase.hint}</div>
              </div>
              <Dropdown<string>
                datas={options}
                selectedValue={provider}
                showSearch={false}
                onSelect={(v) => {
                  const next = v as string
                  // A Claude model id means nothing to another provider: drop it when switching away.
                  const keepModel = next === PROJECT_DEFAULT || next === "claude" ? cur.model : undefined
                  set(phase.id, { ...cur, provider: next === PROJECT_DEFAULT ? undefined : (next as PhaseRoute["provider"]), model: keepModel })
                }}
              />
              {external ? (
                <TextInput
                  id={`model-${phase.id}`}
                  value={cur.model ?? ""}
                  placeholder="Default model"
                  onCommit={(model) => set(phase.id, { ...cur, model: model || undefined })}
                  className="min-w-0 font-mono text-xs"
                />
              ) : (
                <span className="min-w-0 truncate px-1 text-xs text-muted-foreground" title={cur.model ? cur.model : "Set in General"}>
                  {cur.model ?? "Model in General"}
                </span>
              )}
              <div className="min-w-0">
                  <Dropdown<string>
                    variant="pill"
                    label="Then"
                    multiple
                    active={fallbacks.length > 0}
                    datas={Object.entries(PROVIDER_LABEL)
                      .filter(([id]) => id !== provider)
                      .map(([id, label]) => ({ value: id, label }))}
                    selectedValue={fallbacks}
                    placeholder="Claude"
                    showSearch={false}
                    onSelect={(v) => {
                      const ids = (v as string[]).filter((id) => id !== provider)
                      set(phase.id, { ...cur, fallbacks: ids.length ? ids.map((id) => ({ provider: id as PhaseRoute["provider"] & string })) : undefined })
                    }}
                  />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Fallback({ value, onChange }: { value: Engine["fallback"]; onChange: (v: Engine["fallback"]) => void }) {
  const row = (id: string, label: string, hint: string, key: keyof Engine["fallback"], disabled = false) => (
    <Field id={id} label={label} hint={hint}>
      <Switch id={id} checked={value[key]} disabled={disabled} onCheckedChange={(v) => onChange({ ...value, [key]: v })} />
    </Field>
  )
  return (
    <div className="space-y-3">
      {row("fb-on", "Fall back to the next provider", "When none is set for a phase, Claude is the last resort. Missing or signed-out providers always fall back.", "enabled")}
      <div className={cn("space-y-3 border-l pl-4", !value.enabled && "opacity-60")}>
        {row("fb-rate", "On rate limits", "Usage limit reached, too many requests.", "onRateLimit", !value.enabled)}
        {row("fb-outage", "On outages", "Overloaded, 5xx, endpoint not answering.", "onOutage", !value.enabled)}
        {row("fb-error", "On other errors", "Any other failure before the run did anything.", "onError", !value.enabled)}
      </div>
    </div>
  )
}

function EstimateView({ estimate }: { estimate: CostEstimate | null }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-sm font-medium">Cost of a typical goal</h3>
          <p className="text-xs text-muted-foreground">
            Median spend per phase in finished goals{estimate ? ` (${estimate.goals})` : ""}, on the provider each phase uses now.
          </p>
        </div>
        <span className="text-2xl font-semibold tracking-tight tabular-nums">{estimate ? usd(estimate.totalUsd) : "…"}</span>
      </div>
      {estimate && (
        <ul className="divide-y rounded-xl border text-sm">
          {estimate.phases.map((p) => (
            <li key={p.phase} className="flex items-center gap-3 px-4 py-2">
              <span className="w-28 shrink-0 capitalize">{p.phase}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {PROVIDER_LABEL[p.provider] ?? p.provider}
                {p.model ? ` · ${p.model}` : ""}
              </span>
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {p.basis === "exact" ? (
                  <span className="inline-flex items-center gap-1">
                    <CheckIcon className="size-3" /> {p.samples} goals
                  </span>
                ) : p.basis === "provider" ? (
                  `same provider · ${p.samples}`
                ) : p.basis === "any" ? (
                  `any provider · ${p.samples}`
                ) : (
                  "no history"
                )}
              </span>
              <span className="w-16 text-right tabular-nums">{usd(p.medianUsd)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
