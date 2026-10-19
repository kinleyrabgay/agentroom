"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"
import { SkillScope, type SkillInput } from "@shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ConfirmDelete } from "@/components/shared/confirm-delete"
import { skillStoreFor, type SkillTarget } from "../lib/skill-store"

/** Create or edit a skill, in the shared library or in one bot's own folder. */
export function SkillDialog({ skill, target, onClose }: { skill: SkillInput; target: SkillTarget; onClose: () => void }) {
  const isNew = !skill.name
  const [draft, setDraft] = useState(skill)
  const store = useMemo(() => skillStoreFor(target), [target])
  const owner = target.scope === SkillScope.Bot ? target.bot.name : null

  const save = async () => {
    try {
      await store.save(draft)
      toast.success(isNew ? `Skill “${draft.name}” created` : "Skill saved")
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isNew ? (owner ? `New skill for ${owner}` : "New skill") : <span className="font-mono">{skill.name}</span>}
          </DialogTitle>
          <DialogDescription>
            Saved to <code className="font-mono">{store.pathOf(draft.name)}</code>.{" "}
            {owner ? `Only ${owner} sees it.` : "Assign it to bots from their Skills tab or by dragging it onto them."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {isNew && (
            <div className="grid gap-2">
              <Label htmlFor="skill-name">Name</Label>
              <Input id="skill-name" className="font-mono" placeholder="api-design" value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="skill-desc">When to use</Label>
            <Input id="skill-desc" placeholder="Use when designing or changing HTTP endpoints." value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="skill-body">Instructions</Label>
            <Textarea id="skill-body" spellCheck={false} className="h-80 resize-none font-mono text-xs leading-relaxed"
              value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {isNew ? (
            <span />
          ) : (
            <ConfirmDelete
              title={`Delete skill “${skill.name}”?`}
              description={owner ? `Removes it from ${owner}'s folder.` : "The SKILL.md folder is removed and the skill is unassigned from every bot."}
              onConfirm={async () => {
                await store.remove(skill.name)
                onClose()
              }}
            />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!draft.name.trim()}>Save skill</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
