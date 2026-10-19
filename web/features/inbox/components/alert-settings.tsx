"use client"

import { useEffect, useState } from "react"
import { BellRingIcon, ChevronDownIcon, Volume2Icon } from "lucide-react"
import { toast } from "sonner"
import type { AlertCapabilities, AlertPrefs } from "@shared"
import { cn } from "@/lib/utils"
import { alertApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Loaded = { prefs: AlertPrefs; capabilities: AlertCapabilities }

/** Inbox footer: how AgentRoom reaches you when you're not looking at it (OS notification, sound, voice). */
export function AlertSettings() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<Loaded | null>(null)

  useEffect(() => {
    if (open && !data) alertApi.get().then(setData).catch((e) => toast.error((e as Error).message))
  }, [open, data])

  const set = async (patch: Partial<AlertPrefs>) => {
    if (!data) return
    setData({ ...data, prefs: { ...data.prefs, ...patch } })
    try {
      await alertApi.update(patch)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const caps = data?.capabilities
  const p = data?.prefs

  return (
    <div className="border-t">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      >
        <BellRingIcon className="size-3.5" />
        Alerts when you&apos;re away
        <ChevronDownIcon className={cn("ml-auto size-3.5 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="space-y-3 px-3 pt-1 pb-3">
          {!p || !caps ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : (
            <>
              <Row id="alert-system" label="System notifications" hint="Banner in your OS, even with the browser in the background" checked={p.system} disabled={!caps.system} onChange={(v) => set({ system: v })} />
              <Row id="alert-sound" label="Sound" checked={p.sound} disabled={!caps.sound} onChange={(v) => set({ sound: v })}>
                {caps.sounds.length > 0 && (
                  <Select value={p.soundName} onValueChange={(v) => set({ soundName: v })} disabled={!p.sound}>
                    <SelectTrigger size="sm" className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {caps.sounds.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </Row>
              <Row id="alert-voice" label="Speak updates" hint={`e.g. "Planner: plan ready for review"`} checked={p.voice} disabled={!caps.voice} onChange={(v) => set({ voice: v })} />
              <Row id="alert-away" label="Only when I'm away" hint="Stay quiet while this tab is in front" checked={p.onlyWhenAway} onChange={(v) => set({ onlyWhenAway: v })} />
              <div className="flex items-center gap-2 pt-1">
                <Button size="xs" variant="outline" onClick={() => alertApi.test().catch((e) => toast.error((e as Error).message))}>
                  <Volume2Icon data-icon="inline-start" /> Send a test alert
                </Button>
                {caps.platform === "darwin" && !caps.clickToOpen && (
                  <span className="text-[10px] leading-tight text-muted-foreground">
                    Tip: <code className="font-mono">brew install terminal-notifier</code> to open AgentRoom by clicking an alert.
                  </span>
                )}
                {!caps.system && !caps.sound && !caps.voice && (
                  <span className="text-[10px] text-muted-foreground">Not supported on {caps.platform}; the inbox still works.</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Row({ id, label, hint, checked, disabled, onChange, children }: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="text-xs font-medium">{label}</Label>
        {hint && <p className="text-[11px] leading-snug text-muted-foreground">{hint}</p>}
      </div>
      {children}
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}
