import type { GithubColumn } from "@shared"
import { OPTION_COLORS } from "../constants"

/** The board's Status columns as small colored pills. */
export function ColumnPills({ columns }: { columns: GithubColumn[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {columns.map((c) => (
        <span key={c.id} className="flex h-6 items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs">
          <span className="size-2 rounded-full" style={{ background: OPTION_COLORS[c.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} />
          {c.name}
        </span>
      ))}
    </div>
  )
}
