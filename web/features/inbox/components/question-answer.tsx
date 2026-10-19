"use client"

import { useState } from "react"
import { SendIcon } from "lucide-react"
import type { Notification } from "@shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { answerQuestion } from "../lib/actions"

/** Quick answers plus a free-text reply for a bot's question. */
export function QuestionAnswer({ n }: { n: Notification }) {
  const [text, setText] = useState("")

  if (n.answer) {
    return (
      <p className="rounded-lg bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
        You answered: <span className="text-foreground">{n.answer}</span>
      </p>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim()) answerQuestion(n.id, text.trim())
  }

  return (
    <div className="space-y-1.5">
      {n.options && n.options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {n.options.map((o) => (
            <Button
              key={o}
              size="xs"
              variant="outline"
              onClick={() => answerQuestion(n.id, o)}
            >
              {o}
            </Button>
          ))}
        </div>
      )}
      <form onSubmit={submit} className="flex gap-1.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type an answer…"
          className="h-7 text-xs"
        />
        <Button
          type="submit"
          size="icon-xs"
          disabled={!text.trim()}
          aria-label="Send answer"
        >
          <SendIcon />
        </Button>
      </form>
    </div>
  )
}
