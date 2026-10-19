import { BotStatus } from "@shared"
import { cn } from "@/lib/utils"
import { isBusy, STATUS_META } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

export function StatusDot({ botId, className }: { botId: string; className?: string }) {
  const status = useAppStore((s) => s.statuses[botId]?.status ?? BotStatus.Idle)
  return <span className={cn("inline-block size-1.5 rounded-full", STATUS_META[status].dot, isBusy(status) && "animate-pulse", className)} />
}
