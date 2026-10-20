"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2Icon, ZapIcon } from "lucide-react"
import { toast } from "sonner"
import type { AutomationScope, Trigger, TriggerThen, TriggerWhen } from "@shared"
import { ScopeField } from "./scope-field"
import { automationApi, githubApi, sentryApi, type TriggerInput } from "@/lib/api/endpoints"
import { trackerApi } from "@/lib/api/intake-endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Dropdown } from "@/components/kit/dropdown"
import { Callout } from "@/components/kit/callout"

type Source = TriggerWhen["source"]
const ANY = "__any__"

/** "When … then …": a trigger read as a sentence, every blank an inline pill. */
export function TriggerDialog({ open, onOpenChange, trigger }: { open: boolean; onOpenChange: (v: boolean) => void; trigger: Trigger | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open && <TriggerForm trigger={trigger} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function Pill<T extends string>({ value, options, onChange, label }: { value: T; options: { label: string; value: T }[]; onChange: (v: T) => void; label: string }) {
  return (
    <Dropdown<T>
      variant="pill"
      active
      datas={options}
      selectedValue={value}
      onSelect={(v) => onChange(v as T)}
      showSearch={options.length > 8}
      hint={`Search ${label}…`}
      className="h-8 border-dashed"
    />
  )
}

function TriggerForm({ trigger, onDone }: { trigger: Trigger | null; onDone: () => void }) {
  const bots = useAppStore((s) => s.bots)
  const lead = useMemo(() => bots.find((b) => !b.reportsTo) ?? bots[0], [bots])
  const [name, setName] = useState(trigger?.name ?? "")
  const [source, setSource] = useState<Source>(trigger?.when.source ?? "sentry")
  const [level, setLevel] = useState<string>(trigger?.when.source === "sentry" ? (trigger.when.level ?? ANY) : "fatal")
  const [project, setProject] = useState<string>(trigger?.when.source === "sentry" ? (trigger.when.project ?? ANY) : ANY)
  const [event, setEvent] = useState<"new_issue" | "spike">(trigger?.when.source === "sentry" ? trigger.when.event : "new_issue")
  const spikeRule = trigger?.when.source === "sentry" ? trigger.when.spike : undefined
  const [factor, setFactor] = useState(String(spikeRule?.factor ?? 3))
  const [windowMin, setWindowMin] = useState(String(spikeRule?.windowMin ?? 60))
  const [autoPr, setAutoPr] = useState<"wait" | "auto">(trigger?.then.autoPr ? "auto" : "wait")
  const [column, setColumn] = useState<string>(trigger?.when.source === "github" ? trigger.when.toColumn : "")
  const [toState, setToState] = useState<string>(trigger?.when.source === "linear" || trigger?.when.source === "jira" ? trigger.when.toState : "")
  const [trackerStates, setTrackerStates] = useState<Record<"linear" | "jira", string[]>>({ linear: [], jira: [] })
  const [trackersReady, setTrackersReady] = useState<{ linear: boolean; jira: boolean }>({ linear: false, jira: false })
  const [thenType, setThenType] = useState<TriggerThen["type"]>(trigger?.then.type ?? "handoff")
  const [botId, setBotId] = useState<string>(trigger?.then.botId ?? lead?.id ?? "")
  const [planOnly, setPlanOnly] = useState<"plan" | "build">(trigger?.then.planOnly === false ? "build" : "plan")
  const [channel, setChannel] = useState<"inbox" | "slack" | "teams">(trigger?.then.channel ?? "inbox")
  const [maxRuns, setMaxRuns] = useState(String(trigger?.limits.maxRunsPerDay ?? 3))
  const [budget, setBudget] = useState(trigger?.limits.budgetUsd ? String(trigger.limits.budgetUsd) : "")
  const [quiet, setQuiet] = useState(trigger ? !!trigger.limits.quietHours : true)
  const [projects, setProjects] = useState<string[]>([])
  const [columns, setColumns] = useState<string[]>([])
  const [scope, setScope] = useState<AutomationScope>(trigger?.scope ?? "personal")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    sentryApi
      .status()
      .then((st) => (st.config ? sentryApi.projects(st.config.org) : []))
      .then((list) => setProjects(list.map((p) => p.slug)))
      .catch(() => {})
    githubApi
      .get()
      .then((r) => {
        const cols = r.project?.columns.map((c) => c.name) ?? []
        setColumns(cols)
        setColumn((c) => c || cols.find((x) => /ready|todo|to do/i.test(x)) || cols[0] || "")
      })
      .catch(() => {})
    trackerApi
      .all()
      .then((all) => {
        const ready = { linear: !!all.linear.config && all.linear.hasToken, jira: !!all.jira.config && all.jira.hasToken }
        setTrackersReady(ready)
        for (const id of ["linear", "jira"] as const) {
          if (!ready[id]) continue
          trackerApi
            .issues(id, {})
            .then((p) => setTrackerStates((s) => ({ ...s, [id]: p.states.map((x) => x.name) })))
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [])

  // A failed goal can't be handed off; pick the closest action.
  const thenOptions = source === "goal"
    ? [{ label: "message", value: "message" as const }, { label: "start a goal", value: "goal" as const }, { label: "notify me", value: "notify" as const }]
    : [
        ...(source === "sentry" ? [{ label: "run autopilot", value: "autopilot" as const }] : []),
        { label: "hand it to", value: "handoff" as const },
        { label: "start a goal", value: "goal" as const },
        { label: "message", value: "message" as const },
        { label: "notify me", value: "notify" as const },
      ]
  const effectiveThen = thenOptions.some((o) => o.value === thenType) ? thenType : thenOptions[0]!.value
  const botOptions = bots.map((b) => ({ label: b.name, value: b.id }))

  const tracker = source === "linear" || source === "jira" ? source : null
  // The state pill shows the first state until one is picked; save what's shown.
  const stateValue = tracker ? toState.trim() || trackerStates[tracker][0] || "" : ""

  const save = async () => {
    const when: TriggerWhen =
      source === "sentry"
        ? {
            source,
            event,
            ...(level !== ANY ? { level: level as "fatal" } : {}),
            ...(project !== ANY ? { project } : {}),
            ...(event === "spike" ? { spike: { factor: Number(factor) || 3, windowMin: Number(windowMin) || 60, minEvents: spikeRule?.minEvents ?? 10 } } : {}),
          }
        : source === "github"
          ? { source, event: "card_moved", toColumn: column }
          : source === "linear" || source === "jira"
            ? { source, event: "issue_moved", toState: stateValue }
            : { source, event: "failed" }
    if (source === "github" && !column) return toast.error("Pick the column.")
    if (tracker && !stateValue) return toast.error("Pick the state.")
    const then: TriggerThen = {
      type: effectiveThen,
      planOnly: planOnly === "plan",
      ...(effectiveThen === "handoff" || effectiveThen === "message" ? { botId } : {}),
      ...(effectiveThen === "notify" ? { channel } : {}),
      ...(effectiveThen === "autopilot" ? { autoPr: autoPr === "auto" } : {}),
    }
    const usd = Number(budget)
    const input: TriggerInput = {
      name: name.trim() || defaultName(when),
      when,
      then,
      scope,
      limits: { maxRunsPerDay: Number(maxRuns) || 3, ...(usd > 0 ? { budgetUsd: usd } : {}), ...(quiet ? { quietHours: { from: "22:00", to: "07:00" } } : {}) },
    }
    setBusy(true)
    try {
      if (trigger) await automationApi.updateTrigger(trigger.id, input)
      else await automationApi.createTrigger(input)
      toast.success("Trigger saved")
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    if (!trigger) return toast.message("Save the trigger first, then test it.")
    try {
      const r = await automationApi.testTrigger(trigger.id)
      if (r.wouldFire) toast.success(`Would fire for ${r.event}`, { description: r.action })
      else toast.message(r.reason ?? "Wouldn't fire", { description: r.event })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <ZapIcon className="size-4 text-brand" /> {trigger ? "Edit trigger" : "New trigger"}
        </DialogTitle>
        <DialogDescription>Start work when something happens. New triggers stop after the plan, so nothing is built without you.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 rounded-2xl border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span>When</span>
          <Pill
            label="sources"
            value={source}
            onChange={setSource}
            options={[
              { label: "Sentry", value: "sentry" },
              { label: "GitHub", value: "github" },
              ...(trackersReady.linear || source === "linear" ? [{ label: "Linear", value: "linear" as const }] : []),
              ...(trackersReady.jira || source === "jira" ? [{ label: "Jira", value: "jira" as const }] : []),
              { label: "a goal", value: "goal" },
            ]}
          />
          {source === "sentry" && (
            <>
              <Pill label="events" value={event} onChange={setEvent} options={[{ label: "reports a new issue", value: "new_issue" }, { label: "sees an issue spike", value: "spike" }]} />
              {event === "spike" && (
                <>
                  <Pill label="factors" value={factor} onChange={setFactor} options={["2", "3", "5", "10"].map((v) => ({ label: `×${v}`, value: v }))} />
                  <span>within</span>
                  <Pill label="windows" value={windowMin} onChange={setWindowMin} options={[{ label: "15 minutes", value: "15" }, { label: "1 hour", value: "60" }, { label: "6 hours", value: "360" }, { label: "a day", value: "1440" }]} />
                </>
              )}
              <span>with</span>
              <Pill label="levels" value={level} onChange={setLevel} options={[{ label: "any level", value: ANY }, { label: "level fatal", value: "fatal" }, { label: "level error or worse", value: "error" }, { label: "level warning or worse", value: "warning" }]} />
              <span>in</span>
              <Pill label="projects" value={project} onChange={setProject} options={[{ label: "any project", value: ANY }, ...projects.map((p) => ({ label: p, value: p }))]} />
            </>
          )}
          {source === "github" && (
            <>
              <span>card moves to</span>
              {columns.length ? (
                <Pill label="columns" value={column} onChange={setColumn} options={columns.map((c) => ({ label: c, value: c }))} />
              ) : (
                <Input value={column} onChange={(e) => setColumn(e.target.value)} placeholder="Ready" className="h-8 w-36" aria-label="Column" />
              )}
            </>
          )}
          {(source === "linear" || source === "jira") && (
            <>
              <span>issue moves to</span>
              {trackerStates[source].length ? (
                <Pill label="states" value={stateValue} onChange={setToState} options={trackerStates[source].map((c) => ({ label: c, value: c }))} />
              ) : (
                <Input value={toState} onChange={(e) => setToState(e.target.value)} placeholder="Ready for dev" className="h-8 w-40" aria-label="State" />
              )}
            </>
          )}
          {source === "goal" && <span>fails</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span>then</span>
          <Pill label="actions" value={effectiveThen} onChange={setThenType} options={thenOptions} />
          {(effectiveThen === "handoff" || effectiveThen === "message") && <Pill label="bots" value={botId} onChange={setBotId} options={botOptions} />}
          {(effectiveThen === "handoff" || effectiveThen === "goal") && (
            <>
              <span>and</span>
              <Pill label="modes" value={planOnly} onChange={setPlanOnly} options={[{ label: "stop after the plan", value: "plan" }, { label: "build it and open a PR", value: "build" }]} />
            </>
          )}
          {effectiveThen === "autopilot" && (
            <>
              <span>and</span>
              <Pill label="modes" value={planOnly} onChange={setPlanOnly} options={[{ label: "stop after the plan", value: "plan" }, { label: "build without waiting", value: "build" }]} />
            </>
          )}
          {effectiveThen === "notify" && (
            <>
              <span>in</span>
              <Pill label="channels" value={channel} onChange={setChannel} options={[{ label: "the Inbox", value: "inbox" }, { label: "Slack", value: "slack" }, { label: "Teams", value: "teams" }]} />
            </>
          )}
        </div>
        {effectiveThen === "autopilot" && (
          <div className="flex flex-wrap items-center gap-2 text-[15px]">
            <span>When the fix is verified,</span>
            <Pill label="PR modes" value={autoPr} onChange={setAutoPr} options={[{ label: "wait for me before the PR", value: "wait" }, { label: "open the PR when confident", value: "auto" }]} />
          </div>
        )}
        {planOnly === "build" && (effectiveThen === "handoff" || effectiveThen === "goal") && (
          <Callout tone="warning">The plan is approved automatically and the Developer starts building. You still review the changes before any PR.</Callout>
        )}
        {effectiveThen === "autopilot" && (
          <Callout tone={autoPr === "auto" ? "warning" : "info"} title="Reproduce → failing test → fix → verify">
            The team must reproduce the error and write a test that fails because of it. AgentRoom then checks on its own that the test fails on the
            starting commit and passes on the fix, and scores its confidence. If it can&apos;t reproduce the bug, the goal stops and asks you.
            {autoPr === "auto" && " The PR opens on its own only when Settings → Autopilot allows it and confidence is above the threshold."}
          </Callout>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="trig-name">Name</Label>
          <Input id="trig-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fatal Sentry issues to Bug Fixer" />
        </div>
        <div className="space-y-1.5">
          <Label>Limits</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Dropdown<string> variant="pill" label="Max" datas={["1", "3", "5", "10"].map((v) => ({ label: `${v} a day`, value: v }))} selectedValue={maxRuns} onSelect={(v) => setMaxRuns(v as string)} showSearch={false} />
            <Input type="number" min={0} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Budget $" aria-label="Budget per run in USD" className="h-8 w-28" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl border p-3 sm:col-span-2">
          <div>
            <Label htmlFor="trig-quiet">Quiet hours 10 PM to 7 AM</Label>
            <p className="text-xs text-muted-foreground">Events during quiet hours are skipped and listed in History.</p>
          </div>
          <Switch id="trig-quiet" checked={quiet} onCheckedChange={setQuiet} />
        </div>
      </div>

      <div className="pt-1">
        <ScopeField value={scope} onChange={setScope} owner={trigger?.owner} />
      </div>

      <DialogFooter className="sm:justify-between">
        <Button variant="ghost" onClick={test} disabled={!trigger}>Test with the latest event</Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />} Save trigger
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

function defaultName(w: TriggerWhen): string {
  if (w.source === "sentry") return `${w.event === "spike" ? "Spiking" : "New"} ${w.level ?? ""} Sentry issues${w.project ? ` in ${w.project}` : ""}`.replace(/\s+/g, " ")
  if (w.source === "github") return `Cards moved to ${w.toColumn}`
  if (w.source === "linear" || w.source === "jira") return `${w.source === "linear" ? "Linear" : "Jira"} issues moved to ${w.toState}`
  return "Failed goals"
}
