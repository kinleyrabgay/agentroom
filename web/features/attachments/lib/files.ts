import { AttachmentKind, ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_MAX_BYTES } from "@shared"

const MODEL_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"])
const TEXT_EXT = /\.(txt|md|markdown|json|ya?ml|csv|tsv|log|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|sh|sql|toml|ini|env\.example)$/i

/** How a file will reach the model (mirrors the server's classification, for display before upload). */
export function kindOf(file: { type: string; name: string }): AttachmentKind {
  if (MODEL_IMAGES.has(file.type)) return AttachmentKind.Image
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) return AttachmentKind.Pdf
  if (file.type.startsWith("text/") || TEXT_EXT.test(file.name)) return AttachmentKind.Text
  return AttachmentKind.File
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** Why a file can't be attached, or null. */
export function rejectReason(file: File): string | null {
  if (kindOf(file) === AttachmentKind.Image && file.size > ATTACHMENT_IMAGE_MAX_BYTES) {
    return `${file.name}: image is ${formatBytes(file.size)}; max ${formatBytes(ATTACHMENT_IMAGE_MAX_BYTES)} — crop or compress it`
  }
  if (file.size > ATTACHMENT_MAX_BYTES) return `${file.name}: ${formatBytes(file.size)} is over the ${formatBytes(ATTACHMENT_MAX_BYTES)} limit`
  if (file.size === 0) return `${file.name} is empty`
  return null
}

/** Pasted screenshots arrive as "image.png"; give them a readable, unique name. */
export function nameFor(file: File): string {
  if (/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
    const ext = file.name.split(".").pop()
    const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, ".")
    return `Screenshot ${stamp}.${ext}`
  }
  return file.name
}
