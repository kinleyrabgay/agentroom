"use client"

import { useEffect, useMemo, useState } from "react"
import { ExternalLinkIcon, MoreHorizontalIcon, RotateCwIcon, SearchIcon, Settings2Icon, UnplugIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import type { SentryProject } from "@shared"
import { cn } from "@/lib/utils"
import { sentryApi } from "@/lib/api/endpoints"
import { timeAgo } from "@/lib/time"
import { useNow } from "@/hooks/use-now"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Dropdown } from "@/components/kit/dropdown"
import { Segmented } from "@/components/kit/segmented"
import { PageActions } from "@/components/layout/page-actions"
import { ASSIGNED_OPTIONS, DEFAULT_FILTERS, LEVEL_OPTIONS, PERIOD_OPTIONS, SORT_OPTIONS, STATUS_OPTIONS, type SentryFilters } from "../constants"
import { loadIssues, loadStatus, setFilters } from "../lib/actions"
import { setSentry, useSentryStore } from "../lib/sentry-store"

const SEARCH_DEBOUNCE_MS = 400
/** Dropdown value for "no filter". */
const ANY = "__any__"

/** Freshness, Refresh and the setup menu, in the top bar. */
export function SentryActions() {
  const status = useSentryStore((s) => s.status)
  const loading = useSentryStore((s) => s.loading)
  const fetchedAt = useSentryStore((s) => s.fetchedAt)
  const now = useNow()
  const config = status?.config

  return (
    <PageActions>
      <span className="hidden text-xs text-muted-foreground tabular-nums lg:inline">
        {loading ? "Updating…" : fetchedAt ? `Updated ${timeAgo(fetchedAt, now)}` : ""}
      </span>
      <Button variant="outline" size="icon-sm" onClick={() => void loadIssues()} disabled={loading} aria-label="Refresh issues">
        <RotateCwIcon className={cn(loading && "animate-spin")} />
      </Button>
      <SetupMenu org={config?.org} host={config?.host} />
    </PageActions>
  )
}

/** Search, filter pills (changed ones highlighted), then period and sort on the right. */
export function SentryToolbar() {
  const filters = useSentryStore((s) => s.filters)
  const status = useSentryStore((s) => s.status)
  const config = status?.config
  const [projects, setProjects] = useState<SentryProject[]>([])
  const [environments, setEnvironments] = useState<string[]>([])

  useEffect(() => {
    if (!config?.org) return
    sentryApi.projects(config.org).then(setProjects).catch(() => {})
    sentryApi.environments().then(setEnvironments).catch(() => {})
  }, [config?.org])

  // Only the configured projects are offered (all of the org when none are configured).
  const configured = config?.projects
  const offered = useMemo(() => (configured?.length ? projects.filter((p) => configured.includes(p.slug)) : projects), [projects, configured])
  const changed =
    filters.projects.length > 0 ||
    (!!filters.environment && filters.environment !== config?.environment) ||
    filters.status !== DEFAULT_FILTERS.status ||
    !!filters.level ||
    filters.assigned !== DEFAULT_FILTERS.assigned

  return (
    <div className="flex flex-col gap-2.5">
      <SearchBox value={filters.query} />
      <div className="flex flex-wrap items-center gap-1.5">
        <Dropdown<string>
          variant="pill"
          label="Project"
          multiple
          active={filters.projects.length > 0}
          placeholder="All"
          hint="Find a project"
          datas={offered.map((p) => ({ value: p.slug, label: p.name, sublabel: p.platform }))}
          selectedValue={filters.projects}
          displayLimit={1}
          notfound={projects.length ? "No projects match." : "Loading projects…"}
          onSelect={(v) => setFilters({ projects: v as string[] })}
        />
        <Dropdown<string>
          variant="pill"
          label="Environment"
          active={!!filters.environment && filters.environment !== config?.environment}
          showSearch={environments.length > 8}
          datas={[{ value: ANY, label: config?.environment ? `Default (${config.environment})` : "All" }, ...environments.map((e) => ({ value: e, label: e }))]}
          selectedValue={filters.environment || ANY}
          onSelect={(v) => setFilters({ environment: v === ANY ? "" : (v as string) })}
        />
        <Dropdown<string>
          variant="pill"
          label="Status"
          active={filters.status !== DEFAULT_FILTERS.status}
          showSearch={false}
          datas={STATUS_OPTIONS}
          selectedValue={filters.status}
          onSelect={(v) => setFilters({ status: v as SentryFilters["status"] })}
        />
        <Dropdown<string>
          variant="pill"
          label="Level"
          active={!!filters.level}
          showSearch={false}
          datas={LEVEL_OPTIONS.map((o) => ({ value: o.value || ANY, label: o.value ? o.label : "Any" }))}
          selectedValue={filters.level || ANY}
          onSelect={(v) => setFilters({ level: (v === ANY ? "" : v) as SentryFilters["level"] })}
        />
        <Dropdown<string>
          variant="pill"
          label="Assigned"
          active={filters.assigned !== DEFAULT_FILTERS.assigned}
          showSearch={false}
          datas={ASSIGNED_OPTIONS}
          selectedValue={filters.assigned}
          onSelect={(v) => setFilters({ assigned: v as SentryFilters["assigned"] })}
        />
        {changed && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setFilters({ ...DEFAULT_FILTERS, query: filters.query })}>
            <XIcon data-icon="inline-start" /> Reset
          </Button>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Segmented
            aria-label="Period"
            value={filters.period}
            onChange={(period) => setFilters({ period })}
            options={PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.value, title: o.label }))}
          />
          <Dropdown<string>
            variant="pill"
            label="Sort"
            showSearch={false}
            datas={SORT_OPTIONS}
            selectedValue={filters.sort}
            onSelect={(v) => setFilters({ sort: v as SentryFilters["sort"] })}
          />
        </div>
      </div>
    </div>
  )
}

/** Debounced search; Enter applies immediately, Escape clears. */
function SearchBox({ value }: { value: string }) {
  const [text, setText] = useState(value)
  // Follow outside changes (Reset) without an effect.
  const [prev, setPrev] = useState(value)
  if (prev !== value) {
    setPrev(value)
    setText(value)
  }
  useEffect(() => {
    if (text === value) return
    const t = setTimeout(() => setFilters({ query: text }), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [text, value])

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") setFilters({ query: text })
          if (e.key === "Escape" && text) setText("")
        }}
        placeholder="Search issues   e.g. TypeError  url:*checkout*  release:2.4.1"
        aria-label="Search issues (Sentry search syntax)"
        className="h-10 rounded-full pl-10 text-sm"
      />
    </div>
  )
}

function SetupMenu({ org, host }: { org?: string; host?: string }) {
  const disconnect = async () => {
    try {
      await sentryApi.disconnect()
      setSentry({ issues: [], nextCursor: null, selected: [], details: {}, editing: false, openIssueId: null })
      await loadStatus()
      toast.success("Sentry disconnected", { description: "Your token stays in local secrets." })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const sentryUrl = org ? (host && !/sentry\.io/.test(host) ? `${host.replace(/\/$/, "")}/organizations/${org}/issues/` : `https://${org}.sentry.io/issues/`) : undefined
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Sentry settings">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {org && <DropdownMenuLabel className="font-mono text-xs font-normal text-muted-foreground">{org}</DropdownMenuLabel>}
        {sentryUrl && (
          <DropdownMenuItem asChild>
            <a href={sentryUrl} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> Open in Sentry
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setSentry({ editing: true })}>
          <Settings2Icon /> Change org or projects
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={disconnect}>
          <UnplugIcon /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
