"use client"

import { useState } from "react"
import { toast } from "sonner"
import type { Bot } from "@shared"
import { BotTab } from "@/lib/constants"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/** Prefill for a bot made for a specific job (e.g. fixing Sentry issues). */
export interface NewBotDefaults {
  name: string
  role: string
  /** Persona written to bot.md after creation. */
  prompt?: string
}

/**
 * Create a bot. By default the new bot opens in its Config tab; with `onCreated` the caller decides
 * (e.g. the hand-off form selects it as the target instead).
 */
export function NewBotDialog({
  open,
  onOpenChange,
  defaults,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaults?: NewBotDefaults
  onCreated?: (bot: Bot) => void
}) {
  const [name, setName] = useState(defaults?.name ?? "")
  const [role, setRole] = useState(defaults?.role ?? "")
  const [busy, setBusy] = useState(false)
  const select = useAppStore((s) => s.select)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      let bot = await botApi.create(name.trim(), role.trim() || "custom")
      if (defaults?.prompt) bot = await botApi.update(bot.id, { prompt: defaults.prompt })
      if (onCreated) onCreated(bot)
      else select(bot.id, BotTab.Config)
      onOpenChange(false)
      setName(defaults?.name ?? "")
      setRole(defaults?.role ?? "")
      toast.success(`${bot.name} joined the team`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a bot</DialogTitle>
            <DialogDescription>
              It reports to Team Lead.{" "}
              {defaults?.prompt ? "It starts with a persona for this job; change it any time in its Config tab." : "You can set its prompt, tools and skills next."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="bot-name">Name</Label>
            <Input id="bot-name" autoFocus placeholder="Security Auditor" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-role">Role</Label>
            <Input id="bot-role" placeholder="security" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          {defaults?.prompt && (
            <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{defaults.prompt}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim() || busy}>Create bot</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
