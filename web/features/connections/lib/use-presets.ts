"use client"

import { useEffect, useState } from "react"
import type { McpPreset } from "@shared"
import { mcpApi } from "@/lib/api/endpoints"

let cache: McpPreset[] | null = null

/** Ready-made servers (fetched once per page load). */
export function usePresets(): McpPreset[] {
  const [presets, setPresets] = useState<McpPreset[]>(cache ?? [])
  useEffect(() => {
    if (cache) return
    mcpApi
      .presets()
      .then((p) => {
        cache = p
        setPresets(p)
      })
      .catch(() => {})
  }, [])
  return presets
}
