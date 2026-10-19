"use client"

/* eslint-disable @next/next/no-img-element -- local object URLs */
import { AlertCircleIcon, Loader2Icon, RotateCwIcon, XIcon } from "lucide-react"
import { AttachmentKind } from "@shared"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DraftStatus, type AttachmentsController, type DraftAttachment } from "../hooks/use-attachments"
import { formatBytes } from "../lib/files"
import { FileKindIcon } from "./file-kind-icon"

/** Files waiting to be sent: image thumbnails and file chips, each with progress, error/retry and remove. */
export function AttachmentTray({ controller, className }: { controller: AttachmentsController; className?: string }) {
  const { drafts, remove, retry } = controller
  if (!drafts.length) return null
  const images = drafts.filter((d) => d.kind === AttachmentKind.Image)
  const files = drafts.filter((d) => d.kind !== AttachmentKind.Image)

  return (
    <div className={cn("flex flex-wrap items-end gap-2", className)}>
      {images.map((d) => (
        <ImageThumb key={d.localId} draft={d} onRemove={() => remove(d.localId)} onRetry={() => retry(d.localId)} />
      ))}
      {files.map((d) => (
        <FileChip key={d.localId} draft={d} onRemove={() => remove(d.localId)} onRetry={() => retry(d.localId)} />
      ))}
    </div>
  )
}

function ImageThumb({ draft, onRemove, onRetry }: { draft: DraftAttachment; onRemove: () => void; onRetry: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="group relative size-14 shrink-0 overflow-hidden rounded-xl border bg-muted">
          {draft.previewUrl && <img src={draft.previewUrl} alt={draft.name} className="size-full object-cover" />}
          <StatusOverlay draft={draft} onRetry={onRetry} />
          <RemoveButton onClick={onRemove} name={draft.name} className="absolute top-0.5 right-0.5" />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {draft.error ?? `${draft.name} · ${formatBytes(draft.file.size)}`}
      </TooltipContent>
    </Tooltip>
  )
}

function FileChip({ draft, onRemove, onRetry }: { draft: DraftAttachment; onRemove: () => void; onRetry: () => void }) {
  const failed = draft.status === DraftStatus.Error
  return (
    <span
      title={draft.error ?? draft.name}
      className={cn(
        "flex h-8 max-w-60 items-center gap-1.5 rounded-lg border bg-background pr-1 pl-2 text-xs",
        failed && "border-destructive/50 text-destructive"
      )}
    >
      {draft.status === DraftStatus.Uploading ? (
        <Loader2Icon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : failed ? (
        <AlertCircleIcon className="size-3.5 shrink-0" />
      ) : (
        <FileKindIcon kind={draft.kind} />
      )}
      <span className="min-w-0 truncate">{draft.name}</span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {draft.status === DraftStatus.Uploading ? `${Math.round(draft.progress * 100)}%` : formatBytes(draft.file.size)}
      </span>
      {failed && (
        <button onClick={onRetry} className="rounded p-0.5 hover:bg-muted" aria-label={`Retry ${draft.name}`}>
          <RotateCwIcon className="size-3" />
        </button>
      )}
      <RemoveButton onClick={onRemove} name={draft.name} />
    </span>
  )
}

function StatusOverlay({ draft, onRetry }: { draft: DraftAttachment; onRetry: () => void }) {
  if (draft.status === DraftStatus.Uploading) {
    const r = 9
    const c = 2 * Math.PI * r
    return (
      <span className="absolute inset-0 grid place-items-center bg-background/50">
        <svg viewBox="0 0 24 24" className="size-6 -rotate-90" aria-label={`Uploading ${Math.round(draft.progress * 100)}%`}>
          <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-border" />
          <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-primary transition-[stroke-dasharray]" strokeDasharray={`${c * Math.max(0.05, draft.progress)} ${c}`} />
        </svg>
      </span>
    )
  }
  if (draft.status === DraftStatus.Error) {
    return (
      <button onClick={onRetry} className="absolute inset-0 grid place-items-center bg-destructive/60 text-white" aria-label={`Retry ${draft.name}`}>
        <RotateCwIcon className="size-4" />
      </button>
    )
  }
  return null
}

function RemoveButton({ onClick, name, className }: { onClick: () => void; name: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Remove ${name}`}
      className={cn("grid size-4 place-items-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-foreground", className)}
    >
      <XIcon className="size-3" />
    </button>
  )
}
