import type { GithubLabel } from "@shared"
import { labelTextColor } from "../lib/board-view"

/** A GitHub label in its own color, with readable text. */
export function LabelPill({ label }: { label: GithubLabel }) {
  const bg = label.color ? `#${label.color.replace("#", "")}` : undefined
  return (
    <span
      className="inline-flex max-w-40 items-center truncate rounded-full border px-1.5 py-px text-[10px] leading-4 font-medium"
      style={bg ? { background: bg, color: labelTextColor(bg), borderColor: "transparent" } : undefined}
      title={label.name}
    >
      {label.name}
    </span>
  )
}
