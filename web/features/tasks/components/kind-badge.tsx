import type { TaskKind } from "@shared"
import { cn } from "@/lib/utils"
import { KIND_META } from "../constants"

export function KindBadge({
  kind,
  className,
}: {
  kind: TaskKind
  className?: string
}) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium",
        meta.className,
        className
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  )
}
