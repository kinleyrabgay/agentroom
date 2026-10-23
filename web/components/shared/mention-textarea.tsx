"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Textarea } from "@/components/ui/textarea"

/** One entry in the suggestion list. */
export interface Suggestion {
  id: string
  /** Text inserted in place of the trigger token (a trailing space is added). */
  insert: string
  label: string
  description?: string
  icon?: React.ReactNode
  /** Right-aligned hint, e.g. "own" or "not assigned". */
  hint?: string
  /** Rendered dimmed (still selectable). */
  muted?: boolean
}

/** A trigger character and how to find suggestions for the text typed after it. */
export interface MentionTrigger {
  /** Shown above the list, e.g. "Skills". */
  title: string
  /** Suggestions for the query (text after the trigger). May be async. */
  suggest: (query: string) => Suggestion[] | Promise<Suggestion[]>
  /** Shown when nothing matches. */
  empty?: string
}

type Active = { char: string; start: number; query: string }

interface Props extends Omit<React.ComponentProps<typeof Textarea>, "value" | "onChange" | "onSubmit"> {
  value: string
  onChange: (value: string) => void
  /** Keyed by trigger character, e.g. { "/": skills, "@": files }. */
  triggers: Record<string, MentionTrigger>
  /** Called on Enter (without Shift) when no suggestion list is open; `mod` is true with ⌘/Ctrl held. */
  onSubmit?: (opts: { mod: boolean }) => void
  /** Called after a suggestion is inserted. */
  onPick?: (char: string, s: Suggestion) => void
  /** Extra classes for the suggestion popover. */
  menuClassName?: string
}

export interface MentionTextareaHandle {
  focus: () => void
}

/** Token under the caret if it starts with a trigger character (at the start or after whitespace). */
function activeToken(value: string, caret: number, chars: string[]): Active | null {
  let i = caret
  while (i > 0 && !/\s/.test(value[i - 1])) i--
  const char = value[i]
  if (!char || !chars.includes(char)) return null
  return { char, start: i, query: value.slice(i + 1, caret) }
}

/** Case-insensitive fuzzy match: every query character appears in order. Lower score = better. */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const direct = t.indexOf(q)
  if (direct >= 0) return direct
  let ti = 0
  let gaps = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    gaps += found - ti
    ti = found + 1
  }
  return 100 + gaps
}

/**
 * Textarea with inline suggestions: type a trigger (e.g. `/` or `@`) at the start of a word to open a list;
 * ↑/↓ to move, Enter/Tab to insert, Esc to close.
 */
export const MentionTextarea = forwardRef<MentionTextareaHandle, Props>(function MentionTextarea(
  { value, onChange, triggers, onSubmit, onPick, menuClassName, className, onKeyDown, ...rest },
  ref
) {
  const area = useRef<HTMLTextAreaElement>(null)
  const [active, setActive] = useState<Active | null>(null)
  const [items, setItems] = useState<Suggestion[]>([])
  const [index, setIndex] = useState(0)
  const request = useRef(0)

  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus() }), [])

  const trigger = active ? triggers[active.char] : null

  // Load suggestions for the active token (latest request wins).
  useEffect(() => {
    if (!active || !trigger) return
    const id = ++request.current
    Promise.resolve(trigger.suggest(active.query)).then(
      (list) => {
        if (id !== request.current) return
        setItems(list)
        setIndex(0)
      },
      () => id === request.current && setItems([])
    )
  }, [active, trigger])

  const refresh = (text: string, caret: number) => {
    const next = activeToken(text, caret, Object.keys(triggers))
    setActive((prev) => (prev?.char === next?.char && prev?.start === next?.start && prev?.query === next?.query ? prev : next))
    if (!next) setItems([])
  }

  const pick = (s: Suggestion) => {
    if (!active) return
    const caret = area.current?.selectionStart ?? value.length
    const before = value.slice(0, active.start)
    const after = value.slice(caret).replace(/^\S*/, "")
    const inserted = `${s.insert} `
    const next = before + inserted + after.replace(/^\s/, "")
    onChange(next)
    setActive(null)
    setItems([])
    onPick?.(active.char, s)
    const pos = before.length + inserted.length
    requestAnimationFrame(() => {
      area.current?.focus()
      area.current?.setSelectionRange(pos, pos)
    })
  }

  const open = !!active && !!trigger

  return (
    <div className="relative">
      <Textarea
        ref={area}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          refresh(e.target.value, e.target.selectionStart)
        }}
        onSelect={(e) => refresh(e.currentTarget.value, e.currentTarget.selectionStart)}
        onBlur={() => setTimeout(() => setActive(null), 120)}
        onKeyDown={(e) => {
          if (open && items.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault()
              setIndex((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length)
              return
            }
            if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
              e.preventDefault()
              pick(items[index])
              return
            }
          }
          if (open && e.key === "Escape") {
            e.preventDefault()
            e.stopPropagation()
            setActive(null)
            return
          }
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && onSubmit) {
            e.preventDefault()
            onSubmit({ mod: e.metaKey || e.ctrlKey })
            return
          }
          onKeyDown?.(e)
        }}
        className={className}
        {...rest}
      />
      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute bottom-full left-0 z-50 mb-2 w-full max-w-sm overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg",
            menuClassName
          )}
        >
          <div className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {trigger.title}
            {active.query && <span className="font-mono"> · {active.char + active.query}</span>}
          </div>
          <ul className="max-h-64 overflow-y-auto p-1">
            {items.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">{trigger.empty ?? "No matches"}</li>}
            {items.map((s, i) => (
              <li
                key={s.id}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(s)
                }}
                onMouseEnter={() => setIndex(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                  i === index && "bg-accent text-accent-foreground",
                  s.muted && "opacity-60"
                )}
              >
                {s.icon && <span className="shrink-0">{s.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{s.label}</span>
                  {s.description && <span className="block truncate text-xs text-muted-foreground">{s.description}</span>}
                </span>
                {s.hint && <span className="shrink-0 text-xs text-muted-foreground">{s.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
})
