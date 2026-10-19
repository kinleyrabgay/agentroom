import { UploadIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** Shown over a composer while files are dragged over it. */
export function DropOverlay({ show, className }: { show: boolean; className?: string }) {
  if (!show) return null
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit] border-2 border-dashed border-primary bg-background/85 text-sm font-medium backdrop-blur-sm",
        className
      )}
    >
      <span className="flex items-center gap-2">
        <UploadIcon className="size-4" /> Drop to attach
      </span>
    </div>
  )
}
