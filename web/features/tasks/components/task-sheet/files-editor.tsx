"use client"

import { useState } from "react"
import { FileCodeIcon, XIcon } from "lucide-react"

/** Chip input for files/areas the task touches. Enter or comma adds. */
export function FilesEditor({
  files,
  onChange,
}: {
  files: string[]
  onChange: (files: string[]) => void
}) {
  const [draft, setDraft] = useState("")
  const add = () => {
    const parts = draft
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !files.includes(s))
    if (parts.length) onChange([...files, ...parts])
    setDraft("")
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border bg-muted/20 p-2 focus-within:ring-2 focus-within:ring-ring/30">
      {files.map((f) => (
        <span
          key={f}
          className="flex max-w-full items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px]"
        >
          <FileCodeIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">{f}</span>
          <button
            onClick={() => onChange(files.filter((x) => x !== f))}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${f}`}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault()
            add()
          } else if (e.key === "Backspace" && !draft && files.length)
            onChange(files.slice(0, -1))
        }}
        onBlur={add}
        placeholder={files.length ? "" : "src/app/page.tsx, api/…"}
        className="min-w-32 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground"
      />
    </div>
  )
}
