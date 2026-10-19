"use client"

import { CopyIcon, TerminalIcon, TriangleAlertIcon } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { GH_SCOPE_FIX } from "../constants"
import { isAuthError } from "../lib/board-view"

/** Error panel; for gh auth/scope problems it shows the one command that fixes it. */
export function GhError({ message, className }: { message: string; className?: string }) {
  const auth = isAuthError(message)
  return (
    <Alert variant={auth ? "default" : "destructive"} className={className}>
      {auth ? <TerminalIcon /> : <TriangleAlertIcon />}
      <AlertTitle>{auth ? "GitHub CLI needs access to Projects" : "Couldn't reach GitHub"}</AlertTitle>
      <AlertDescription>
        <p className="break-words">{message}</p>
        {auth && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground">
            <span className="flex-1">{GH_SCOPE_FIX}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Copy command"
              onClick={() => navigator.clipboard.writeText(GH_SCOPE_FIX).then(() => toast.success("Copied — run it in your terminal"))}
            >
              <CopyIcon />
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  )
}
