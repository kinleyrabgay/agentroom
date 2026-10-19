"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PROJECT_DIR, type Bot } from "@shared"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { ModelEffortPicker } from "@/features/models/components/model-effort-picker"
import { CONFIGURABLE_TOOLS, NO_MANAGER } from "../constants"
import { toBotUpdate } from "../lib/to-patch"

/** Edit a bot's identity, model, tools and persona. Saves to its bot.md. */
export function BotConfig({ bot }: { bot: Bot }) {
  const bots = useAppStore((s) => s.bots)
  const select = useAppStore((s) => s.select)
  // Only the user's edits are kept locally; everything else follows the bot live (disk edits, other tabs).
  const [edits, setEdits] = useState<Partial<Bot>>({})
  const draft: Bot = { ...bot, ...edits }
  const dirty = (Object.keys(edits) as (keyof Bot)[]).some((k) => JSON.stringify(edits[k]) !== JSON.stringify(bot[k]))
  const setDraft = (next: Bot) =>
    setEdits(Object.fromEntries((Object.keys(next) as (keyof Bot)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(bot[k])).map((k) => [k, next[k]])))

  const save = async () => {
    try {
      await botApi.update(bot.id, toBotUpdate(draft))
      setEdits({})
      toast.success("Saved to bot.md")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

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
              aria-label="Color"
              title="Color"
              value={draft.color}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              className="h-9 w-full cursor-pointer rounded-md border bg-transparent p-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="cfg-role">Role</Label>
              <Input id="cfg-role" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Reports to</Label>
              <Select value={draft.reportsTo ?? NO_MANAGER} onValueChange={(v) => setDraft({ ...draft, reportsTo: v === NO_MANAGER ? undefined : v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MANAGER}>Nobody (top of the team)</SelectItem>
                  {bots
                    .filter((b) => b.id !== bot.id)
                    .map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.avatar} {b.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
              <ToggleGroupItem key={t.id} value={t.id} size="sm" title={t.hint} className="font-mono text-xs">
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
          <p className="text-xs text-muted-foreground">
            Stored in <code className="font-mono">{PROJECT_DIR}/bots/{bot.dir}/bot.md</code>
          </p>
        </section>
      </div>

      <div className="flex items-center gap-2 border-t px-4 py-3">
        <ConfirmDelete
          title={`Remove ${bot.name}?`}
          description={`Deletes ${PROJECT_DIR}/bots/${bot.dir}. Conversation logs are kept.`}
          label="Remove"
          onConfirm={async () => {
            await botApi.remove(bot.id)
            select(null)
          }}
        />
        <div className="ml-auto flex gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => setEdits({})}>
              Revert
            </Button>
          )}
          <Button onClick={save} disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </div>
    </div>
  )
}
