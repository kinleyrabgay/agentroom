"use client"

import { useEffect, useState } from "react"
import { BoxIcon, FileCodeIcon, SearchIcon, SquareFunctionIcon } from "lucide-react"
import type { ContextHit } from "@shared"
import { contextApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { openModule, setContext } from "../lib/context-store"

const KIND_ICON = { module: BoxIcon, file: FileCodeIcon, symbol: SquareFunctionIcon } as const
const KIND_LABEL = { module: "Modules", symbol: "Symbols", file: "Files" } as const

/** Open what a search hit points at: a module's card, or the code (with its module behind it). */
export function openHit(h: ContextHit) {
  openModule(h.moduleId || null)
  if (h.kind !== "module") setContext({ peek: { path: h.path, ...(h.line ? { line: h.line } : {}) } })
}

/** Search symbols, files and cards (the same index bots use with context_find). */
export function ContextSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<ContextHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!q.trim()) return
    let live = true
    const t = setTimeout(() => {
      setLoading(true)
      contextApi
        .find(q, 30)
        .then((h) => live && setHits(h))
        .catch(() => live && setHits([]))
        .finally(() => live && setLoading(false))
    }, 160)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  // "/" focuses search, like most code tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const shown = q.trim() ? hits : []
  const groups = (["module", "symbol", "file"] as const).map((k) => [k, shown.filter((h) => h.kind === k)] as const).filter(([, l]) => l.length)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="w-44 justify-start text-muted-foreground lg:w-56">
          <SearchIcon data-icon="inline-start" />
          <span className="flex-1 text-left">Find code…</span>
          <Kbd>/</Kbd>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(520px,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Symbol, file or what it does…" />
          <CommandList className="max-h-[min(60vh,420px)]">
            {q.trim() && !loading && <CommandEmpty>Nothing matches.</CommandEmpty>}
            {!q.trim() && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Search the same index bots use: symbols, file paths and card text.</p>}
            {groups.map(([kind, list]) => (
              <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                {list.map((h) => {
                  const Icon = KIND_ICON[h.kind]
                  return (
                    <CommandItem
                      key={`${h.kind}:${h.path}:${h.line ?? ""}:${h.name ?? ""}`}
                      value={`${h.kind}:${h.path}:${h.line ?? ""}:${h.name ?? ""}`}
                      onSelect={() => {
                        setOpen(false)
                        openHit(h)
                      }}
                      className="items-start"
                    >
                      <Icon className="mt-0.5 size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{h.kind === "symbol" ? h.name : h.path}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {h.kind === "symbol" ? `${h.path}:${h.line}` : h.detail}
                        </span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
