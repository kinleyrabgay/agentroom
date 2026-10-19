"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClockIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import type { AutomationAction, GoalTemplate, ScheduleWhen } from "@shared"
import { automationApi, goalTemplateApi, type ScheduleInput } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dropdown } from "@/components/kit/dropdown"
import { Segmented } from "@/components/kit/segmented"
import { Callout } from "@/components/kit/callout"
import { describeWhen, formatAt } from "../lib/format"
import { WhenPicker } from "./when-picker"

type Kind = AutomationAction["type"]
const NO_TEMPLATE = "__none__"

export interface ScheduleDraft extends Partial<ScheduleInput> {
  /** Editing an existing schedule. */
  id?: string
}

/** Create or edit a schedule: when (plain words or picker), what (goal / message / hand-off), budget, runner. */
export function ScheduleDialog({ open, onOpenChange, draft }: { open: boolean; onOpenChange: (v: boolean) => void; draft: ScheduleDraft | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {open && <ScheduleForm draft={draft ?? {}} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function defaultAt() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.toISOString()
}

function ScheduleForm({ draft, onDone }: { draft: ScheduleDraft; onDone: () => void }) {
  const bots = useAppStore((s) => s.bots)
  const lead = useMemo(() => bots.find((b) => !b.reportsTo) ?? bots[0], [bots])
  const initial = draft.action
  const [name, setName] = useState(draft.name ?? "")
  const [when, setWhen] = useState<ScheduleWhen>(draft.when ?? { type: "once", at: defaultAt() })
  const [whenKey, setWhenKey] = useState(0)
  const [words, setWords] = useState("")
  const [parsed, setParsed] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>(initial?.type ?? "goal")
  const [brief, setBrief] = useState(initial?.type === "goal" ? initial.brief : "")
  const [title, setTitle] = useState(initial?.type === "goal" ? (initial.title ?? "") : "")
  const [templateId, setTemplateId] = useState(initial?.type === "goal" ? (initial.templateId ?? NO_TEMPLATE) : NO_TEMPLATE)
  const [botId, setBotId] = useState(initial?.type === "message" ? initial.botId : (lead?.id ?? ""))
  const [text, setText] = useState(initial?.type === "message" ? initial.text : "")
  const [budget, setBudget] = useState(initial?.type === "goal" && initial.budgetUsd ? String(initial.budgetUsd) : "")
  const [autoBuild, setAutoBuild] = useState(initial?.type === "goal" ? !!initial.autoBuild : false)
  const [templates, setTemplates] = useState<GoalTemplate[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    goalTemplateApi.list().then((l) => setTemplates(l.templates)).catch(() => {})
  }, [])

  // Plain words → time, live.
  useEffect(() => {
    if (!words.trim()) return
    const t = setTimeout(() => {
      automationApi
        .parse(words)
        .then((r) => {
          if (!r.at) return setParsed("No time found yet. Try “tomorrow at 9” or “every weekday at 8:30”.")
          const w: ScheduleWhen = r.recurring ? { type: "cron", ...r.recurring } : { type: "once", at: r.at }
          setWhen(w)
          setWhenKey((k) => k + 1)
          setParsed(r.recurring ? `${r.recurring.label} · first run ${formatAt(r.at)}` : `Runs ${formatAt(r.at)}`)
        })
        .catch(() => {})
    }, 350)
    return () => clearTimeout(t)
  }, [words])

  const action = (): AutomationAction | null => {
    if (kind === "goal") {
      if (!brief.trim()) return null
      const usd = Number(budget)
      return {
        type: "goal",
        brief: brief.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(templateId !== NO_TEMPLATE ? { templateId } : {}),
        ...(usd > 0 ? { budgetUsd: usd } : {}),
        ...(autoBuild ? { autoBuild: true } : {}),
      }
    }
    if (kind === "message") return botId && text.trim() ? { type: "message", botId, text: text.trim() } : null
    return initial?.type === "handoff" ? initial : null
  }

  const save = async () => {
    const a = action()
    if (!a) return toast.error(kind === "message" ? "Pick a bot and write the message." : "Describe what to do.")
    const finalName = name.trim() || (a.type === "goal" ? (a.title ?? a.brief).slice(0, 80) : a.type === "message" ? a.text.slice(0, 80) : "Hand-off")
    setBusy(true)
    try {
      if (draft.id) await automationApi.updateSchedule(draft.id, { name: finalName, when, action: a })
      else await automationApi.createSchedule({ name: finalName, when, action: a })
      toast.success(when.type === "once" ? `Scheduled for ${formatAt(when.at)}` : `Scheduled: ${when.label}`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const kinds = [
    { value: "goal" as Kind, label: "Start a goal" },
    { value: "message" as Kind, label: "Message a bot" },
    ...(initial?.type === "handoff" ? [{ value: "handoff" as Kind, label: "Hand off" }] : []),
  ]

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CalendarClockIcon className="size-4 text-brand" /> {draft.id ? "Edit schedule" : "New schedule"}
        </DialogTitle>
        <DialogDescription>Runs on this Mac while AgentRoom is running. Turn on background mode so it runs with the tab closed.</DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="sched-name">Name</Label>
          <Input id="sched-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nightly e2e in the browser" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sched-words">When</Label>
          <Input id="sched-words" value={words} onChange={(e) => setWords(e.target.value)} placeholder="Type it: tomorrow at 9, every weekday at 8:30…" />
          {words.trim() && parsed && <p className="text-xs text-muted-foreground">{parsed}</p>}
          <WhenPicker key={whenKey} value={when} onChange={setWhen} />
          <p className="text-xs text-muted-foreground">{describeWhen(when)}</p>
        </div>

        <div className="space-y-3">
          <Label>What</Label>
          <Segmented<Kind> aria-label="What runs" value={kind} onChange={setKind} options={kinds} />
          {kind === "goal" && (
            <div className="space-y-3">
              {templates.length > 0 && (
                <Dropdown<string>
                  datas={[{ label: "No template", value: NO_TEMPLATE }, ...templates.map((t) => ({ label: t.name, value: t.id, sublabel: t.description }))]}
                  selectedValue={templateId}
                  onSelect={(v) => setTemplateId(v as string)}
                  showSearch={false}
                />
              )}
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Goal title" />
              <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} placeholder="What should the team do?" aria-label="Goal brief" />
              <div className="flex items-start justify-between gap-4 rounded-2xl border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="sched-auto">Build without waiting for my approval</Label>
                  <p className="text-xs text-muted-foreground">Off: the team plans and waits for you to approve. On: the plan is approved automatically and the Developer starts building.</p>
                </div>
                <Switch id="sched-auto" checked={autoBuild} onCheckedChange={setAutoBuild} />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="sched-budget" className="shrink-0">Budget</Label>
                <Input id="sched-budget" type="number" min={0} step={0.5} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Team default" className="w-40" />
                <span className="text-xs text-muted-foreground">USD for this goal</span>
              </div>
            </div>
          )}
          {kind === "message" && (
            <div className="space-y-3">
              <Dropdown<string> datas={bots.map((b) => ({ label: b.name, value: b.id, sublabel: b.role }))} selectedValue={botId} onSelect={(v) => setBotId(v as string)} hint="Search bots…" />
              <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should the bot do?" aria-label="Message" />
            </div>
          )}
          {kind === "handoff" && initial?.type === "handoff" && (
            <Callout tone="info" title={`Hand off ${initial.ids.length} ${initial.source === "github" ? "GitHub" : "Sentry"} ${initial.ids.length === 1 ? "item" : "items"}`}>
              {initial.botId ? `To ${bots.find((b) => b.id === initial.botId)?.name ?? initial.botId}` : "To the Team Lead (starts a goal)"}
            </Callout>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Label className="shrink-0">Runs on</Label>
          <Segmented<"local" | "cloud"> aria-label="Runner" value="local" onChange={() => toast.message("The cloud runner is coming soon.")} options={[{ value: "local", label: "This Mac" }, { value: "cloud", label: "Cloud · soon" }]} size="sm" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={save} disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" data-icon="inline-start" />}
          {draft.id ? "Save schedule" : "Schedule"}
        </Button>
      </DialogFooter>
    </>
  )
}
