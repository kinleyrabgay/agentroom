"use client"

import { useCallback, useEffect, useState } from "react"
import { CopyIcon, GlobeIcon, KeyRoundIcon, Loader2Icon, MoreHorizontalIcon, PowerIcon, RefreshCwIcon, UserMinusIcon, UserPlusIcon, UsersIcon, WifiIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { RoomInvite, RoomMemberView, RoomStatus } from "@shared"
import { timeAgo } from "@/lib/time"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Callout } from "@/components/kit/callout"
import { Dropdown } from "@/components/kit/dropdown"
import { ToneBadge } from "@/components/kit/badge"
import { SettingsCard } from "@/features/settings/components/settings-card"
import { SettingsSection } from "@/features/settings/lib/constants"
import { roomApi } from "../lib/room-api"
import { ROLE_LABEL } from "../lib/room-store"
import { PersonAvatar } from "./person-avatar"

type MemberRole = "approver" | "viewer"
const ROLES: { value: MemberRole; label: string; sublabel: string }[] = [
  { value: "approver", label: "Approver", sublabel: "Approve, answer, comment, start goals" },
  { value: "viewer", label: "Viewer", sublabel: "Read only" },
]
const DAYS = [1, 7, 30, 90].map((d) => ({ value: d, label: d === 1 ? "1 day" : `${d} days` }))
const POLL_MS = 5000

