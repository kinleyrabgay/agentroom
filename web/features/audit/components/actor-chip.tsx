import type { AuditActor } from "@shared"
import { cn } from "@/lib/utils"
import { ACTOR_META } from "../lib/meta"

/** Who decided: You (name) · Policy rule · Session rule · Remote · Bot · AgentRoom. */
export function ActorChip({ actor }: { actor: AuditActor }) {
  const meta = ACTOR_META[actor.type]
  const Icon = meta.icon
  return (
    <span
      title={`${meta.label}: ${actor.name}`}
      className={cn("inline-flex max-w-52 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", meta.className)}
    >
      <Icon className="size-3 shrink-0" />
      <span className="shrink-0 font-medium">{meta.label}</span>
      {actor.name && <span className="truncate opacity-80">· {actor.name}</span>}
    </span>
  )
}
