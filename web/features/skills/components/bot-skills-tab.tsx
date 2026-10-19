"use client"

import { useMemo, useState } from "react"
import { CopyIcon, FolderIcon, PencilIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { PROJECT_DIR, SkillScope, type Bot, type Skill, type SkillInput } from "@shared"
import { cn } from "@/lib/utils"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
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
import { assignSkill, unassignSkill } from "../lib/assign"
import { NEW_SKILL } from "../lib/skill-store"
import { SkillDialog } from "./skill-dialog"

const SEARCH_THRESHOLD = 6

/** Bot panel tab: pick library skills with checkboxes, and manage the bot's own skills. */
export function BotSkillsTab({ bot }: { bot: Bot }) {
  const [editing, setEditing] = useState<SkillInput | null>(null)
  const target = useMemo(() => ({ scope: SkillScope.Bot, bot }) as const, [bot])

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-6 p-4">
        <LibrarySection bot={bot} />
        <Separator />
        <OwnSection bot={bot} onEdit={setEditing} />
      </div>
      {editing && <SkillDialog skill={editing} target={target} onClose={() => setEditing(null)} />}
    </div>
  )
}

function SectionHeader({ title, hint, action }: { title: string; hint: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  )
}

function LibrarySection({ bot }: { bot: Bot }) {
  const skills = useAppStore((s) => s.skills)
  const [q, setQ] = useState("")
  const shown = skills.filter((s) => (s.name + s.description).toLowerCase().includes(q.toLowerCase()))
  const ownNames = new Set(bot.localSkills.map((s) => s.name))

  const toggle = (name: string, on: boolean) => (on ? assignSkill(bot, name) : unassignSkill(bot, name))

  const customize = async (name: string) => {
    try {
      await botApi.customizeSkill(bot.id, name)
      toast.success(`“${name}” copied into ${bot.name}'s skills`, { description: "Edit it below; the library version is unchanged." })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <section>
      <SectionHeader
        title="Library skills"
        hint={
          <>
            Shared skills in <code className="font-mono">{PROJECT_DIR}/skills/</code>. Tick the ones {bot.name} should use.
          </>
        }
        action={<Badge variant="secondary">{bot.skills.length} on</Badge>}
      />
      {skills.length > SEARCH_THRESHOLD && (
        <div className="relative mb-2">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter skills" className="h-8 pl-8" />
        </div>
      )}
      {!skills.length ? (
        <p className="text-xs text-muted-foreground">No library skills yet. Create one from the sidebar.</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {shown.map((s) => {
            const on = bot.skills.includes(s.name)
            const id = `skill-${bot.id}-${s.name}`
            return (
              <li key={s.name} className={cn("flex items-start gap-3 px-3 py-2.5 transition-colors", on && "bg-muted/30")}>
                <Checkbox id={id} checked={on} onCheckedChange={(v) => toggle(s.name, v === true)} className="mt-0.5" />
                <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                  <div className="font-mono text-xs font-medium">{s.name}</div>
                  <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
                </label>
                {on && !ownNames.has(s.name) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="xs" onClick={() => customize(s.name)}>
                        <CopyIcon data-icon="inline-start" /> Customize
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Make a private copy for this bot to edit</TooltipContent>
                  </Tooltip>
                )}
                {ownNames.has(s.name) && (
                  <Badge variant="outline" className="border-dashed text-xs font-normal">customized</Badge>
                )}
              </li>
            )
          })}
          {!shown.length && <li className="px-3 py-4 text-center text-xs text-muted-foreground">No matches</li>}
        </ul>
      )}
    </section>
  )
}

function OwnSection({ bot, onEdit }: { bot: Bot; onEdit: (s: SkillInput) => void }) {
  return (
    <section>
      <SectionHeader
        title={`${bot.name}'s own skills`}
        hint={
          <>
            Private to {bot.name}, stored in <code className="font-mono">{PROJECT_DIR}/bots/{bot.dir}/skills/</code>.
          </>
        }
        action={
          <Button size="sm" variant="outline" onClick={() => onEdit(NEW_SKILL)}>
            <PlusIcon data-icon="inline-start" /> New skill
          </Button>
        }
      />
      {!bot.localSkills.length ? (
        <Empty className="rounded-xl border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon"><FolderIcon /></EmptyMedia>
            <EmptyTitle className="text-sm">No own skills yet</EmptyTitle>
            <EmptyDescription className="text-xs">
              Write one just for {bot.name}, or customize a library skill above.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="divide-y rounded-xl border">
          {bot.localSkills.map((s) => (
            <OwnSkillRow key={s.name} bot={bot} skill={s} onEdit={() => onEdit(s)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function OwnSkillRow({ bot, skill, onEdit }: { bot: Bot; skill: Skill; onEdit: () => void }) {
  const remove = () => botApi.deleteSkill(bot.id, skill.name).catch((e) => toast.error((e as Error).message))
  return (
    <li className="group flex items-start gap-3 px-3 py-2.5">
      <SparklesIcon className="mt-0.5 size-4 shrink-0" style={{ color: bot.color }} />
      <button onClick={onEdit} className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
        <div className="font-mono text-xs font-medium">{skill.name}</div>
        <div className="line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
      </button>
      <Button variant="ghost" size="icon-xs" onClick={onEdit} aria-label={`Edit ${skill.name}`}>
        <PencilIcon />
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="tone-danger tone-text" aria-label={`Delete ${skill.name}`}>
            <Trash2Icon />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{skill.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes <code className="font-mono">{PROJECT_DIR}/bots/{bot.dir}/skills/{skill.name}</code>. This can&apos;t be undone (unless it&apos;s committed to git).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}
