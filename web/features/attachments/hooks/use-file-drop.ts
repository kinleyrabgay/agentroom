"use client"

import { useRef, useState } from "react"

const hasFiles = (e: React.DragEvent) => [...e.dataTransfer.types].includes("Files")

/**
 * Drag-and-drop of files from the OS. Only reacts to real files (not skill chips or cards dragged
 * inside AgentRoom). Spread `handlers` on the drop zone.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setOver(false)
      if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files])
    },
  }
  return { over, handlers }
}

/** Paste handler that takes files (e.g. a screenshot on the clipboard) and lets plain text through. */
export function pastedFiles(e: React.ClipboardEvent): File[] {
  const files = [...e.clipboardData.files]
  if (files.length) e.preventDefault()
  return files
}
