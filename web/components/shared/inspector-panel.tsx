"use client"

import { ArrowDownIcon, BotIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { HandoffForm, type HandoffFormProps } from "./handoff-form"

/**
 * Layout for a detail shown in the Inspector (Sentry issue, GitHub card): a fixed header with the
 * reference line, title and actions, then a scrolling body. Fills its parent's height.
 */
export function InspectorPanel({
  label,
  refLine,
  title,
  subtitle,
  actions,
  onClose,
  children,
}: {
  /** Accessible name of the panel, e.g. "Sentry issue WEB-4X". */
  label: string
  refLine: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <section aria-label={label} className="flex h-full min-h-0 flex-col">
      <header className="space-y-3 border-b px-5 pt-4 pb-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">{refLine}</div>
          <Button variant="ghost" size="icon-sm" className="-mt-1 -mr-2 shrink-0" onClick={onClose} aria-label="Close details">
            <XIcon />
          </Button>
        </div>
        <div className="space-y-1">
          <h2 className="text-xl leading-snug font-semibold tracking-tight text-balance break-words">{title}</h2>
          {subtitle}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}

/** "Hand off ↓": jumps to the hand-off section at the bottom of the panel. */
export function JumpToHandoff({ targetId }: { targetId: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="ml-auto text-muted-foreground"
      onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
    >
      Hand off <ArrowDownIcon data-icon="inline-end" />
    </Button>
  )
}

/** The "Hand off to the team" block that closes every detail panel. */
export function HandoffSection({ id, description, form }: { id: string; description: string; form: HandoffFormProps }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-2xl border bg-sunken/60 p-4">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border bg-surface text-brand shadow-xs">
          <BotIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-[15px] font-semibold">
            Hand off to the team
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <HandoffForm {...form} />
    </section>
  )
}

/** A titled block inside a detail panel. */
export function DetailSection({
  title,
  icon: Icon,
  hint,
  count,
  children,
}: {
  title: string
  icon?: React.ComponentType<{ className?: string }>
  hint?: React.ReactNode
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {Icon && <Icon className="size-4 text-muted-foreground" />}
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums">{count}</span>}
        {hint && <span className="ml-auto text-xs font-normal text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  )
}
