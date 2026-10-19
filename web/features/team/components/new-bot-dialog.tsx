"use client"

import { useState } from "react"
import { toast } from "sonner"
import { BotTab } from "@/lib/constants"
import { botApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function NewBotDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [name, setName] = useState("")
  const [role, setRole] = useState("")
  const select = useAppStore((s) => s.select)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const bot = await botApi.create(name.trim(), role.trim() || "custom")
      select(bot.id, BotTab.Config)
      onOpenChange(false)
      setName("")
      setRole("")
      toast.success(`${bot.name} joined the team`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a bot</DialogTitle>
            <DialogDescription>It reports to Team Lead. You can set its prompt, tools and skills next.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="bot-name">Name</Label>
            <Input id="bot-name" autoFocus placeholder="Security Auditor" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-role">Role</Label>
            <Input id="bot-role" placeholder="security" value={role} onChange={(e) => setRole(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!name.trim()}>Create bot</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
