"use client"

import { useCallback, useEffect, useState } from "react"
import { BrainIcon, CheckIcon, PencilIcon, PinIcon, PinOffIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { NotificationKind, type Bot, type BotMemory, type MemoryNote } from "@shared"
import { cn } from "@/lib/utils"
import { memoryApi } from "@/lib/api/endpoints"
import { useAppStore } from "@/lib/store/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Callout } from "@/components/kit/callout"
import { EmptyState, ErrorState, LoadingState } from "@/components/kit/state-view"

/** Notes about this bot, so the tab badge and the list refresh when a bot suggests something. */
export function useMemorySignal(botId: string) {
  return useAppStore((s) => s.notifications.filter((n) => n.kind === NotificationKind.Info && n.botId === botId).length)
}

/**
 * What the bot has learned about this repo (bots/<dir>/memory.md), and notes it suggested
 * with memory_note: keep or ignore each one. Edits save straight to the file.
 */
export function MemoryTab({ bot }: { bot: Bot }) {
  const signal = useMemorySignal(bot.id)
  const [mem, setMem] = useState<BotMemory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  const load = useCallback(() => {
    memoryApi
      .get(bot.id)
      .then((m) => {
        setMem(m)
        setError(null)
      })
      .catch((e) => setError((e as Error).message))
  }, [bot.id])

  useEffect(() => {
    load()
  }, [load, signal])

  const run = async (p: Promise<BotMemory>) => {
    try {
      setMem(await p)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const save = (notes: MemoryNote[]) => run(memoryApi.save(bot.id, notes))

  if (error) return <ErrorState error={error} onRetry={load} />
  if (!mem) return <LoadingState label="Loading memory…" />

  const add = () => {
    const text = draft.trim()
    if (!text) return
    setDraft("")
    void save([...mem.notes, { text, pinned: false }])
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto p-4">
      {mem.suggestions.map((s) => (
        <Callout
          key={s.id}
          tone="brand"
          icon={BrainIcon}
          title={`${bot.name} suggests remembering`}
          action={
            <>
              <Button size="sm" variant="ghost" onClick={() => run(memoryApi.ignore(bot.id, s.id))}>
                Ignore
              </Button>
              <Button size="sm" onClick={() => run(memoryApi.keep(bot.id, s.id))}>
                <CheckIcon data-icon="inline-start" /> Keep
              </Button>
            </>
          }
        >
          <p className="font-medium text-foreground">{s.note}</p>
          {s.reason && <p className="text-xs text-muted-foreground">Why: {s.reason}</p>}
        </Callout>
      ))}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          add()
        }}
        className="flex gap-2"
      >
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a note, e.g. Use yarn, never npm" aria-label="New memory note" />
        <Button type="submit" variant="outline" disabled={!draft.trim()}>
          <PlusIcon data-icon="inline-start" /> Add
        </Button>
      </form>

      {mem.notes.length ? (
        <ul className="divide-y rounded-2xl border bg-surface">
          {mem.notes.map((n, i) => (
            <NoteRow
              key={`${i}:${n.text}`}
              note={n}
              onChange={(next) => save(mem.notes.map((x, j) => (j === i ? next : x)))}
              onDelete={() => save(mem.notes.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={BrainIcon}
          title="Nothing remembered yet"
          description={`When ${bot.name} learns a convention of this repo it suggests a note here. You can also add your own.`}
        />
      )}
      <p className="text-xs text-muted-foreground">
        Saved in <span className="font-mono">bots/{bot.dir}/memory.md</span> and added to {bot.name}&apos;s instructions. Pinned notes come first.
      </p>
    </div>
  )
}

function NoteRow({ note, onChange, onDelete }: { note: MemoryNote; onChange: (n: MemoryNote) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(note.text)
  const commit = () => {
    setEditing(false)
    if (text.trim() && text.trim() !== note.text) onChange({ ...note, text: text.trim() })
    else setText(note.text)
  }
  return (
    <li className="group flex items-start gap-2 px-3 py-2.5">
      <PinIcon className={cn("mt-1 size-3.5 shrink-0", note.pinned ? "text-brand" : "text-transparent")} aria-hidden />
      {editing ? (
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              setText(note.text)
              setEditing(false)
            }
          }}
          aria-label="Edit note"
          className="h-8"
        />
      ) : (
        <p className="min-w-0 flex-1 text-sm leading-relaxed">{note.text}</p>
      )}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button size="icon-xs" variant="ghost" aria-label={note.pinned ? "Unpin" : "Pin"} onClick={() => onChange({ ...note, pinned: !note.pinned })}>
          {note.pinned ? <PinOffIcon /> : <PinIcon />}
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label={editing ? "Cancel edit" : "Edit"} onClick={() => setEditing(!editing)}>
          {editing ? <XIcon /> : <PencilIcon />}
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Delete note" onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

/** Count for the Memory tab: pending suggestions (fetched lazily by the tab itself). */
export function MemoryTabLabel({ botId }: { botId: string }) {
  const signal = useMemorySignal(botId)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    let alive = true
    memoryApi
      .get(botId)
      .then((m) => alive && setPending(m.suggestions.length))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [botId, signal])
  return pending > 0 ? <span className="tone-brand tone-soft rounded-full border px-1.5 text-xs tabular-nums">{pending}</span> : null
}
