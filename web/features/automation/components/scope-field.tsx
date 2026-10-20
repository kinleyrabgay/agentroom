"use client"

import { UserIcon, UsersIcon } from "lucide-react"
import type { AutomationOwner, AutomationScope } from "@shared"
import { Label } from "@/components/ui/label"
import { Segmented } from "@/components/kit/segmented"
import { ToneBadge } from "@/components/kit/badge"

/** Who an item belongs to: just this machine, or the team (saved in the repo, runs on its owner's machine). */
export function ScopeField({ value, onChange, owner }: { value: AutomationScope; onChange: (v: AutomationScope) => void; owner?: AutomationOwner }) {
  const who = owner ? firstName(owner) : "your"
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-3">
        <Label className="shrink-0">Save for</Label>
        <Segmented<AutomationScope>
          size="sm"
          aria-label="Save for"
          value={value}
          onChange={onChange}
          options={[
            { value: "personal", label: <><UserIcon className="size-3.5" /> Just me</> },
            { value: "team", label: <><UsersIcon className="size-3.5" /> Team</> },
          ]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {value === "team"
          ? `Team: saved in the repo so everyone sees it; runs only on ${owner ? `${who}'s` : "your"} machine.`
          : "Just me: saved on this machine only, never committed."}
      </p>
    </div>
  )
}

/** "Team · runs on Kinley" (or "runs on Mate's machine" when it isn't yours). */
export function ScopeBadge({ scope, owner, runsHere }: { scope?: AutomationScope; owner?: AutomationOwner; runsHere: boolean }) {
  if (scope !== "team") return null
  const who = owner ? firstName(owner) : "nobody"
  return (
    <ToneBadge tone={runsHere ? "brand" : "neutral"} icon={UsersIcon} size="sm" title={owner ? `${owner.name} <${owner.email}>` : undefined}>
      {runsHere ? `Team · runs on ${who}` : `Team · runs on ${who}'s machine`}
    </ToneBadge>
  )
}

export const firstName = (o: AutomationOwner) => (o.name || o.email).split(/[\s@]/)[0] || o.email
