import { FileIcon, FileTextIcon, ImageIcon, type LucideIcon } from "lucide-react"
import { AttachmentKind } from "@shared"
import { cn } from "@/lib/utils"

const ICONS: Record<AttachmentKind, LucideIcon> = {
  [AttachmentKind.Image]: ImageIcon,
  [AttachmentKind.Pdf]: FileTextIcon,
  [AttachmentKind.Text]: FileTextIcon,
  [AttachmentKind.File]: FileIcon,
}

const TONE: Record<AttachmentKind, string> = {
  [AttachmentKind.Image]: "text-sky-500",
  [AttachmentKind.Pdf]: "text-red-500",
  [AttachmentKind.Text]: "text-muted-foreground",
  [AttachmentKind.File]: "text-muted-foreground",
}

export function FileKindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = ICONS[kind] ?? FileIcon
  return <Icon className={cn("size-3.5 shrink-0", TONE[kind], className)} />
}
