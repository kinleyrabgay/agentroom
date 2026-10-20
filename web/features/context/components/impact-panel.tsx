"use client"

import { useEffect, useState } from "react"
import { CrosshairIcon, FlaskConicalIcon, XIcon } from "lucide-react"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/kit/dropdown"
import { openModule, setContext, setImpactFiles, useContextStore } from "../lib/context-store"

/**
 * Impact mode: pick the files a change will touch and see its blast radius on the map:
 * the modules and files that depend on them (transitively) and the tests to run.
 */
export function ImpactPanel() {
  const files = useContextStore((s) => s.impactFiles)
  const impact = useContextStore((s) => s.impact)
  const [all, setAll] = useState<string[] | null>(null)

  useEffect(() => {
    contextApi
      .files()
      .then(setAll)
      .catch(() => setAll([]))
  }, [])

  return (
    <section
      aria-label="Impact"
      className="absolute top-3 left-3 z-10 flex max-h-[calc(100%-5rem)] w-[min(360px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-2xl border bg-background/95 shadow-lg backdrop-blur-md"
    >
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <CrosshairIcon className="size-4 text-muted-foreground" />
        <h2 className="flex-1 text-sm font-medium">Impact of a change</h2>
        <Button size="icon-xs" variant="ghost" aria-label="Close impact mode" onClick={() => setContext({ impactOn: false })}>
          <XIcon />
        </Button>
      </header>
      <div className="space-y-3 overflow-y-auto p-3">
        <Dropdown<string>
          multiple
          datas={(all ?? []).map((f) => ({ label: f, value: f }))}
          selectedValue={files}
          onSelect={(v) => void setImpactFiles(v as string[])}
          placeholder={all === null ? "Loading files…" : "Files you'll change"}
          notfound="No indexed file matches"
          displayLimit={1}
          popoverWidth={420}
          disabled={all === null}
        />
        {!files.length ? (
          <p className="text-xs text-muted-foreground">Modules that depend on the files light up on the map. Useful before you hand out a goal.</p>
        ) : !impact ? null : (
          <>
            <p className="text-sm">
              <span className="font-medium tabular-nums">{impact.modules.length}</span> modules ·{" "}
              <span className="font-medium tabular-nums">{impact.files.length}</span> dependent files ·{" "}
              <span className="font-medium tabular-nums">{impact.tests.length}</span> tests
            </p>
            <List title="Modules" items={impact.modules} onPick={(id) => openModule(id)} />
            <List title="Tests to run" icon items={impact.tests} mono onPick={(path) => setContext({ peek: { path } })} empty="No tests found for these files." />
            <List title="Depends on the change" items={impact.files} mono onPick={(path) => setContext({ peek: { path } })} />
          </>
        )}
      </div>
    </section>
  )
}

function List({ title, items, onPick, mono, icon, empty }: { title: string; items: string[]; onPick: (v: string) => void; mono?: boolean; icon?: boolean; empty?: string }) {
  if (!items.length && !empty) return null
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {!items.length ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.slice(0, 40).map((v) => (
            <li key={v}>
              <button onClick={() => onPick(v)} className="flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent">
                {icon && <FlaskConicalIcon className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className={mono ? "truncate font-mono" : "truncate"}>{v}</span>
              </button>
            </li>
          ))}
          {items.length > 40 && <li className="px-1.5 text-xs text-muted-foreground">…{items.length - 40} more</li>}
        </ul>
      )}
    </div>
  )
}
