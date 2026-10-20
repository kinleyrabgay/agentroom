"use client"

import { useRef, useState } from "react"
import { ImageUpIcon, Loader2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { uploadFile, uploadUrl } from "@/features/attachments/lib/upload"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** A template field that takes one image: uploads it and keeps the upload id as the value. */
export function ImageField({ id, value, onChange }: { id: string; value: string; onChange: (uploadId: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [name, setName] = useState("")

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith("image/")) return toast.error("Choose an image (PNG, JPG or WebP).")
    setName(file.name)
    setProgress(0)
    try {
      const a = await uploadFile(file, setProgress).promise
      onChange(a.id)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div
      className={cn("flex items-center gap-3 rounded-2xl border border-dashed p-2.5", value && "border-solid bg-sunken/40")}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void pick(e.dataTransfer.files[0])
      }}
    >
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={uploadUrl(value)} alt="Design" className="h-14 w-20 shrink-0 rounded-lg border bg-background object-cover object-top" />
      ) : (
        <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {progress !== null ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : <ImageUpIcon className="size-4" aria-hidden />}
        </span>
      )}
      <div className="min-w-0 flex-1 text-sm">
        <p className="truncate">{value ? name || "Design image attached" : progress !== null ? `Uploading ${Math.round(progress * 100)}%` : "Drop a screenshot or export of the design"}</p>
        <p className="text-xs text-muted-foreground">PNG, JPG or WebP. Attached to the goal; Verify compares the page with it.</p>
      </div>
      <input id={id} ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
      {value ? (
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove the image" onClick={() => onChange("")}>
          <XIcon />
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={progress !== null} onClick={() => input.current?.click()}>
          Choose…
        </Button>
      )}
    </div>
  )
}
