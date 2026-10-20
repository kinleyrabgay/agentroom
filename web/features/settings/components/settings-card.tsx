"use client"

import { UserIcon } from "lucide-react"
import { toast } from "sonner"
import { settingsApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { ToneBadge } from "@/components/kit/badge"
import { SECTIONS, type SettingsSection } from "../lib/constants"
import { overridesOf, SECTION_KEY } from "../lib/scope"

/** One section of the Settings document: heading and one line on the left edge, content in a card. `id` is the scroll anchor. */
export function SettingsCard({ id, aside, children }: { id: SettingsSection; aside?: React.ReactNode; children: React.ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!
  const settings = useAppStore((s) => s.settings)
  const key = SECTION_KEY[id]
  const mine = key ? overridesOf(settings).filter((k) => k === key || k.startsWith(`${key}.`)) : []
  const reset = async () => {
    try {
      let next = null
      for (const k of mine) next = await settingsApi.resetPersonal(k)
      if (next) useAppStore.setState({ settings: next })
      toast.success(`${meta.label}: back to the team settings`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  return (
    <section id={`settings-${id}`} data-section={id} aria-labelledby={`settings-${id}-title`} className="scroll-mt-6 space-y-3">
      <header className="flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={`settings-${id}-title`} className="text-base font-semibold tracking-tight">
            {meta.label}
          </h2>
          <p className="text-sm text-muted-foreground">{meta.description}</p>
        </div>
        {mine.length > 0 && (
          <span className="flex items-center gap-1.5">
            <ToneBadge tone="brand" icon={UserIcon} size="sm" title={mine.join(", ")}>
              Just for you
            </ToneBadge>
            <button onClick={reset} className="rounded-full px-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
              Reset
            </button>
          </span>
        )}
        {aside}
      </header>
      <div className="rounded-xl border bg-card p-5">{children}</div>
    </section>
  )
}
