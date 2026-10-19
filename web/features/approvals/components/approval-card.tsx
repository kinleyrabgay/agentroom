"use client"

import { ShieldAlertIcon } from "lucide-react"
import { ClientMessageType, ToolName } from "@shared"
import { BotTab } from "@/lib/constants"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import type { PermissionRequest } from "@/lib/store/selectors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { BotAvatar } from "@/components/shared/bot-avatar"
import { Diff } from "@/components/shared/diff"
import { describeRequest } from "../lib/describe"

/** Server marks dangerous commands with this reason; they can't be session-allowed. */
const STICKY_MARKER = "always requires"
const WRITE_PREVIEW_LIMIT = 3000

export function ApprovalCard({ request: p }: { request: PermissionRequest }) {
  const bot = useAppStore((s) => s.bots.find((b) => b.id === p.botId))
  const select = useAppStore((s) => s.select)
  const input = (p.input ?? {}) as Record<string, unknown>
  const view = describeRequest(p.tool, input, p.summary)
  const sticky = p.reason.includes(STICKY_MARKER)
  const answer = (allow: boolean, always = false) => send({ type: ClientMessageType.Permission, requestId: p.requestId, allow, always })

  return (
    <Card className="pointer-events-auto gap-3 border-amber-500/40 py-4 shadow-xl">
      <CardHeader className="px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          {bot && <BotAvatar bot={bot} className="size-6 rounded-md text-xs" />}
          <button className="hover:underline" onClick={() => select(p.botId, view.isBrowser ? BotTab.Browser : BotTab.Chat)}>
            {bot?.name ?? p.botId}
          </button>
          <span className="font-normal text-muted-foreground">wants to use</span>
          <Badge variant="outline" className="font-mono">{view.label}</Badge>
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5 text-amber-600 dark:text-amber-300">
          <ShieldAlertIcon className="size-3.5" /> {p.reason}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4">
        {p.tool === ToolName.Edit && typeof input.old_string === "string" ? (
          <Diff path={p.summary} before={input.old_string} after={String(input.new_string ?? "")} />
        ) : p.tool === ToolName.Write && typeof input.content === "string" ? (
          <Diff path={p.summary} before="" after={input.content.slice(0, WRITE_PREVIEW_LIMIT)} />
        ) : (
          <pre className="max-h-40 overflow-auto rounded-lg border bg-muted/40 p-2.5 font-mono text-xs break-all whitespace-pre-wrap">{view.preview}</pre>
        )}
      </CardContent>
      <CardFooter className="gap-2 px-4">
        <Button size="sm" onClick={() => answer(true)}>Approve</Button>
        {!sticky && (
          <Button size="sm" variant="outline" onClick={() => answer(true, true)} title={`Allow every ${view.group} action until the server restarts`}>
            Always allow {view.group}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => answer(false)}>Deny</Button>
      </CardFooter>
    </Card>
  )
}
