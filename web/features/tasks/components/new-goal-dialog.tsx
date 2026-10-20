"use client"

import { useEffect, useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { WhenPicker } from "@/features/automation/components/when-picker"
import { formatAt } from "@/features/automation/lib/format"
import { BugIcon, CalendarClockIcon, FilePenLineIcon, FilePlusIcon, LayersIcon, PackageIcon, PlugIcon, RocketIcon, ShuffleIcon, SmartphoneIcon, SparklesIcon, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { SecurityReviewMode, type GoalTemplate, type GoalTemplateList, type ScheduleWhen } from "@shared"
import { cn } from "@/lib/utils"
import { automationApi, goalApi, goalTemplateApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { ReviewModeSelect } from "@/features/security/components/review-mode-select"
import { REVIEW_MODE_META } from "@/features/security/constants"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

/** Template icon names (frontmatter `icon`) to icons; unknown ones get a generic mark. */
const ICONS: Record<string, LucideIcon> = { bug: BugIcon, plug: PlugIcon, shuffle: ShuffleIcon, package: PackageIcon, layers: LayersIcon, "file-plus": FilePlusIcon, smartphone: SmartphoneIcon }
const BLANK = "__blank__"

/**
 * Start a goal: pick a template (Bug fix, New endpoint, …) or start blank, fill in its fields,
 * optionally set a budget and the security review. The Planner turns it into tasks for review.
 */
export function NewGoalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">{open && <NewGoalForm onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  )
}

function NewGoalForm({ onDone }: { onDone: () => void }) {
  const showOnTasks = useAppStore((s) => s.showOnTasks)
  const teamDefault = useAppStore((s) => s.settings?.security.review) ?? SecurityReviewMode.Auto
  const [list, setList] = useState<GoalTemplateList | null>(null)
  const [picked, setPicked] = useState<string>(BLANK)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [brief, setBrief] = useState("")
  const [title, setTitle] = useState("")
  const [budget, setBudget] = useState("")
  const [review, setReview] = useState<SecurityReviewMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [when, setWhen] = useState<ScheduleWhen>(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return { type: "once", at: d.toISOString() }
  })

  useEffect(() => {
    goalTemplateApi
      .list()
      .then(setList)
      .catch(() => setList({ templates: [], builtIn: true }))
  }, [])

  const template = list?.templates.find((t) => t.id === picked)
  const reviewMode = review ?? template?.securityReview ?? teamDefault
  const missing = template ? template.fields.filter((f) => f.required && !fields[f.id]?.trim()) : []
  const ready = template ? missing.length === 0 : !!brief.trim()
  const budgetUsd = budget.trim() ? Number(budget) : undefined
  const budgetBad = budgetUsd !== undefined && (!Number.isFinite(budgetUsd) || budgetUsd <= 0)

  const pick = (t: GoalTemplate | null) => {
    setPicked(t?.id ?? BLANK)
    setFields({})
    setReview(null)
    setBudget(t?.budgetUsd ? String(t.budgetUsd) : "")
  }

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!ready || busy || budgetBad) return
    setBusy(true)
    try {
      const goal = await goalApi.create(brief.trim(), title.trim() || undefined, reviewMode, undefined, {
        ...(template ? { templateId: template.id, fields } : {}),
        ...(budgetUsd ? { budgetUsd } : {}),
      })
      showOnTasks({ goalId: goal.id })
      onDone()
      toast.success(`${goal.id} started`, { description: "The Planner is breaking it into tasks." })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Same goal, started by a schedule instead of now. */
  const scheduleGoal = async () => {
    const what = brief.trim() || template?.name || ""
    if (!what) return
    setBusy(true)
    try {
      await automationApi.createSchedule({
        name: (title.trim() || (template ? `${template.name}: ${Object.values(fields)[0] ?? ""}` : what)).slice(0, 120),
        when,
        action: {
          type: "goal",
          brief: what,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(template ? { templateId: template.id, fields } : {}),
          ...(budgetUsd ? { budgetUsd } : {}),
        },
      })
      toast.success(when.type === "once" ? `Goal scheduled for ${formatAt(when.at)}` : `Goal scheduled: ${when.label}`)
      setScheduling(false)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const saveDefaults = async () => {
    try {
      setList(await goalTemplateApi.saveDefaults())
      toast.success("Templates saved to .agentroom/goal-templates", { description: "Edit them there; the team gets the same set." })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>New goal</DialogTitle>
        <DialogDescription>Pick a template or start blank. The Planner turns it into tasks; nothing is built until you approve them.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label>Start from</Label>
          {list?.builtIn && list.templates.length > 0 && (
            <button type="button" onClick={saveDefaults} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Save templates to the repo to edit them
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Goal template">
          {(list?.templates ?? []).map((t) => (
            <TemplateCard key={t.id} icon={ICONS[t.icon ?? ""] ?? SparklesIcon} title={t.name} text={t.description} on={picked === t.id} onClick={() => pick(t)} />
          ))}
          <TemplateCard icon={FilePenLineIcon} title="Blank" text="Describe it in your own words." on={picked === BLANK} onClick={() => pick(null)} />
        </div>
      </div>

      {template ? (
        <div className="grid gap-3">
          {template.fields.map((f) => (
            <div key={f.id} className="grid gap-1.5">
              <Label htmlFor={`tpl-${f.id}`}>
                {f.label}
                {!f.required && <span className="font-normal text-muted-foreground"> (optional)</span>}
              </Label>
              {f.multiline ? (
                <Textarea id={`tpl-${f.id}`} rows={3} value={fields[f.id] ?? ""} placeholder={f.placeholder} onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })} />
              ) : (
                <Input id={`tpl-${f.id}`} value={fields[f.id] ?? ""} placeholder={f.placeholder} onChange={(e) => setFields({ ...fields, [f.id]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor="goal-extra">
              Anything else <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id="goal-extra" rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="Links, files to read, constraints" />
          </div>
        </div>
      ) : (
        <div className="grid gap-1.5">
          <Label htmlFor="goal-brief">What should the team do?</Label>
          <Textarea
            id="goal-brief"
            autoFocus
            rows={5}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit()
            }}
            placeholder="Add a dark mode toggle to the settings page, persisted per user…"
          />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="goal-title">
            Title <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From the brief" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="goal-budget">
            Budget <span className="font-normal text-muted-foreground">(USD, optional)</span>
          </Label>
          <Input id="goal-budget" type="number" inputMode="decimal" min="0" step="0.5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Team default" aria-invalid={budgetBad || undefined} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="goal-security">Security review</Label>
          <ReviewModeSelect id="goal-security" size="default" value={reviewMode} onChange={setReview} className="w-full" />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{REVIEW_MODE_META[reviewMode].description}</p>

      <DialogFooter className="items-center">
        {template && missing.length > 0 && <span className="mr-auto text-xs text-muted-foreground">Fill in: {missing.map((f) => f.label).join(", ")}</span>}
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Popover open={scheduling} onOpenChange={setScheduling}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" disabled={!ready || busy || budgetBad}>
              <CalendarClockIcon data-icon="inline-start" /> Schedule…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3 p-3">
            <p className="text-sm font-medium">Start this goal later</p>
            <WhenPicker value={when} onChange={setWhen} />
            <Button type="button" className="w-full" onClick={scheduleGoal} disabled={busy}>
              <CalendarClockIcon data-icon="inline-start" /> Schedule goal
            </Button>
          </PopoverContent>
        </Popover>
        <Button type="submit" disabled={!ready || busy || budgetBad}>
          <RocketIcon data-icon="inline-start" /> Start goal
        </Button>
      </DialogFooter>
    </form>
  )
}

function TemplateCard({ icon: Icon, title, text, on, onClick }: { icon: LucideIcon; title: string; text: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60",
        on ? "tone-brand tone-soft" : "bg-surface"
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className={cn("size-4", on ? "text-brand" : "text-muted-foreground")} /> {title}
      </span>
      <span className="text-xs text-muted-foreground">{text}</span>
    </button>
  )
}
