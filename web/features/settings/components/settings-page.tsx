"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store/app-store"
import { Skeleton } from "@/components/ui/skeleton"
import { SECTIONS, SettingsSection } from "../lib/constants"
import { AlertsSection } from "./alerts-section"
import { DataSection } from "./data-section"
import { GeneralSection } from "./general-section"
import { IntegrationsSection } from "./integrations-section"
import { SecuritySection } from "./security-section"

/** Settings: section nav on the left (sticky), one card per section on the right. */
export function SettingsPage() {
  const loaded = useAppStore((s) => s.settings !== null)
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

  const jump = (id: SettingsSection) => {
    setActive(id)
    document.getElementById(`settings-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div ref={scroller} className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl gap-8 px-6 py-6">
        <nav className="sticky top-6 hidden h-fit w-48 shrink-0 md:block" aria-label="Settings sections">
          <ul className="space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button
                  onClick={() => jump(id)}
                  aria-current={active === id ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    active === id && "bg-muted font-medium text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 space-y-6 pb-24">
          {loaded ? (
            <>
              <GeneralSection />
              <SecuritySection />
              <AlertsSection />
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
