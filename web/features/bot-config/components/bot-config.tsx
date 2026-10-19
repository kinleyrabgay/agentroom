"use client"

import { useEffect, useState } from "react"
import { PROJECT_DIR, type Bot } from "@shared"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { Dropdown } from "@/components/kit/dropdown"
import { SaveIndicator, type SaveState } from "@/components/kit/save-indicator"
import { ModelEffortPicker } from "@/features/models/components/model-effort-picker"
import { CONFIGURABLE_TOOLS, NO_MANAGER } from "../constants"
import { toBotUpdate } from "../lib/to-patch"

/** Wait this long after the last keystroke before saving. */
const AUTOSAVE_MS = 600

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Edit a bot's identity, model, tools and persona. Saves to its bot.md as you type. */
export function BotConfig({ bot }: { bot: Bot }) {
  const bots = useAppStore((s) => s.bots)
  const select = useAppStore((s) => s.select)
  // Only the user's edits are kept locally; everything else follows the bot live (disk edits, other tabs).
  const [edits, setEdits] = useState<Partial<Bot>>({})
  const [saveState, setSaveState] = useState<SaveState>("idle")
  const draft: Bot = { ...bot, ...edits }
  const setDraft = (next: Bot) =>
    setEdits(Object.fromEntries((Object.keys(next) as (keyof Bot)[]).filter((k) => !same(next[k], bot[k])).map((k) => [k, next[k]])))

  // Debounced save of whatever changed; edits that land on disk drop out of `edits` by themselves.
  const dirty = Object.keys(edits).length > 0
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(async () => {
      const sent: Bot = { ...bot, ...edits }
      setSaveState("saving")
      try {
        await botApi.update(bot.id, toBotUpdate(sent))
        // Keep only what changed again while the request was in flight.
        setEdits((cur) => Object.fromEntries(Object.entries(cur).filter(([k, v]) => !same(v, sent[k as keyof Bot]))))
        setSaveState("saved")
      } catch {
        setSaveState("error")
      }
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [edits, dirty, bot])

  const managers = [
    { label: "Nobody (top of the team)", value: NO_MANAGER },
    ...bots.filter((b) => b.id !== bot.id).map((b) => ({ label: `${b.avatar} ${b.name}`, value: b.id, sublabel: b.role })),
  ]

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        <section className="grid gap-4">
          <div className="grid grid-cols-[64px_1fr_48px] items-end gap-2">
            <div className="grid gap-2">
              <Label htmlFor="cfg-avatar">Icon</Label>
              <Input id="cfg-avatar" className="text-center text-lg" value={draft.avatar} onChange={(e) => setDraft({ ...draft, avatar: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="cfg-name">Name</Label>
              <Input id="cfg-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <input
              type="color"
              aria-label="Colour"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              className="h-9 w-full cursor-pointer rounded-full border bg-transparent p-1 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch-wrapper]:p-0.5 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="cfg-role">Role</Label>
              <Input id="cfg-role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Reports to</Label>
              <Dropdown<string>
                datas={managers}
                selectedValue={draft.reportsTo ?? NO_MANAGER}
                onSelect={(v) => setDraft({ ...draft, reportsTo: v === NO_MANAGER ? undefined : (v as string) })}
                hint="Search bots…"
                showSearch={managers.length > 6}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Model and effort</Label>
            <ModelEffortPicker
              value={{ model: draft.model, effort: draft.effort }}
              onChange={(v) => setDraft({ ...draft, model: v.model, effort: v.effort })}
            />
          </div>
        </section>

        <Separator />

        <section className="grid gap-2">
          <Label>Tools</Label>
          <ToggleGroup type="multiple" variant="outline" spacing={2} className="flex-wrap" value={draft.tools} onValueChange={(tools) => setDraft({ ...draft, tools })}>
            {CONFIGURABLE_TOOLS.map((t) => (
              <ToggleGroupItem key={t.id} value={t.id} size="sm" aria-label={`${t.id}: ${t.hint}`} className="font-mono text-xs">
                {t.id}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">Edit, Write, Bash and browser actions still ask for your approval unless the project is in auto mode.</p>
        </section>

        <Separator />

        <section className="grid gap-2">
          <Label htmlFor="cfg-prompt">Persona and instructions</Label>
          <Textarea
            id="cfg-prompt"
            spellCheck={false}
            className="min-h-64 font-mono text-xs leading-relaxed"
            value={draft.prompt}
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
        </section>
      </div>

      <div className="flex items-center gap-3 border-t px-4 py-3">
        <ConfirmDelete
          title={`Remove ${bot.name}?`}
          description={`Deletes ${PROJECT_DIR}/bots/${bot.dir}. Conversation logs are kept.`}
          label="Remove"
          onConfirm={async () => {
            await botApi.remove(bot.id)
            select(null)
          }}
        />
        <p className="ml-auto truncate text-xs text-muted-foreground">
          Saves to <code className="font-mono">{PROJECT_DIR}/bots/{bot.dir}/bot.md</code>
        </p>
        <SaveIndicator state={dirty && saveState !== "saving" ? "saving" : saveState} />
      </div>
    </div>
  )
}
