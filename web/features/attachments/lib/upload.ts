import { API_PREFIX, TOKEN_HEADER, TOKEN_QUERY, type Attachment } from "@shared"
import { API_BASE } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"

/** URL of an uploaded file. The token rides in the query so <img src> and new tabs work. */
export function uploadUrl(id: string): string {
  const token = encodeURIComponent(useAppStore.getState().token)
  return `${API_BASE}${API_PREFIX}/uploads/${encodeURIComponent(id)}?${TOKEN_QUERY}=${token}`
}

/** Upload one file (multipart, field "file"), reporting progress 0..1. XHR because fetch has no upload progress. */
export function uploadFile(file: File, onProgress: (p: number) => void): { promise: Promise<Attachment>; abort: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<Attachment>((resolve, reject) => {
    xhr.open("POST", `${API_BASE}${API_PREFIX}/uploads`)
    xhr.setRequestHeader(TOKEN_HEADER, useAppStore.getState().token)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let data: { error?: string } & Partial<Attachment> = {}
      try {
        data = JSON.parse(xhr.responseText)
      } catch {
        // non-JSON body (e.g. an older server's 404 page)
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.id) resolve(data as Attachment)
      else reject(new Error(data.error ?? (xhr.status === 404 ? "This AgentRoom server can't take attachments yet — restart it after updating." : `Upload failed (${xhr.status})`)))
    }
    xhr.onerror = () => reject(new Error("Upload failed — is AgentRoom still running?"))
    xhr.onabort = () => reject(new Error("Upload cancelled"))
    const form = new FormData()
    form.append("file", file, file.name)
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}

export async function fetchAttachmentMeta(id: string): Promise<Attachment> {
  const res = await fetch(`${API_BASE}${API_PREFIX}/uploads/${encodeURIComponent(id)}/meta`, {
    headers: { [TOKEN_HEADER]: useAppStore.getState().token },
  })
  if (!res.ok) throw new Error(`Attachment ${id} not found`)
  return (await res.json()) as Attachment
}
