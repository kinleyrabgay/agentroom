import type { ReactNode } from "react"
import type { Suggestion } from "@/components/shared/mention-textarea"

/** `@` suggestions: repo files (already ranked by the server). Paths with spaces are quoted. */
export function fileSuggestions(files: string[], icon?: ReactNode): Suggestion[] {
  return files.map((f) => {
    const slash = f.lastIndexOf("/")
    return {
      id: f,
      insert: /\s/.test(f) ? `@"${f}"` : `@${f}`,
      label: slash >= 0 ? f.slice(slash + 1) : f,
      description: slash >= 0 ? f.slice(0, slash) : undefined,
      icon,
    }
  })
}
