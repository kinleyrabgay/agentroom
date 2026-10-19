"use client"

import { CopyIcon, TerminalIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/kit/callout"
import { GH_SCOPE_FIX } from "../constants"
import { isAuthError } from "../lib/board-view"

/** Error message; for gh auth/scope problems it shows the one command that fixes it. */
export function GhError({ message, className }: { message: string; className?: string }) {
  const auth = isAuthError(message)
  return (
    <Callout
      tone={auth ? "warning" : "danger"}
      icon={auth ? TerminalIcon : undefined}
      title={auth ? "GitHub CLI needs access to Projects" : "Couldn't reach GitHub"}
      className={className}
    >
      <p className="break-words">{message}</p>
      {auth && (
        <div className="mt-2 flex items-center gap-2 rounded-lg border bg-surface px-2.5 py-1.5 font-mono text-xs text-foreground">
          <span className="flex-1">{GH_SCOPE_FIX}</span>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Copy command"
            onClick={() => navigator.clipboard.writeText(GH_SCOPE_FIX).then(() => toast.success("Copied. Run it in your terminal."))}
          >
            <CopyIcon />
          </Button>
        </div>
      )}
    </Callout>
  )
}