/** Settings → Team room: share this AgentRoom with teammates (LAN or tunnel), invite, roles, revoke. */
export function TeamRoomSection() {
  const [status, setStatus] = useState<RoomStatus | null>(null)
  const [invite, setInvite] = useState<RoomInvite | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    roomApi
      .status()
      .then(setStatus)
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  const run = async <T,>(key: string, fn: () => Promise<T>, after?: (v: T) => void) => {
    setBusy(key)
    try {
      const v = await fn()
      if (after) after(v)
      else if (v && typeof v === "object" && "members" in v) setStatus(v as unknown as RoomStatus)
      else load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (!status) {
    return (
      <SettingsCard id={SettingsSection.Room}>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </SettingsCard>
    )
  }

  if (!status.enabled) {
    return (
      <SettingsCard id={SettingsSection.Room}>
        <div className="flex flex-wrap items-center gap-3">
          <UsersIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            Let teammates watch, approve plans and risky actions, and comment from their own browser. Each person gets a personal, expiring link; everything still runs here.
          </p>
          <Button disabled={busy === "enable"} onClick={() => run("enable", roomApi.enable)}>
            {busy === "enable" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <PowerIcon data-icon="inline-start" />}
            Turn on
          </Button>
        </div>
      </SettingsCard>
    )
  }

  const active = status.members.filter((m) => m.state === "active")
  const past = status.members.filter((m) => m.state !== "active")
  const reachable = status.lan.enabled || status.tunnel.state === "on"

  return (
    <SettingsCard
      id={SettingsSection.Room}
      aside={
        <ToneBadge tone="success" dot>
          On
        </ToneBadge>
      }
    >
      <div className="space-y-6">
        <section className="space-y-3" aria-labelledby="room-connect">
          <h3 id="room-connect" className="text-sm font-medium">
            How teammates connect
          </h3>
          <LanRow status={status} busy={busy} run={run} />
          <TunnelRow status={status} busy={busy} run={run} />
          {!reachable && <p className="text-xs text-muted-foreground">Both are off: links work only on this machine until you share on the network or turn on a tunnel.</p>}
        </section>

        <InviteForm busy={busy} run={run} onInvite={(inv) => (setInvite(inv), load())} />
        {invite && <InviteLinks invite={invite} onClose={() => setInvite(null)} />}

        <section className="space-y-2" aria-labelledby="room-people">
          <h3 id="room-people" className="text-sm font-medium">
            People <span className="font-normal text-muted-foreground tabular-nums">{active.length}</span>
          </h3>
          <ul className="divide-y rounded-xl border">
            <li className="flex items-center gap-3 px-3 py-2.5">
              <PersonAvatar name={status.owner.name} email={status.owner.email} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{status.owner.name} (you)</span>
                <span className="block truncate text-xs text-muted-foreground">{status.owner.email}</span>
              </span>
              <ToneBadge size="sm" tone="brand">
                Owner
              </ToneBadge>
            </li>
            {active.map((m) => (
              <MemberRow key={m.id} member={m} busy={busy} run={run} onInvite={setInvite} />
            ))}
          </ul>
          {past.length > 0 && (
            <details className="group text-sm">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">
                {past.length} expired or removed
              </summary>
              <ul className="mt-2 divide-y rounded-xl border">
                {past.map((m) => (
                  <MemberRow key={m.id} member={m} busy={busy} run={run} onInvite={setInvite} />
                ))}
              </ul>
            </details>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            Teammates never get your settings, secrets, integrations or the in-app browser. Approvals they make are in the Audit log under their name.
          </p>
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("rotate", roomApi.rotate, (s) => (setStatus(s), setInvite(null), toast.success("Every link was reset. Issue new ones from each person's menu.")))}>
            <KeyRoundIcon data-icon="inline-start" /> Reset all links
          </Button>
          <Button size="sm" variant="ghost" className="tone-danger tone-text" disabled={!!busy} onClick={() => run("disable", roomApi.disable, (s) => (setStatus(s), setInvite(null)))}>
            <PowerIcon data-icon="inline-start" /> Turn off
          </Button>
        </div>
      </div>
    </SettingsCard>
  )
}

type Run = <T>(key: string, fn: () => Promise<T>, after?: (v: T) => void) => Promise<void>

function LanRow({ status, busy, run }: { status: RoomStatus; busy: string | null; run: Run }) {
  const [address, setAddress] = useState<string | undefined>(status.lan.address ?? status.lan.interfaces[0]?.address)
  const options = status.lan.interfaces.map((i) => ({ value: i.address, label: i.address, sublabel: i.name }))
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-3 py-2.5">
      <WifiIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <Label htmlFor="room-lan" className="text-sm font-medium">
          Local network
        </Label>
        <p className="truncate text-xs text-muted-foreground">
          {status.lan.enabled ? (
            <span className="font-mono">{status.lan.url}</span>
          ) : options.length ? (
            "Same Wi‑Fi or office network. Off until you turn it on, every time AgentRoom starts."
          ) : (
            "No network connection found."
          )}
        </p>
        {status.lan.error && <p className="text-xs tone-danger tone-text">{status.lan.error}</p>}
      </div>
      {!status.lan.enabled && options.length > 1 && (
        <div className="w-44">
          <Dropdown<string> datas={options} selectedValue={address} onSelect={(v) => setAddress(v as string)} showSearch={false} />
        </div>
      )}
      <Switch
        id="room-lan"
        checked={status.lan.enabled}
        disabled={busy === "lan" || !options.length}
        onCheckedChange={(on) => run("lan", () => roomApi.lan(on, on ? address : undefined))}
        aria-label="Share on the local network"
      />
    </div>
  )
}

function TunnelRow({ status, busy, run }: { status: RoomStatus; busy: string | null; run: Run }) {
  const t = status.tunnel
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-surface px-3 py-2.5">
        <GlobeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <Label htmlFor="room-tunnel" className="text-sm font-medium">
            Internet (Cloudflare tunnel)
          </Label>
          <p className="truncate text-xs text-muted-foreground">
            {t.state === "on" ? <span className="font-mono">{t.url}</span> : t.state === "starting" ? "Starting…" : "For teammates elsewhere. A temporary public address; links still need a personal token."}
          </p>
        </div>
        {(busy === "tunnel" || t.state === "starting") && <Loader2Icon className="size-4 animate-spin text-muted-foreground" />}
        <Switch
          id="room-tunnel"
          checked={t.state === "on" || t.state === "starting"}
          disabled={busy === "tunnel" || t.state === "starting"}
          onCheckedChange={(on) => run("tunnel", () => roomApi.tunnel(on))}
          aria-label="Share through a Cloudflare tunnel"
        />
      </div>
      {t.state === "error" &&
        (t.missingBinary ? (
          <Callout tone="warning" title="cloudflared isn't installed">
            Install it with <span className="font-mono">brew install cloudflared</span>, then turn the tunnel on again.
          </Callout>
        ) : (
          <Callout tone="danger" title="Couldn't start the tunnel">
            {t.error}
          </Callout>
        ))}
    </div>
  )
}

function InviteForm({ busy, run, onInvite }: { busy: string | null; run: Run; onInvite: (inv: RoomInvite) => void }) {
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("viewer")
  const [days, setDays] = useState(7)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    run("invite", () => roomApi.invite({ name: name.trim(), email: email.trim(), role, days }), (inv) => {
      onInvite(inv)
      setName("")
      setEmail("")
    })
  }
  return (
    <form onSubmit={submit} className="space-y-3" aria-labelledby="room-invite">
      <h3 id="room-invite" className="text-sm font-medium">
        Invite someone
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="room-name" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Their name" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="room-email" className="text-xs text-muted-foreground">
            Git email
          </Label>
          <Input id="room-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Role</span>
          <Dropdown<MemberRole> datas={ROLES} selectedValue={role} onSelect={(v) => setRole(v as MemberRole)} showSearch={false} />
        </div>
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground">Link expires after</span>
          <Dropdown<number> datas={DAYS} selectedValue={days} onSelect={(v) => setDays(v as number)} showSearch={false} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={busy === "invite" || !name.trim() || !email.trim()}>
          {busy === "invite" ? <Loader2Icon className="animate-spin" data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
          Create link
        </Button>
      </div>
    </form>
  )
}

function InviteLinks({ invite, onClose }: { invite: RoomInvite; onClose: () => void }) {
  const links = [
    invite.links.tunnel && { label: "Internet", url: invite.links.tunnel },
    invite.links.lan && { label: "Local network", url: invite.links.lan },
    { label: "This machine", url: invite.links.local },
  ].filter(Boolean) as { label: string; url: string }[]
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.")
    }
  }
  return (
    <div className="relative flex flex-col gap-4 rounded-xl border bg-surface p-4 sm:flex-row sm:items-start">
      <Button size="icon-sm" variant="ghost" className="absolute top-2 right-2" onClick={onClose} aria-label="Hide link">
        <XIcon />
      </Button>
      {invite.qrSvg && (
        <div
          className="size-32 shrink-0 rounded-2xl border bg-white p-2 [&_svg]:size-full"
          role="img"
          aria-label={`QR code for ${invite.member.name}'s link`}
          dangerouslySetInnerHTML={{ __html: invite.qrSvg }}
        />
      )}
      <div className="min-w-0 flex-1 space-y-2.5 pr-6">
        <div>
          <p className="font-medium">Link for {invite.member.name}</p>
          <p className="text-sm text-muted-foreground">
            Personal to them, {ROLE_LABEL[invite.member.role].toLowerCase()} access, works until {new Date(invite.member.expiresAt).toLocaleDateString()}. Shown once: send it privately.
          </p>
        </div>
        {links.map((l) => (
          <div key={l.label} className="space-y-1">
            <p className="text-xs text-muted-foreground">{l.label}</p>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate rounded-full border bg-background px-3 py-1.5 font-mono text-xs" title={l.url}>
                {l.url}
              </p>
              <Button size="sm" variant="outline" onClick={() => copy(l.url)}>
                <CopyIcon data-icon="inline-start" /> Copy
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MemberRow({ member: m, busy, run, onInvite }: { member: RoomMemberView; busy: string | null; run: Run; onInvite: (inv: RoomInvite) => void }) {
  const live = m.state === "active"
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <PersonAvatar name={m.name} email={m.email} active={live ? m.online : undefined} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{m.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {m.email}
          {m.online ? " · here now" : m.lastSeenAt ? ` · seen ${timeAgo(Date.parse(m.lastSeenAt))}` : " · hasn't joined yet"}
        </span>
      </span>
      {live ? (
        <div className="w-36">
          <Dropdown<MemberRole>
            variant="pill"
            label="Role"
            datas={ROLES}
            selectedValue={m.role}
            disabled={busy === `role-${m.id}`}
            onSelect={(v) => run(`role-${m.id}`, () => roomApi.setRole(m.id, v as MemberRole))}
            showSearch={false}
          />
        </div>
      ) : (
        <ToneBadge size="sm" tone={m.state === "revoked" ? "danger" : "warning"}>
          {m.state === "revoked" ? "Removed" : "Expired"}
        </ToneBadge>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={`Actions for ${m.name}`}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {m.state !== "revoked" && (
            <DropdownMenuItem onSelect={() => run(`link-${m.id}`, () => roomApi.reissue(m.id, live ? undefined : 7), onInvite)}>
              <RefreshCwIcon /> {live ? "New link (old one stops working)" : "Renew for 7 days"}
            </DropdownMenuItem>
          )}
          {live && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => run(`revoke-${m.id}`, () => roomApi.revoke(m.id))}>
                <UserMinusIcon /> Remove from room
              </DropdownMenuItem>
            </>
          )}
          {m.state === "revoked" && <DropdownMenuItem disabled>Invite them again to restore access</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
