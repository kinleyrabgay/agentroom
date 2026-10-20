"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { FlaskConicalIcon, HistoryIcon, LightbulbIcon, PauseIcon, PlayIcon, PlusIcon, RotateCwIcon, Trash2Icon, TrophyIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { EvalRun, ExperimentResult, Suggestion, WorkPhase } from "@shared"
import { GoalStatus } from "@shared"
import { cn } from "@/lib/utils"
import { engineApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Markdown } from "@/components/shared/markdown"
import { ToneBadge } from "@/components/kit/badge"
import { Dropdown } from "@/components/kit/dropdown"
import { EmptyState, ErrorState } from "@/components/kit/state-view"

const PHASE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Every phase" },
  { value: "planning", label: "Planning" },
  { value: "build", label: "Build" },
  { value: "security", label: "Security review" },
  { value: "testing", label: "Testing" },
  { value: "reporting", label: "Reporting" },
]

const usd = (n: number | null) => (n === null ? "–" : n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`)
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`)
const run = (p: Promise<unknown>) => p.catch((e: Error) => toast.error(e.message))

/** Insights → Experiments: suggestions, A/B tests on bots, and replay evals of past plans. */
export function ExperimentsPanel() {
  const [results, setResults] = useState<ExperimentResult[] | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [evals, setEvals] = useState<EvalRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [replaying, setReplaying] = useState(false)
  const [comparing, setComparing] = useState<EvalRun | null>(null)

  const load = useCallback(
    () =>
      Promise.all([engineApi.experiments(), engineApi.suggestions(), engineApi.evals()])
        .then(([r, s, e]) => {
          setResults(r)
          setSuggestions(s)
          setEvals(e)
          setError(null)
        })
        .catch((err: Error) => setError(err.message)),
    []
  )

  useEffect(() => {
    void load()
  }, [load])

  // Poll while a replay is running.
  const running = evals.some((e) => e.status === "running")
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void engineApi.evals().then(setEvals).catch(() => {}), 3000)
    return () => clearInterval(t)
  }, [running])

  const refreshOutcomes = async () => {
    setRefreshing(true)
    try {
      await engineApi.refreshOutcomes()
      await load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  if (error && !results) return <ErrorState error={error} onRetry={() => void load()} />
  if (!results)
    return (
      <div className="space-y-5" role="status" aria-label="Loading experiments">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          A goal counts as a success when it finished, its PR wasn&apos;t closed unmerged and it wasn&apos;t reverted. PR state is read with gh, never written.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refreshOutcomes()} disabled={refreshing}>
          <RotateCwIcon className={cn(refreshing && "animate-spin")} data-icon="inline-start" /> Check outcomes
        </Button>
      </div>

      {suggestions.length > 0 && (
        <Section title="Suggestions" icon={LightbulbIcon} aside={`${suggestions.length}`}>
          <ul className="divide-y">
            {suggestions.map((s) => (
              <SuggestionRow key={s.id} s={s} onDone={load} />
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Experiments"
        icon={FlaskConicalIcon}
        action={
          <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" /> New experiment
          </Button>
        }
      >
        {results.length ? (
          <ul className="divide-y">
            {results.map((r) => (
              <ExperimentRow key={r.experiment.id} r={r} onChanged={load} />
            ))}
          </ul>
        ) : (
          <EmptyState
            compact
            icon={FlaskConicalIcon}
            title="No experiments yet"
            description="Test a skill or extra instructions on one bot: half the goals get the change, half don't, and the results compare once enough goals finish."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <PlusIcon data-icon="inline-start" /> New experiment
              </Button>
            }
          />
        )}
      </Section>

      <Section
        title="Replay evals"
        icon={HistoryIcon}
        action={
          <Button size="xs" variant="outline" onClick={() => setReplaying(true)} disabled={running}>
            <PlayIcon data-icon="inline-start" /> Replay a goal
          </Button>
        }
      >
        {evals.length ? (
          <ul className="divide-y">
            {evals.map((e) => (
              <EvalRow key={e.id} e={e} onOpen={() => setComparing(e)} />
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Re-run a finished goal&apos;s planning with a change, read-only and under a budget cap, then compare the plans side by side.
          </p>
        )}
      </Section>

      <NewExperimentDialog open={creating} onOpenChange={setCreating} onCreated={load} />
      <ReplayDialog open={replaying} onOpenChange={setReplaying} onStarted={load} />
      <CompareDialog run={comparing} onOpenChange={(v) => !v && setComparing(null)} />
    </div>
  )
}

function Section({ title, icon: Icon, aside, action, children }: { title: string; icon: typeof LightbulbIcon; aside?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-[15px] font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
        {action}
      </header>
      {children}
    </section>
  )
}

function SuggestionRow({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const act = async (fn: () => Promise<{ applied?: string } | unknown>) => {
    setBusy(true)
    try {
      const res = (await fn()) as { applied?: string }
      if (res?.applied) toast.success(res.applied)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{s.title}</p>
        <p className="text-xs text-muted-foreground">{s.why}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Based on {s.evidence.runs} runs · {s.evidence.failures} failed · {usd(s.evidence.costUsd)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {s.kind === "add-skill" && (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act(() => engineApi.applySuggestion(s.id, "experiment"))}>
            Test first
          </Button>
        )}
        <Button size="xs" disabled={busy} onClick={() => void act(() => engineApi.applySuggestion(s.id, "apply"))}>
          Apply
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Dismiss" disabled={busy} onClick={() => void act(() => engineApi.dismissSuggestion(s.id))}>
          <XIcon />
        </Button>
      </div>
    </li>
  )
}

function ExperimentRow({ r, onChanged }: { r: ExperimentResult; onChanged: () => void }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === r.experiment.botId))
  const exp = r.experiment
  const change = exp.variants.find((v) => v.id !== "control")
  const describeChange = [
    ...(change?.addSkills.length ? [`+ ${change.addSkills.join(", ")}`] : []),
    ...(change?.removeSkills.length ? [`− ${change.removeSkills.join(", ")}`] : []),
    ...(change?.promptAppend ? ["extra instructions"] : []),
  ].join(" · ")
  const best = Math.max(...r.variants.map((v) => v.successRate ?? 0))
  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {bot && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{exp.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {bot?.name ?? exp.botId}
            {exp.phase ? ` · ${exp.phase}` : ""} · {describeChange || "no change"} · started {timeAgo(Date.parse(exp.createdAt))}
          </span>
        </span>
        {r.winner ? (
          <ToneBadge tone="success" icon={TrophyIcon} size="sm">
            {r.variants.find((v) => v.variantId === r.winner)?.label} wins
          </ToneBadge>
        ) : (
          <ToneBadge tone={exp.status === "running" ? "brand" : "neutral"} dot pulse={exp.status === "running"} size="sm">
            {exp.status === "running" ? "Running" : "Stopped"}
          </ToneBadge>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={exp.status === "running" ? "Stop" : "Resume"}
          title={exp.status === "running" ? "Stop: new goals stop getting variants" : "Resume"}
          onClick={() => void run(engineApi.updateExperiment(exp.id, { status: exp.status === "running" ? "stopped" : "running" }).then(onChanged))}
        >
          {exp.status === "running" ? <PauseIcon /> : <PlayIcon />}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon-xs" variant="ghost" aria-label="Delete experiment">
              <Trash2Icon />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{exp.name}”?</AlertDialogTitle>
              <AlertDialogDescription>Its assignments and results are removed. Goals and the ledger are not touched.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void run(engineApi.deleteExperiment(exp.id).then(onChanged))}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-sunken text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Variant</th>
              <th className="w-20 px-2 py-1.5 text-right font-medium">Goals</th>
              <th className="w-40 px-2 py-1.5 text-left font-medium">Success</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Avg cost</th>
              <th className="w-24 px-3 py-1.5 text-right font-medium">Fix rounds</th>
            </tr>
          </thead>
          <tbody>
            {r.variants.map((v) => (
              <tr key={v.variantId} className="border-t">
                <td className="px-3 py-2">{v.label}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {v.goals}
                  {v.pending ? <span className="text-muted-foreground"> +{v.pending}</span> : null}
                </td>
                <td className="px-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      <span className={cn("block h-full rounded-full", v.successRate !== null && v.successRate === best && r.ready ? "bg-success" : "bg-muted-foreground/50")} style={{ width: `${Math.round((v.successRate ?? 0) * 100)}%` }} />
                    </span>
                    <span className="tabular-nums">{pct(v.successRate)}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{usd(v.avgCostUsd)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{v.avgReviewRounds === null ? "–" : v.avgReviewRounds.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{r.summary}</p>
    </li>
  )
}

function EvalRow({ e, onOpen }: { e: EvalRun; onOpen: () => void }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === e.botId))
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent" onClick={onOpen} disabled={e.status === "running"}>
        {bot && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">
            <span className="font-mono text-xs text-muted-foreground">{e.goalId}</span> {e.goalTitle}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {e.variant.label} · {e.provider}
            {e.model ? ` · ${e.model}` : ""} · {timeAgo(Date.parse(e.startedAt))}
          </span>
        </span>
        <span className="text-xs tabular-nums text-muted-foreground">{usd(e.costUsd)}</span>
        <ToneBadge tone={e.status === "done" ? "success" : e.status === "failed" ? "danger" : "brand"} dot pulse={e.status === "running"} size="sm">
          {e.status === "done" ? "Compare" : e.status === "failed" ? "Failed" : "Running"}
        </ToneBadge>
      </button>
    </li>
  )
}

/** The change fields shared by experiments and replays: skills to add/remove and extra instructions. */
function ChangeFields({
  botSkills,
  add,
  remove,
  prompt,
  onAdd,
  onRemove,
  onPrompt,
}: {
  botSkills: string[]
  add: string[]
  remove: string[]
  prompt: string
  onAdd: (v: string[]) => void
  onRemove: (v: string[]) => void
  onPrompt: (v: string) => void
}) {
  const library = useAppStore((s) => s.skills)
  const addable = useMemo(() => library.filter((s) => !botSkills.includes(s.name)).map((s) => ({ value: s.name, label: s.name, sublabel: s.description })), [library, botSkills])
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Add skills</Label>
          <Dropdown<string> datas={addable} multiple selectedValue={add} placeholder="None" onSelect={(v) => onAdd(v as string[])} />
        </div>
        <div className="space-y-1.5">
          <Label>Remove skills</Label>
          <Dropdown<string> datas={botSkills.map((s) => ({ value: s, label: s }))} multiple selectedValue={remove} placeholder="None" onSelect={(v) => onRemove(v as string[])} disabled={!botSkills.length} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="change-prompt">Extra instructions</Label>
        <Textarea id="change-prompt" rows={3} value={prompt} placeholder="e.g. Always list the migrations a task needs before the code changes." onChange={(e) => onPrompt(e.target.value)} />
      </div>
    </>
  )
}

function NewExperimentDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const bots = useAppStore((s) => s.bots)
  const [name, setName] = useState("")
  const [botId, setBotId] = useState("")
  const [phase, setPhase] = useState("")
  const [add, setAdd] = useState<string[]>([])
  const [remove, setRemove] = useState<string[]>([])
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const bot = bots.find((b) => b.id === botId)
  const valid = !!botId && (add.length > 0 || remove.length > 0 || prompt.trim().length > 0)

  const reset = () => {
    setName("")
    setBotId("")
    setPhase("")
    setAdd([])
    setRemove([])
    setPrompt("")
  }
  const create = async () => {
    setBusy(true)
    try {
      const label = add.length ? `+ ${add.join(", ")}` : remove.length ? `− ${remove.join(", ")}` : "With instructions"
      await engineApi.createExperiment({
        name: name.trim() || `${bot?.name ?? botId}: ${label}`,
        botId,
        ...(phase ? { phase: phase as WorkPhase } : {}),
        change: { label, addSkills: add, removeSkills: remove, promptAppend: prompt },
      })
      toast.success("Experiment started. New goals alternate between the two variants.")
      reset()
      onOpenChange(false)
      onCreated()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New experiment</DialogTitle>
          <DialogDescription>New goals alternate between the bot as it is and the bot with your change. Each goal keeps its variant for every run.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Bot</Label>
              <Dropdown<string>
                datas={bots.map((b) => ({ value: b.id, label: b.name, sublabel: b.role }))}
                selectedValue={botId || undefined}
                placeholder="Choose a bot"
                onSelect={(v) => {
                  setBotId(v as string)
                  setRemove([])
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phase</Label>
              <Dropdown<string> datas={PHASE_OPTIONS} selectedValue={phase} showSearch={false} onSelect={(v) => setPhase(v as string)} />
            </div>
          </div>
          <ChangeFields botSkills={bot?.skills ?? []} add={add} remove={remove} prompt={prompt} onAdd={setAdd} onRemove={setRemove} onPrompt={setPrompt} />
          <div className="space-y-1.5">
            <Label htmlFor="exp-name">Name</Label>
            <Input id="exp-name" value={name} placeholder="Optional" onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void create()} disabled={!valid || busy}>
            Start experiment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReplayDialog({ open, onOpenChange, onStarted }: { open: boolean; onOpenChange: (v: boolean) => void; onStarted: () => void }) {
  const goals = useAppStore((s) => s.goals)
  const bots = useAppStore((s) => s.bots)
  const eligible = useMemo(() => [...goals].reverse().filter((g) => g.status === GoalStatus.Done && g.plan.trim() && g.baseRef), [goals])
  const planner = bots.find((b) => b.role.toLowerCase() === "planner")
  const [goalId, setGoalId] = useState("")
  const [add, setAdd] = useState<string[]>([])
  const [remove, setRemove] = useState<string[]>([])
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const valid = !!goalId && (add.length > 0 || remove.length > 0 || prompt.trim().length > 0)

  const start = async () => {
    setBusy(true)
    try {
      const label = add.length ? `+ ${add.join(", ")}` : remove.length ? `− ${remove.join(", ")}` : "With instructions"
      await engineApi.startEval({ goalId, variant: { label, addSkills: add, removeSkills: remove, promptAppend: prompt } })
      toast.success("Replay started. It only reads the code.")
      setGoalId("")
      setAdd([])
      setRemove([])
      setPrompt("")
      onOpenChange(false)
      onStarted()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Replay a goal&apos;s planning</DialogTitle>
          <DialogDescription>
            {planner?.name ?? "The Planner"} plans the goal again with your change, in a throwaway copy at the goal&apos;s starting commit. Read-only, capped by the eval budget in Settings.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Goal</Label>
            <Dropdown<string>
              datas={eligible.map((g) => ({ value: g.id, label: `${g.id} ${g.title}` }))}
              selectedValue={goalId || undefined}
              placeholder={eligible.length ? "Choose a finished goal" : "No finished goals with a plan yet"}
              disabled={!eligible.length}
              onSelect={(v) => setGoalId(v as string)}
            />
          </div>
          <ChangeFields botSkills={planner?.skills ?? []} add={add} remove={remove} prompt={prompt} onAdd={setAdd} onRemove={setRemove} onPrompt={setPrompt} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={!valid || busy}>
            Replay
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CompareDialog({ run: r, onOpenChange }: { run: EvalRun | null; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={!!r} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        {r && (
          <>
            <DialogHeader>
              <DialogTitle>
                {r.goalId} · {r.variant.label}
              </DialogTitle>
              <DialogDescription>
                {r.provider}
                {r.model ? ` · ${r.model}` : ""} · {usd(r.costUsd)}
                {r.error ? ` · ${r.error}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="grid max-h-[65vh] gap-4 overflow-y-auto md:grid-cols-2">
              <Column title="Original plan" text={r.original} />
              <Column title={`With ${r.variant.label}`} text={r.output || "_No output._"} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Column({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0 rounded-xl border">
      <p className="sticky top-0 border-b bg-sunken px-3 py-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="prose-sm px-3 py-2 text-sm">
        <Markdown text={text} />
      </div>
    </div>
  )
}
