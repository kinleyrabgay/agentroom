"use client"

import { useRef } from "react"
import { PaperclipIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** Paperclip that opens the OS file picker (several files at once). */
export function AttachButton({ onFiles, className }: { onFiles: (files: File[]) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className={className} onClick={() => input.current?.click()} aria-label="Attach files">
            <PaperclipIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Attach images, PDFs or files · or paste / drop them</TooltipContent>
      </Tooltip>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files])
          e.target.value = ""
        }}
      />
    </>
  )
}
