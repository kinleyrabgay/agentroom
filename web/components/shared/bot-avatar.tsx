import { BotStatus, type Bot } from "@shared"
import { cn } from "@/lib/utils"
import { STATUS_META } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** Emoji tile tinted with the bot's color; optionally shows its live status dot. */
export function BotAvatar({ bot, className, showStatus = false }: { bot: Bot; className?: string; showStatus?: boolean }) {
  const status = useAppStore((s) => s.statuses[bot.id]?.status ?? BotStatus.Idle)
  return (
    <span
      className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg text-base", className)}
      style={{
        background: `color-mix(in oklch, ${bot.color} 18%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${bot.color} 35%, transparent)`,
      }}
    >
      {bot.avatar}
      {showStatus && (
        <span
          className={cn(
            "absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-sidebar",
            STATUS_META[status].dot,
            status !== BotStatus.Idle && "animate-pulse"
          )}
        />
      )}
    </span>
  )
}
