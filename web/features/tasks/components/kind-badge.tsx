import type { TaskKind } from "@shared"
import { ToneBadge } from "@/components/kit/badge"
import { KIND_META } from "../constants"

export function KindBadge({ kind, className }: { kind: TaskKind; className?: string }) {
  const meta = KIND_META[kind]
  return (
    <ToneBadge tone={meta.tone} icon={meta.icon} size="sm" className={className}>
      {meta.label}
    </ToneBadge>
  )
}
