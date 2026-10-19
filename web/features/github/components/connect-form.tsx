"use client"

import { useState } from "react"
import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react"
import type { GithubProjectConfig } from "@shared"
import { githubApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { URL_PLACEHOLDER } from "../constants"
import { setGithub, SetupState } from "../lib/github-store"
import { ColumnPills } from "./column-pills"
import { GhError } from "./gh-error"

/**
 * Paste a project URL → connect → preview its columns → confirm.
 * Used by the Board's first-run card and by Settings → Integrations.
 */
export function ConnectForm({ confirmLabel = "Open board", onDone }: { confirmLabel?: string; onDone?: () => void }) {
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

  const confirm = () => {
    setGithub({ project: connected, setup: SetupState.Connected })
    onDone?.()
  }

  return (
    <div className="w-full space-y-3">
      {!connected ? (
        <form onSubmit={connect} className="flex w-full gap-2">
          <Input
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
        <div className="w-full space-y-3 rounded-xl border bg-surface p-4 text-left">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CheckIcon className="size-4 text-success" /> {connected.title}
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {connected.owner}/{connected.number}
            </span>
          </div>
          <ColumnPills columns={connected.columns} />
          <Button className="w-full" onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      )}
      {error && <GhError message={error} className="text-left" />}
    </div>
  )
}
