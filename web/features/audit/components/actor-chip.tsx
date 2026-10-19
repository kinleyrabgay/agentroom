import type { AuditActor } from "@shared"
import { ToneBadge } from "@/components/kit/badge"
import { ACTOR_META } from "../lib/meta"

/** Who decided: You (name) · Policy rule · Session rule · Remote · Bot · AgentRoom. */
export function ActorChip({ actor }: { actor: AuditActor }) {
  const meta = ACTOR_META[actor.type]
  return (
    <ToneBadge tone={meta.tone} icon={meta.icon} className="max-w-56 font-normal" aria-label={`${meta.label}: ${actor.name}`}>
      <span className="shrink-0 font-medium">{meta.label}</span>
      {actor.name && <span className="truncate opacity-80">· {actor.name}</span>}
    </ToneBadge>
  )
}
