"use client"

import { SquareIcon, XIcon } from "lucide-react"
import { BotStatus, ClientMessageType, type Bot } from "@shared"
import { isBusy, STATUS_META } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { ToneBadge } from "@/components/kit/badge"
import { Button } from "@/components/ui/button"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { useBotModelLabel } from "@/features/models/components/model-label"

export function BotPanelHeader({ bot }: { bot: Bot }) {
  const st = useAppStore((s) => s.statuses[bot.id]) ?? { status: BotStatus.Idle }
  const select = useAppStore((s) => s.select)
  const modelLabel = useBotModelLabel(bot)
  const running = isBusy(st.status)
  const meta = STATUS_META[st.status]

  return (
    <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
      <BotAvatar bot={bot} className="size-10 rounded-lg text-xl" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold tracking-tight">{bot.name}</span>
          <ToneBadge tone={meta.tone} dot pulse={running}>
            {meta.label}
          </ToneBadge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {running && st.activity ? st.activity : `${bot.role} · ${modelLabel}`}
        </div>
      </div>
      {running && (
        <Button variant="outline" size="sm" className="tone-danger tone-text" onClick={() => send({ type: ClientMessageType.Stop, botId: bot.id })}>
          <SquareIcon data-icon="inline-start" className="fill-current" /> Stop
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" onClick={() => select(null)} aria-label={`Close ${bot.name}`}>
        <XIcon />
      </Button>
    </div>
  )
}
