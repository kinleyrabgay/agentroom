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
import { useAttachments } from "@/features/attachments/hooks/use-attachments"
import { pastedFiles, useFileDrop } from "@/features/attachments/hooks/use-file-drop"
import { AttachButton } from "@/features/attachments/components/attach-button"
import { AttachmentTray } from "@/features/attachments/components/attachment-tray"
import { DropOverlay } from "@/features/attachments/components/drop-overlay"
import { skillSuggestions } from "../lib/skill-suggestions"

const DEFAULT_ELEMENT_PROMPT = "Look at this element."
const DEFAULT_FILES_PROMPT = "(see attachments)"

export function Composer({ bot }: { bot: Bot }) {
  const [text, setText] = useState("")
  const picked = useAppStore((s) => s.attachments[bot.id]) ?? []
  const library = useAppStore((s) => s.skills)
  const files = useAttachments()
  const drop = useFileDrop(files.add)
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
  const hasContent = !!text.trim() || picked.length > 0 || files.readyIds.length > 0
  const canSend = hasContent && !files.uploading

  const submit = () => {
    if (!canSend) return
    const body = text.trim() || (picked.length ? DEFAULT_ELEMENT_PROMPT : DEFAULT_FILES_PROMPT)
    send({
      type: ClientMessageType.Send,
      botId: bot.id,
      text: body + takeAttachments(bot.id),
      attachments: files.readyIds.length ? files.readyIds : undefined,
    })
    setText("")
    files.clear()
  }

  return (
    <div className="border-t p-3">
      <div
        {...drop.handlers}
        onPaste={(e) => {
          const pasted = pastedFiles(e)
          if (pasted.length) files.add(pasted)
        }}
        className="relative rounded-2xl border bg-muted/30 p-2 focus-within:ring-2 focus-within:ring-ring/30"
      >
        <DropOverlay show={drop.over} />
        <AttachmentTray controller={files} className="pb-2" />
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {picked.map((a, i) => (
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
          placeholder={`Message ${bot.name}… (type / for skills, paste or drop files)`}
          className="min-h-0 resize-none border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center gap-1 pt-1">
          <AttachButton onFiles={files.add} className="text-muted-foreground" />
          <Button variant="ghost" size="xs" className="text-muted-foreground" title="Forget conversation history" onClick={() => botApi.resetSession(bot.id)}>
            <RotateCcwIcon data-icon="inline-start" /> New session
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {files.uploading ? "Uploading…" : <><Kbd>Enter</Kbd> send · <Kbd>⇧ Enter</Kbd> newline</>}
          </span>
          <Button size="icon-sm" onClick={submit} disabled={!canSend} title={files.uploading ? "Wait for uploads to finish" : "Send"}>
            <ArrowUpIcon />
          </Button>
        </div>
      </div>
    </div>
  )
}
