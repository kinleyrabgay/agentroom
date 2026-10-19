"use client"

/* eslint-disable @next/next/no-img-element -- static export: files served by the AgentRoom server */
import { useState } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { AttachmentKind, type Attachment } from "@shared"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { formatBytes } from "../lib/files"
import { uploadUrl } from "../lib/upload"
import { FileKindIcon } from "./file-kind-icon"

/** Attachments on a sent message: an image grid (click to enlarge) and file chips that open the file. */
export function MessageAttachments({ attachments, className }: { attachments: Attachment[]; className?: string }) {
  const [open, setOpen] = useState<Attachment | null>(null)
  if (!attachments.length) return null
  const images = attachments.filter((a) => a.kind === AttachmentKind.Image)
  const files = attachments.filter((a) => a.kind !== AttachmentKind.Image)

  return (
    <div className={cn("flex flex-col items-end gap-1.5", className)}>
      {images.length > 0 && (
        <div className={cn("grid gap-1.5", images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
          {images.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpen(a)}
              className={cn("overflow-hidden rounded-xl border bg-muted hover:opacity-90", images.length === 1 ? "max-w-64" : "size-24")}
              title={a.name}
            >
              <img src={uploadUrl(a.id)} alt={a.name} loading="lazy" className={cn("block", images.length === 1 ? "max-h-56 w-auto" : "size-full object-cover")} />
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {files.map((a) => (
            <a
              key={a.id}
              href={uploadUrl(a.id)}
              target="_blank"
              rel="noreferrer noopener"
              className="flex h-8 max-w-60 items-center gap-1.5 rounded-lg border bg-background px-2 text-xs hover:bg-muted"
            >
              <FileKindIcon kind={a.kind} />
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size)}</span>
            </a>
          ))}
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-[min(92vw,1100px)] gap-3 p-3 sm:max-w-[min(92vw,1100px)]">
          {open && (
            <>
              <DialogTitle className="sr-only">{open.name}</DialogTitle>
              <DialogDescription className="sr-only">Attachment preview</DialogDescription>
              <div className="grid max-h-[78vh] place-items-center overflow-auto rounded-lg bg-muted">
                <img src={uploadUrl(open.id)} alt={open.name} className="max-h-[78vh] w-auto object-contain" />
              </div>
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <span className="truncate font-medium text-foreground">{open.name}</span>
                <span>{formatBytes(open.size)}</span>
                {open.width && open.height && <span>{open.width}×{open.height}</span>}
                <a href={uploadUrl(open.id)} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                  <ExternalLinkIcon className="size-3.5" /> Open original
                </a>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
