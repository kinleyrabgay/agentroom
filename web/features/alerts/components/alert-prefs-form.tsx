"use client"

import { Volume2Icon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AlertPrefsState } from "../hooks/use-alert-prefs"

/** OS notification / sound / voice switches. Shared by the inbox popover and the Settings page. */
export function AlertPrefsForm({ state, compact = false }: { state: AlertPrefsState; compact?: boolean }) {
  const { prefs: p, capabilities: caps, update, test } = state
  if (!p || !caps) return <p className="text-xs text-muted-foreground">Loading…</p>

  return (
    <div className={cn(compact ? "space-y-3" : "space-y-4")}>
      <Row
        id="alert-system"
        label="System notifications"
        hint="Banner in your OS, even with the browser in the background"
        checked={p.system}
        disabled={!caps.system}
        compact={compact}
        onChange={(v) => update({ system: v })}
      />
      <Row id="alert-sound" label="Sound" checked={p.sound} disabled={!caps.sound} compact={compact} onChange={(v) => update({ sound: v })}>
        {caps.sounds.length > 0 && (
          <Select value={p.soundName} onValueChange={(v) => update({ soundName: v })} disabled={!p.sound}>
            <SelectTrigger size="sm" className="h-7 w-28 text-xs" aria-label="Alert sound">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {caps.sounds.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Row>
      <Row
        id="alert-voice"
        label="Speak updates"
        hint={`e.g. "Planner: plan ready for review"`}
        checked={p.voice}
        disabled={!caps.voice}
        compact={compact}
        onChange={(v) => update({ voice: v })}
      />
      <Row
        id="alert-away"
        label="Only when I'm away"
        hint="Stay quiet while an AgentRoom tab is in front"
        checked={p.onlyWhenAway}
        compact={compact}
        onChange={(v) => update({ onlyWhenAway: v })}
      />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button size="xs" variant="outline" onClick={test}>
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
    </div>
  )
}

function Row({
  id,
  label,
  hint,
  checked,
  disabled,
  compact,
  onChange,
  children,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  compact?: boolean
  onChange: (v: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className={cn("flex items-center gap-3", disabled && "opacity-50")}>
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className={cn("font-medium", compact ? "text-xs" : "text-sm")}>
          {label}
        </Label>
        {hint && <p className={cn("leading-snug text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{hint}</p>}
      </div>
      {children}
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  )
}
