"use client"

import { useState } from "react"
import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react"
import { GithubMark } from "./github-mark"
import type { GithubProjectConfig } from "@shared"
import { githubApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { OPTION_COLORS, URL_PLACEHOLDER } from "../constants"
import { setGithub, SetupState } from "../lib/github-store"
import { GhError } from "./gh-error"

/** First run: paste the project URL, preview its columns, done. */
export function SetupCard() {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState<GithubProjectConfig | null>(null)

  const connect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      setConnected(await githubApi.connect(url.trim()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid h-full place-items-center overflow-y-auto p-6">
      <Empty className="max-w-xl border bg-card/40">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <GithubMark className="size-5" />
          </EmptyMedia>
          <EmptyTitle>Connect your GitHub project board</EmptyTitle>
          <EmptyDescription>
            See your project&apos;s columns and cards here, assign yourself, and hand cards to the team.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="w-full max-w-lg">
          {!connected ? (
            <form onSubmit={connect} className="flex w-full gap-2">
              <Input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={URL_PLACEHOLDER}
                className="font-mono text-xs"
                aria-label="GitHub project URL"
              />
              <Button type="submit" disabled={!url.trim() || busy}>
                {busy ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-start" />}
                Connect
              </Button>
            </form>
          ) : (
            <div className="w-full space-y-3 rounded-xl border bg-background p-4 text-left">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckIcon className="size-4 text-emerald-500" /> {connected.title}
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {connected.owner}/{connected.number}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {connected.columns.map((c) => (
                  <span key={c.id} className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                    <span className="size-2 rounded-full" style={{ background: OPTION_COLORS[c.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} />
                    {c.name}
                  </span>
                ))}
              </div>
              <Button className="w-full" onClick={() => setGithub({ project: connected, setup: SetupState.Connected })}>
                Open board
              </Button>
            </div>
          )}
          {error && <GhError message={error} className="text-left" />}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saved to <code className="font-mono">.agentroom/github/project.json</code> so your team shares it. AgentRoom uses your{" "}
            <code className="font-mono">gh</code> login and only writes when you assign or unassign yourself.
          </p>
        </EmptyContent>
      </Empty>
    </div>
  )
}
