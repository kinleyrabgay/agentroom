import { BanIcon, TerminalSquareIcon } from "lucide-react"
import { ConsoleLevel, type ConsoleLine } from "@shared"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

const LEVEL_STYLE: Record<ConsoleLevel, string> = {
  [ConsoleLevel.Log]: "text-foreground/80",
  [ConsoleLevel.Info]: "text-sky-600 dark:text-sky-400",
  [ConsoleLevel.Warn]: "bg-amber-500/5 text-amber-700 dark:text-amber-300",
  [ConsoleLevel.Error]: "bg-destructive/5 text-destructive",
  [ConsoleLevel.Network]: "bg-destructive/5 text-orange-600 dark:text-orange-400",
}

export const isProblem = (l: ConsoleLine) => l.level === ConsoleLevel.Error || l.level === ConsoleLevel.Network

/** Page logs, errors and failed requests. */
export function ConsolePanel({ lines, onClear }: { lines: ConsoleLine[]; onClear: () => void }) {
  return (
    <div className="flex h-44 shrink-0 flex-col border-t bg-background">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs font-medium">
        <TerminalSquareIcon className="size-3.5" /> Console
        <span className="text-muted-foreground">{lines.length}</span>
        <Button variant="ghost" size="xs" className="ml-auto" onClick={onClear}>
          <BanIcon data-icon="inline-start" /> Clear
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[11px]">
        {!lines.length && <p className="p-3 text-muted-foreground">No messages yet.</p>}
        {lines.map((l, i) => (
          <div key={i} className={cn("flex gap-2 border-b border-border/50 px-3 py-0.5", LEVEL_STYLE[l.level])}>
            <span className="shrink-0 opacity-50">{new Date(l.ts).toLocaleTimeString()}</span>
            <span className="w-12 shrink-0 uppercase opacity-70">{l.level}</span>
            <span className="break-all whitespace-pre-wrap">{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
