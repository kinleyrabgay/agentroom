"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from "react"
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

/** True while a search is open: folded turns open so their text can be found. */
export const FindContext = createContext(false)
export const useFinding = () => useContext(FindContext)

const MAX_MATCHES = 1000

/** Text ranges matching `query` (case-insensitive) inside `root`, skipping the find bar itself. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const q = query.toLowerCase()
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => ((n.parentElement?.closest("[data-find-ignore]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)),
  })
  for (let node = walker.nextNode(); node && out.length < MAX_MATCHES; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").toLowerCase()
    for (let at = text.indexOf(q); at >= 0 && out.length < MAX_MATCHES; at = text.indexOf(q, at + q.length)) {
      const r = document.createRange()
      r.setStart(node, at)
      r.setEnd(node, at + q.length)
      out.push(r)
    }
  }
  return out
}

const highlights = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null)

/**
 * ⌘/Ctrl F inside a bot's chat: matches in your messages and the bot's are painted with the CSS Custom
 * Highlight API (the DOM is never rewritten), and re-found as the reply streams in. Enter / ⇧Enter step.
 */
export function useThreadFind(scroller: RefObject<HTMLDivElement | null>) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [count, setCount] = useState(0)
  const [index, setIndex] = useState(0)
  const ranges = useRef<Range[]>([])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f" && scroller.current?.isConnected) {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => document.getElementById("thread-find-input")?.focus())
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [scroller])

  const paint = useCallback(
    (current: number) => {
      const reg = highlights()
      if (!reg) return
      const all = ranges.current
      reg.set("thread-find", new Highlight(...all))
      const cur = all[current]
      if (cur) reg.set("thread-find-current", new Highlight(cur))
      else reg.delete("thread-find-current")
    },
    []
  )

  const reveal = (r: Range | undefined) => {
    const box = scroller.current
    if (!r || !box) return
    const rect = r.getBoundingClientRect()
    const outer = box.getBoundingClientRect()
    if (rect.top < outer.top + 40 || rect.bottom > outer.bottom - 40) box.scrollBy({ top: rect.top - outer.top - outer.height / 3 })
  }

  // Search, and search again whenever the thread changes (streaming, folds opening).
  useEffect(() => {
    const box = scroller.current
    const reg = highlights()
    if (!open || !query || !box) {
      ranges.current = []
      reg?.delete("thread-find")
      reg?.delete("thread-find-current")
      return
    }
    const run = () => {
      ranges.current = findRanges(box, query)
      setCount(ranges.current.length)
      setIndex((i) => Math.min(i, Math.max(0, ranges.current.length - 1)))
    }
    // After the folds the search opened have rendered.
    const frame = requestAnimationFrame(run)
    const mo = new MutationObserver(run)
    mo.observe(box, { subtree: true, childList: true, characterData: true })
    return () => {
      cancelAnimationFrame(frame)
      mo.disconnect()
    }
  }, [open, query, scroller])

  useEffect(() => {
    if (!open) return
    paint(index)
  }, [open, index, count, paint])

  const step = (dir: 1 | -1) => {
    const n = ranges.current.length
    if (!n) return
    const next = (index + dir + n) % n
    setIndex(next)
    reveal(ranges.current[next])
  }

  const close = () => {
    setOpen(false)
    setQuery("")
  }

  const shown = open && query ? count : 0
  return { open, query, setQuery: (q: string) => (setQuery(q), setIndex(0)), count: shown, index, step, close }
}

export function ThreadFindBar({ find }: { find: ReturnType<typeof useThreadFind> }) {
  if (!find.open) return null
  return (
    <div data-find-ignore className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border bg-popover px-2 py-1 text-xs shadow-md">
      <SearchIcon className="size-3.5 text-muted-foreground" />
      <input
        id="thread-find-input"
        value={find.query}
        onChange={(e) => find.setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            find.step(e.shiftKey ? -1 : 1)
          } else if (e.key === "Escape") find.close()
        }}
        placeholder="Find in thread"
        aria-label="Find in thread"
        className="w-44 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      <span className="w-14 text-right text-muted-foreground tabular-nums">{find.query ? (find.count ? `${find.index + 1}/${find.count}` : "0/0") : ""}</span>
      <Button size="icon-xs" variant="ghost" aria-label="Previous match" onClick={() => find.step(-1)}>
        <ChevronUpIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Next match" onClick={() => find.step(1)}>
        <ChevronDownIcon />
      </Button>
      <Button size="icon-xs" variant="ghost" aria-label="Close find" onClick={find.close}>
        <XIcon />
      </Button>
    </div>
  )
}
