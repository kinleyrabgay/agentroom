import { BotStatus } from "@shared"
import { isBusy, STATUS_META } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { ToneDot } from "@/components/kit/badge"

/** A bot's live status as a tone dot (pulses while busy). */
export function StatusDot({ botId, className }: { botId: string; className?: string }) {
  const status = useAppStore((s) => s.statuses[botId]?.status ?? BotStatus.Idle)
  return <ToneDot tone={STATUS_META[status].tone} pulse={isBusy(status)} className={className} />
}
