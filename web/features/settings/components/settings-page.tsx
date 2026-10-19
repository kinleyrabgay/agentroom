"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Skeleton } from "@/components/ui/skeleton"
import { SECTIONS, SettingsSection } from "../lib/constants"
import { RunnerSection } from "./runner-section"
import { RemoteSection } from "./remote-section"
import { AlertsSection } from "./alerts-section"
import { DataSection } from "./data-section"
import { GeneralSection } from "./general-section"
import { BudgetsSection } from "./budgets-section"
import { IntegrationsSection } from "./integrations-section"
import { SecuritySection } from "./security-section"

/** Settings: sticky section nav and one document column. Follows `#/settings/<section>`. */
export function SettingsPage() {
  const loaded = useAppStore((s) => s.settings !== null)
  const target = useAppStore((s) => s.settingsSection)
  const [active, setActive] = useState<SettingsSection>(SettingsSection.General)
  const scroller = useRef<HTMLDivElement>(null)

  // Highlight the section nearest the top while scrolling.
  useEffect(() => {
    const root = scroller.current
    if (!root || !loaded) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        const id = visible?.target.getAttribute("data-section") as SettingsSection | null
        if (id) setActive(id)
      },
      { root, rootMargin: "0px 0px -60% 0px" }
    )
    root.querySelectorAll("[data-section]").forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [loaded])

  // Deep link (route or a "Fix in Settings" button): scroll to that section once it exists.
  useEffect(() => {
    if (!loaded || !target) return
    const id = requestAnimationFrame(() => document.getElementById(`settings-${target}`)?.scrollIntoView({ block: "start" }))
    return () => cancelAnimationFrame(id)
  }, [loaded, target])

  const jump = (id: SettingsSection) => {
    setActive(id)
    useAppStore.setState({ settingsSection: id })
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div ref={scroller} className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl gap-10 px-6 py-6">
        <nav className="sticky top-6 hidden h-fit w-48 shrink-0 md:block" aria-label="Settings sections">
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  onClick={() => jump(id)}
                  aria-current={active === id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60",
                    active === id && "bg-accent font-medium text-foreground"
                  )}
                >
                  <Icon className={cn("size-4", active === id && "text-brand")} />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 max-w-3xl flex-1 space-y-10 pb-24">
          {loaded ? (
            <>
              <GeneralSection />
              <BudgetsSection />
              <SecuritySection />
              <AlertsSection />
              <RemoteSection />
              <RunnerSection />
              <IntegrationsSection />
              <DataSection />
            </>
          ) : (
            <>
              <Skeleton className="h-64 w-full rounded-xl" />
              <Skeleton className="h-48 w-full rounded-xl" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
