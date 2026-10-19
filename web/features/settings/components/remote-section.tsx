"use client"

import { useCallback, useEffect, useState } from "react"
import { CopyIcon, Loader2Icon, PowerIcon, SmartphoneIcon } from "lucide-react"
import { toast } from "sonner"
import type { RemoteStatus } from "@shared"
import { remoteApi } from "@/lib/api/endpoints"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/kit/callout"
import { ToneBadge } from "@/components/kit/badge"
import { Dropdown } from "@/components/kit/dropdown"
import { SettingsCard } from "./settings-card"
import { SettingsSection } from "../lib/constants"

type Status = RemoteStatus & { qrSvg?: string }

const HOURS = [1, 4, 8, 24].map((h) => ({ value: h, label: h === 1 ? "1 hour" : `${h} hours` }))
const POLL_MS = 5000

/** Turn phone approvals on (Cloudflare quick tunnel + an approvals-only link), show the QR code, revoke. */
export function RemoteSection() {
  const [status, setStatus] = useState<Status | null>(null)
  const [hours, setHours] = useState(8)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    remoteApi
      .get()
      .then(setStatus)
      .catch(() => {})
  }, [])

  // Poll while the tunnel is starting or on, so expiry and tunnel drops show up.
  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const run = async (fn: () => Promise<Status>) => {
    setBusy(true)
    try {
      setStatus(await fn())
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!status?.link) return
    try {
      await navigator.clipboard.writeText(status.link)
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.")
    }
  }

  const on = status?.state === "on"
  const left = status?.expiresAt ? remaining(status.expiresAt) : null

  return (
    <SettingsCard id={SettingsSection.Remote}>
      <div className="space-y-4">
        {status?.state === "error" &&
          (status.missingBinary ? (
            <Callout tone="warning" title="cloudflared isn't installed">
              Phone approvals use a free Cloudflare quick tunnel. Install it with <span className="font-mono">brew install cloudflared</span>, then turn this on again.
            </Callout>
          ) : (
            <Callout tone="danger" title="Couldn't start the tunnel">
              {status.error}
            </Callout>
          ))}

        {on && status ? (
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {status.qrSvg && (
              <div
                className="size-40 shrink-0 rounded-2xl border bg-white p-2 [&_svg]:size-full"
                role="img"
                aria-label="QR code for the phone approvals link"
                dangerouslySetInnerHTML={{ __html: status.qrSvg }}
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
              <div>
                <p className="font-medium">Scan to approve from your phone</p>
                <p className="text-sm text-muted-foreground">
                  The phone sees only approvals, questions and plans to review. {left && <>Link expires in {left}.</>}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <ToneBadge tone="success" dot pulse>
                  Tunnel on
                </ToneBadge>
                <ToneBadge>Approvals only</ToneBadge>
              </div>
              <p className="truncate rounded-full border bg-sunken px-3 py-1.5 font-mono text-xs" title={status.link}>
                {status.link}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={copy}>
                  <CopyIcon data-icon="inline-start" /> Copy link
                </Button>
                <Button size="sm" variant="ghost" className="tone-danger tone-text" disabled={busy} onClick={() => run(() => remoteApi.disable())}>
                  <PowerIcon data-icon="inline-start" /> Revoke
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <SmartphoneIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Opens a temporary public link that reaches only the approvals page. A new random token is made each time; turning it off revokes it.
            </p>
            <div className="w-36">
              <Dropdown<number> datas={HOURS} selectedValue={hours} onSelect={(v) => setHours(v as number)} showSearch={false} />
            </div>
            <Button disabled={busy || status?.state === "starting"} onClick={() => run(() => remoteApi.enable(hours))}>
              {busy || status?.state === "starting" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PowerIcon data-icon="inline-start" />}
              {status?.state === "starting" ? "Starting…" : "Turn on"}
            </Button>
          </div>
        )}
      </div>
    </SettingsCard>
  )
}

function remaining(iso: string) {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600_000)
  const m = Math.round((ms % 3600_000) / 60_000)
  return h ? `${h}h ${m}m` : `${m}m`
}
