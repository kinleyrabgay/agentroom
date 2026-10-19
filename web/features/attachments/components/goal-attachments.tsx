"use client"

import { useEffect, useState } from "react"
import type { Attachment } from "@shared"
import { cn } from "@/lib/utils"
import { fetchAttachmentMeta, uploadUrl } from "../lib/upload"
import { FileKindIcon } from "./file-kind-icon"

/** "📎 N attachments" on a goal: chips that open each file. Metadata is fetched lazily. */
export function GoalAttachments({ ids, className }: { ids: string[]; className?: string }) {
  const [metas, setMetas] = useState<Record<string, Attachment>>({})
  const key = ids.join(",")

  useEffect(() => {
    let alive = true
    Promise.all(key.split(",").filter(Boolean).map((id) => fetchAttachmentMeta(id).catch(() => null))).then((list) => {
      if (!alive) return
      setMetas(Object.fromEntries(list.filter((a): a is Attachment => !!a).map((a) => [a.id, a])))
    })
    return () => {
      alive = false
    }
  }, [key])

  if (!ids.length) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-xs", className)}>
      <span className="text-muted-foreground">📎 {ids.length} {ids.length === 1 ? "attachment" : "attachments"}</span>
      {ids.map((id) => {
        const a = metas[id]
        return (
          <a
            key={id}
            href={uploadUrl(id)}
            target="_blank"
            rel="noreferrer noopener"
            className="flex h-6 max-w-48 items-center gap-1 rounded-md border bg-background px-1.5 hover:bg-muted"
          >
            {a && <FileKindIcon kind={a.kind} className="size-3" />}
            <span className="min-w-0 truncate">{a?.name ?? "file"}</span>
          </a>
        )
      })}
    </div>
  )
}
