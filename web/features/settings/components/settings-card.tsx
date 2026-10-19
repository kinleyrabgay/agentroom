"use client"

import { SECTIONS, type SettingsSection } from "../lib/constants"

/** One section of the Settings document: heading and one line on the left edge, content in a card. `id` is the scroll anchor. */
export function SettingsCard({ id, aside, children }: { id: SettingsSection; aside?: React.ReactNode; children: React.ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!
  return (
    <section id={`settings-${id}`} data-section={id} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 space-y-3">
      <header className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`settings-${id}-title`} className="text-base font-semibold tracking-tight">
            {meta.label}
          </h2>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        {aside}
      </header>
      <div className="rounded-xl border bg-card p-5">{children}</div>
    </section>
  )
}
