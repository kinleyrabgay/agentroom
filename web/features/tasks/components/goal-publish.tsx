"use client"

import { useEffect, useState } from "react"
import { ExternalLinkIcon, FolderXIcon, GitBranchIcon, GitMergeIcon, GitPullRequestIcon, Loader2Icon, MoreHorizontalIcon } from "lucide-react"
import { toast } from "sonner"
import { GoalStatus, type Goal, type PrDraft } from "@shared"
import { goalWorkApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToneBadge } from "@/components/kit/badge"
import { isRunning } from "../lib/goal-phase"

/** "⎇ agentroom/g-4 · own folder": where the goal's work lives. */
export function GoalBranch({ goal }: { goal: Goal }) {
  if (!goal.worktree) {
    if (!goal.worktreeWarning) return null
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <ToneBadge tone="warning" icon={GitBranchIcon}>Your folder</ToneBadge>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{goal.worktreeWarning}</TooltipContent>
      </Tooltip>
    )
  }
  const removed = !!goal.worktreeWarning
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <ToneBadge icon={GitBranchIcon} className="font-mono">
            {goal.worktree.branch} · {removed ? "folder removed" : "own folder"}
          </ToneBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {removed ? goal.worktreeWarning : "Bots work in their own copy of the repo on this branch, so your working copy is never touched."}
      </TooltipContent>
    </Tooltip>
  )
}

const run = (p: Promise<unknown>, ok?: string) =>
  p.then(() => ok && toast.success(ok)).catch((e: Error) => toast.error(e.message))

/** Open PR (primary once testing or done), the PR link once open, and Merge locally / Clean up. */
export function PublishActions({ goal }: { goal: Goal }) {
  const [prOpen, setPrOpen] = useState(false)
  if (!goal.worktree) return null
  const ready = goal.status === GoalStatus.Done || goal.status === GoalStatus.Testing || goal.status === GoalStatus.Reporting
  const busy = isRunning(goal.status) && goal.status !== GoalStatus.Testing

  return (
    <div className="flex items-center gap-1.5">
      {goal.pr ? (
        <Button size="sm" variant="outline" asChild>
          <a href={goal.pr.url} target="_blank" rel="noreferrer">
            <GitPullRequestIcon data-icon="inline-start" /> PR {goal.pr.number ? `#${goal.pr.number}` : ""}
            <ExternalLinkIcon data-icon="inline-end" />
          </a>
        </Button>
      ) : (
        <Button size="sm" variant={ready ? "default" : "outline"} className={ready ? "bg-brand text-brand-foreground hover:bg-brand/90" : undefined} disabled={busy} onClick={() => setPrOpen(true)}>
          <GitPullRequestIcon data-icon="inline-start" /> Open PR
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="More branch actions">
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={busy} onSelect={() => run(goalWorkApi.mergeLocal(goal.id), `Merged ${goal.worktree!.branch} into your current branch`)}>
            <GitMergeIcon /> Merge into my branch
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => run(goalWorkApi.cleanup(goal.id), "Folder removed; the branch is kept")}>
            <FolderXIcon /> Remove the goal&apos;s folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {prOpen && <PrDialog goal={goal} onClose={() => setPrOpen(false)} />}
    </div>
  )
}

function PrDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const [draft, setDraft] = useState<PrDraft | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [isDraft, setIsDraft] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    goalWorkApi
      .prDraft(goal.id)
      .then((d) => {
        if (cancelled) return
        setDraft(d)
        setTitle(d.title)
        setBody(d.body)
      })
      .catch((e: Error) => toast.error(e.message))
    return () => {
      cancelled = true
    }
  }, [goal.id])

  const submit = async () => {
    setBusy(true)
    try {
      const next = await goalWorkApi.openPr(goal.id, { title, body, draft: isDraft })
      toast.success("Pull request opened", {
        description: next.pr?.url,
        action: next.pr ? { label: "Open", onClick: () => window.open(next.pr!.url, "_blank", "noopener") } : undefined,
      })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Open pull request</DialogTitle>
          <DialogDescription>
            Pushes <span className="font-mono">{goal.worktree?.branch}</span> to origin and opens a PR with your GitHub login.
          </DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" /> Preparing the description…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pr-title">Title</Label>
              <Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-body">Description</Label>
              <Textarea id="pr-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-xs leading-relaxed" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={draft.openFindings ? "warning" : "success"} dot>
                {draft.openFindings ? `${draft.openFindings} open security ${draft.openFindings === 1 ? "finding" : "findings"}` : "Scanner clean"}
              </ToneBadge>
              {draft.tests && <ToneBadge tone={draft.tests.startsWith("QA passed") ? "success" : "warning"} dot>{draft.tests}</ToneBadge>}
              <label className="ml-auto flex items-center gap-2 text-sm">
                <Switch checked={isDraft} onCheckedChange={setIsDraft} /> Draft
              </label>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!draft || busy || !title.trim()}>
            {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <GitPullRequestIcon data-icon="inline-start" />}
            Push and open PR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
