import type { Bot } from "@shared"

export function ThinkingIndicator({ bot, label }: { bot: Bot; label: string }) {
  return (
    <div className="flex items-center gap-2.5 pl-[34px] text-xs text-muted-foreground">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full" style={{ background: bot.color, animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      {label}…
    </div>
  )
}
