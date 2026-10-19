import type { McpStatus } from "@shared"
import { cn } from "@/lib/utils"
import { ToneBadge } from "@/components/kit/badge"
import { STATUS_META } from "../lib/meta"

export function StatusBadge({ status, className }: { status: McpStatus; className?: string }) {
  const meta = STATUS_META[status]
  const Icon = meta.icon
  return (
    <ToneBadge tone={meta.tone} className={className}>
      <Icon className={cn("size-3.5 shrink-0", meta.spin && "animate-spin")} aria-hidden />
      {meta.label}
    </ToneBadge>
  )
}
