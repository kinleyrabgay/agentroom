"use client"

/* eslint-disable @next/next/no-img-element -- static export: avatars are remote GitHub images */
import { useEffect } from "react"
import {
  ArrowDownIcon,
  BotIcon,
  CalendarRangeIcon,
  CircleDotIcon,
  ClockIcon,
  ExternalLinkIcon,
  FlagIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  MessageSquareIcon,
  TagIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import type { Goal, GithubItem, GithubUser } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { Markdown } from "@/components/shared/markdown"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { OPTION_COLORS } from "../constants"
import { loadDetail, setAssigned } from "../lib/actions"
import { itemRef } from "../lib/board-view"
import { setGithub, useGithubStore } from "../lib/github-store"
import { GoalBadge } from "./goal-badge"
import { HandoffForm } from "./handoff-form"
import { ItemTypeIcon } from "./item-type-icon"
import { LabelPill } from "./label-pill"

const COMMENTS_SHOWN = 5

/** Card details: properties, description, linked PRs and recent comments, with Assign me and Hand off. */
export function ItemSheet({ goalFor }: { goalFor: (itemId: string) => Goal | undefined }) {
  const openId = useGithubStore((s) => s.openItemId)
  const board = useGithubStore((s) => s.board)
  const detail = useGithubStore((s) => (openId ? s.details[openId] : undefined))
  const item = board?.items.find((i) => i.id === openId) ?? detail?.item
  const viewer = board?.viewer
  const column = board?.project.columns.find((c) => c.id === item?.statusId)

  useEffect(() => {
    if (openId) void loadDetail(openId)
  }, [openId])

  const close = () => setGithub({ openItemId: null })
  const mine = !!item && !!viewer && item.assignees.some((a) => a.login === viewer.login)
  const goal = item ? goalFor(item.id) : undefined

  return (
    <Sheet open={!!openId} onOpenChange={(o) => !o && close()}>
      <SheetContent
        className={cn(
          "flex w-full flex-col gap-0 overflow-hidden p-0",
          "data-[side=right]:sm:max-w-2xl"
        )}
      >
        {item && (
          <>
            <SheetHeader className="gap-3 border-b p-5 pr-14">
              <RefLine item={item} goal={goal} />
              <SheetTitle className="text-lg leading-snug font-semibold text-balance">{item.title}</SheetTitle>
              <SheetDescription className="sr-only">GitHub card details</SheetDescription>
              <div className="flex items-center gap-2">
                {item.url && (
                  <Button asChild size="sm" variant="outline">
                    <a href={item.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLinkIcon data-icon="inline-start" /> Open on GitHub
                    </a>
                  </Button>
                )}
                {item.contentId && viewer && (
                  <Button size="sm" variant="ghost" onClick={() => setAssigned(item, !mine)}>
                    {mine ? <UserMinusIcon data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
                    {mine ? "Unassign me" : "Assign me"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground" onClick={() => document.getElementById("handoff")?.scrollIntoView({ behavior: "smooth" })}>
                  Hand off <ArrowDownIcon data-icon="inline-end" />
                </Button>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <section className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-3">
                <Property icon={CircleDotIcon} label="Status">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: OPTION_COLORS[column?.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} />
                  <span className="truncate">{column?.name ?? "No status"}</span>
                </Property>
                <Property icon={FlagIcon} label="Priority">
                  {item.priority ?? <Muted>None</Muted>}
                </Property>
                <Property icon={CalendarRangeIcon} label="Sprint">
                  {item.iteration ?? <Muted>None</Muted>}
                </Property>
                <Property icon={FolderGit2Icon} label="Repository">
                  {item.repo ? <span className="truncate font-mono text-xs" title={item.repo}>{item.repo.split("/").pop()}</span> : <Muted>Draft</Muted>}
                </Property>
                <Property icon={ClockIcon} label="Updated">
                  <span title={new Date(item.updatedAt).toLocaleString()}>{timeAgo(Date.parse(item.updatedAt))}</span>
                </Property>
                <Property icon={GitPullRequestIcon} label="Pull requests">
                  {item.linkedPrs.length ? `${item.linkedPrs.length} linked` : <Muted>None</Muted>}
                </Property>
              </section>

              <div className="space-y-6 p-5">
                <Section icon={UsersIcon} title="Assignees" count={item.assignees.length}>
                  {item.assignees.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.assignees.map((u) => <UserChip key={u.login} user={u} you={u.login === viewer?.login} />)}
                    </div>
                  ) : (
                    <Muted>No one is assigned.</Muted>
                  )}
                </Section>

                {item.labels.length > 0 && (
                  <Section icon={TagIcon} title="Labels">
                    <div className="flex flex-wrap gap-1.5">{item.labels.map((l) => <LabelPill key={l.name} label={l} />)}</div>
                  </Section>
                )}

                {item.linkedPrs.length > 0 && (
                  <Section icon={GitPullRequestIcon} title="Linked pull requests">
                    <ul className="divide-y overflow-hidden rounded-xl border">
                      {item.linkedPrs.map((pr) => (
                        <li key={pr.url}>
                          <a href={pr.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60">
                            <GitPullRequestIcon className="size-3.5 shrink-0 text-emerald-500" />
                            <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
                            <span className="truncate">{pr.title ?? ""}</span>
                            <Badge variant="outline" className="ml-auto text-[10px] capitalize">{pr.state.toLowerCase()}</Badge>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </Section>
                )}

                <Section title="Description">
                  <div className="rounded-xl border bg-muted/20 p-4">
                    {!detail ? (
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                      </div>
                    ) : detail.body.trim() ? (
                      <Markdown text={detail.body} />
                    ) : (
                      <Muted>No description.</Muted>
                    )}
                  </div>
                </Section>

                {detail && detail.comments.length > 0 && (
                  <Section
                    icon={MessageSquareIcon}
                    title="Recent comments"
                    count={detail.comments.length}
                    hint={detail.comments.length > COMMENTS_SHOWN ? `latest ${COMMENTS_SHOWN}` : undefined}
                  >
                    <ol className="space-y-4">
                      {detail.comments.slice(-COMMENTS_SHOWN).map((c, i) => (
                        <li key={i} className="flex gap-3">
                          <img
                            src={`https://github.com/${encodeURIComponent(c.author)}.png?size=64`}
                            alt=""
                            className="mt-0.5 size-7 shrink-0 rounded-full border bg-muted"
                          />
                          <div className="min-w-0 flex-1 overflow-hidden rounded-xl border">
                            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs">
                              <span className="font-medium">{c.author}</span>
                              <span className="text-muted-foreground" title={new Date(c.createdAt).toLocaleString()}>
                                {timeAgo(Date.parse(c.createdAt))}
                              </span>
                            </div>
                            <div className="px-3 py-2.5">
                              <Markdown text={c.body} />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </Section>
                )}

                <section id="handoff" className="scroll-mt-4 rounded-2xl border bg-muted/30 p-4">
                  <div className="mb-4 flex items-start gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                      <BotIcon className="size-4.5" />
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold">Hand off to the team</h3>
                      <p className="text-xs text-muted-foreground">
                        Everything above (title, description, labels, comments) goes along. Add what only you know.
                      </p>
                    </div>
                  </div>
                  <HandoffForm key={item.id} cards={[item]} onDone={close} />
                </section>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** "org / repo  #4503  Open  [goal]" — the long org name never pushes the number off screen. */
function RefLine({ item, goal }: { item: GithubItem; goal?: Goal }) {
  const [org, repo] = item.repo ? item.repo.split("/") : [undefined, undefined]
  const closed = item.state === "CLOSED" || item.state === "MERGED"
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      <ItemTypeIcon item={item} />
      {item.repo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex min-w-0 items-center gap-1 font-mono">
              <span className="max-w-32 truncate">{org}</span>
              <span>/</span>
              <span className="truncate text-foreground/80">{repo}</span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{item.repo}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="font-mono">{itemRef(item)}</span>
      )}
      {item.number !== undefined && (
        <span className="shrink-0 rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-foreground">#{item.number}</span>
      )}
      {item.state && (
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 text-[10px] capitalize",
            closed ? "border-violet-500/40 text-violet-600 dark:text-violet-300" : "border-emerald-500/40 text-emerald-600 dark:text-emerald-300"
          )}
        >
          {item.state.toLowerCase()}
        </Badge>
      )}
      {goal && <GoalBadge goal={goal} />}
    </div>
  )
}

function Property({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-popover px-4 py-3">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-sm">{children}</div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  hint,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon && <Icon className="size-3.5" />}
        {title}
        {count !== undefined && count > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{count}</span>}
        {hint && <span className="ml-auto font-normal">{hint}</span>}
      </h3>
      {children}
    </section>
  )
}

function UserChip({ user, you }: { user: GithubUser; you: boolean }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs", you && "border-primary/40 bg-primary/5")}>
      <img src={user.avatarUrl} alt="" className="size-5 rounded-full bg-muted" />
      {user.login}
      {you && <span className="text-muted-foreground">(you)</span>}
    </span>
  )
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-muted-foreground">{children}</span>
}
