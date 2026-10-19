"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { AttachmentKind, ATTACHMENTS_PER_MESSAGE, type Attachment } from "@shared"
import { kindOf, nameFor, rejectReason } from "../lib/files"
import { uploadFile } from "../lib/upload"

export const DraftStatus = { Uploading: "uploading", Ready: "ready", Error: "error" } as const
export type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus]

export interface DraftAttachment {
  localId: string
  file: File
  name: string
  kind: AttachmentKind
  status: DraftStatus
  progress: number
  attachment?: Attachment
  /** Object URL for image previews (revoked on remove/clear/unmount). */
  previewUrl?: string
  error?: string
}

let seq = 0

/**
 * Files attached to a message being composed: uploads start as soon as a file is added,
 * so sending only has to pass the ids.
 */
export function useAttachments() {
  const [drafts, setDrafts] = useState<DraftAttachment[]>([])
  const draftsRef = useRef(drafts)
  const aborts = useRef(new Map<string, () => void>())

  useEffect(() => {
    draftsRef.current = drafts
  }, [drafts])

  // Free previews and stop uploads when the composer goes away.
  useEffect(() => {
    const pending = aborts.current
    return () => {
      for (const d of draftsRef.current) if (d.previewUrl) URL.revokeObjectURL(d.previewUrl)
      for (const abort of pending.values()) abort()
    }
  }, [])

  const patch = (localId: string, p: Partial<DraftAttachment>) =>
    setDrafts((list) => list.map((d) => (d.localId === localId ? { ...d, ...p } : d)))

  const start = useCallback((draft: DraftAttachment) => {
    const { promise, abort } = uploadFile(new File([draft.file], draft.name, { type: draft.file.type }), (p) =>
      patch(draft.localId, { progress: p })
    )
    aborts.current.set(draft.localId, abort)
    promise
      .then((attachment) => patch(draft.localId, { status: DraftStatus.Ready, progress: 1, attachment }))
      .catch((e: Error) => {
        if (e.message !== "Upload cancelled") patch(draft.localId, { status: DraftStatus.Error, error: e.message })
      })
      .finally(() => aborts.current.delete(draft.localId))
  }, [])

  const add = useCallback(
    (files: FileList | File[]) => {
      const room = ATTACHMENTS_PER_MESSAGE - draftsRef.current.length
      const list = [...files]
      if (list.length > room) toast.error(`Up to ${ATTACHMENTS_PER_MESSAGE} attachments per message`)
      const accepted: DraftAttachment[] = []
      for (const file of list.slice(0, Math.max(0, room))) {
        const reason = rejectReason(file)
        if (reason) {
          toast.error(reason)
          continue
        }
        const kind = kindOf(file)
        accepted.push({
          localId: `att-${++seq}`,
          file,
          name: nameFor(file),
          kind,
          status: DraftStatus.Uploading,
          progress: 0,
          previewUrl: kind === AttachmentKind.Image ? URL.createObjectURL(file) : undefined,
        })
      }
      if (!accepted.length) return
      setDrafts((d) => [...d, ...accepted])
      accepted.forEach(start)
    },
    [start]
  )

  const remove = useCallback((localId: string) => {
    aborts.current.get(localId)?.()
    setDrafts((list) => {
      const gone = list.find((d) => d.localId === localId)
      if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl)
      return list.filter((d) => d.localId !== localId)
    })
  }, [])

  const retry = useCallback(
    (localId: string) => {
      const d = draftsRef.current.find((x) => x.localId === localId)
      if (!d) return
      patch(localId, { status: DraftStatus.Uploading, progress: 0, error: undefined })
      start(d)
    },
    [start]
  )

  /** Clear after sending; the transcript shows the server's copies from then on. */
  const clear = useCallback(() => {
    setDrafts((list) => {
      for (const d of list) if (d.previewUrl) URL.revokeObjectURL(d.previewUrl)
      return []
    })
  }, [])

  const readyIds = drafts.flatMap((d) => (d.status === DraftStatus.Ready && d.attachment ? [d.attachment.id] : []))
  const uploading = drafts.some((d) => d.status === DraftStatus.Uploading)
  const failed = drafts.some((d) => d.status === DraftStatus.Error)

  return { drafts, add, remove, retry, clear, readyIds, uploading, failed }
}

export type AttachmentsController = ReturnType<typeof useAttachments>
