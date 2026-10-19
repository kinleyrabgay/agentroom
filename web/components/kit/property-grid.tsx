import { cn } from "@/lib/utils"

export interface Property {
  label: string
  value: React.ReactNode
  /** Spans the full row (long values). */
  wide?: boolean
}

/** Label/value pairs in a tidy grid (details panels). Empty values render as a dash. */
export function PropertyGrid({ items, className }: { items: Property[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-3 text-sm", className)}>
      {items.map((p) => (
        <div key={p.label} className={cn("min-w-0 space-y-0.5", p.wide && "col-span-2")}>
          <dt className="text-xs text-muted-foreground">{p.label}</dt>
          <dd className="min-w-0 truncate font-medium">{p.value ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}
