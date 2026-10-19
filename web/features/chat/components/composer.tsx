"use client"

import { useMemo, useState } from "react"
import { ArrowUpIcon, CrosshairIcon, RotateCcwIcon, XIcon } from "lucide-react"
import { ClientMessageType, type Bot } from "@shared"
import { botApi } from "@/lib/api/endpoints"
import { send } from "@/lib/realtime/socket"
import { useAppStore } from "@/lib/store/app-store"
import { removeAttachment, takeAttachments } from "@/lib/store/attachments"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { MentionTextarea, type MentionTrigger } from "@/components/shared/mention-textarea"
import { skillSuggestions } from "../lib/skill-suggestions"

const DEFAULT_ELEMENT_PROMPT = "Look at this element."

export function Composer({ bot }: { bot: Bot }) {
  const [text, setText] = useState("")
  const attachments = useAppStore((s) => s.attachments[bot.id]) ?? []
  const library = useAppStore((s) => s.skills)
  const triggers = useMemo<Record<string, MentionTrigger>>(
    () => ({
      "/": {
        title: "Skills — the bot will use the one you pick",
        empty: "No skills match",
        suggest: (q) => skillSuggestions(bot, library, q),
      },
    }),
    [bot, library]
  )
  const canSend = !!text.trim() || attachments.length > 0

  const submit = () => {
    if (!canSend) return
    const body = text.trim() || DEFAULT_ELEMENT_PROMPT
    send({ type: ClientMessageType.Send, botId: bot.id, text: body + takeAttachments(bot.id) })
    setText("")
  }

  return (
    <div className="border-t p-3">
      <div className="rounded-2xl border bg-muted/30 p-2 focus-within:ring-2 focus-within:ring-ring/30">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {attachments.map((a, i) => (
              <span key={i} title={a.selector} className="flex max-w-full items-center gap-1 rounded-lg border bg-background px-2 py-1 font-mono text-[11px]">
                <CrosshairIcon className="size-3 shrink-0 text-sky-500" />
                <span className="truncate">{a.label}</span>
                <button className="text-muted-foreground hover:text-foreground" onClick={() => removeAttachment(bot.id, i)} aria-label="Remove">
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <MentionTextarea
          value={text}
          onChange={setText}
          triggers={triggers}
          onSubmit={submit}
          rows={2}
          placeholder={`Message ${bot.name}… (type / for skills)`}
          className="min-h-0 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-2 pt-1">
          <Button variant="ghost" size="xs" className="text-muted-foreground" title="Forget conversation history" onClick={() => botApi.resetSession(bot.id)}>
            <RotateCcwIcon data-icon="inline-start" /> New session
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            <Kbd>Enter</Kbd> send · <Kbd>⇧ Enter</Kbd> newline
          </span>
          <Button size="icon-sm" onClick={submit} disabled={!canSend} title="Send">
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
