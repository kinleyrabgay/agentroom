"use client"

import { useEffect } from "react"
import { ArrowRightIcon, CalendarRangeIcon, ExternalLinkIcon, FlagIcon, GitPullRequestIcon, UserMinusIcon, UserPlusIcon } from "lucide-react"
import type { Goal } from "@shared"
import { timeAgo } from "@/lib/time"
import { Markdown } from "@/components/shared/markdown"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { OPTION_COLORS } from "../constants"
import { loadDetail, setAssigned } from "../lib/actions"
import { itemRef } from "../lib/board-view"
import { setGithub, useGithubStore } from "../lib/github-store"
import { Avatars } from "./avatars"
import { GoalBadge } from "./goal-badge"
import { ItemTypeIcon } from "./item-type-icon"
import { LabelPill } from "./label-pill"

const COMMENTS_SHOWN = 5

/** Card details: everything on the card, the issue body and recent comments, plus Assign me and Hand off. */
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
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        {item && (
          <>
            <SheetHeader className="space-y-2 border-b p-4 pr-12">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ItemTypeIcon item={item} />
                <span className="font-mono">{item.repo ? `${item.repo}#${item.number}` : itemRef(item)}</span>
                {goal && <GoalBadge goal={goal} />}
              </div>
              <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
              <SheetDescription className="sr-only">GitHub card details</SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {item.url && (
                  <Button asChild size="xs" variant="outline">
                    <a href={item.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLinkIcon data-icon="inline-start" /> Open on GitHub
                    </a>
                  </Button>
                )}
                {item.contentId && viewer && (
                  <Button size="xs" variant={mine ? "ghost" : "secondary"} onClick={() => setAssigned(item, !mine)}>
                    {mine ? <UserMinusIcon data-icon="inline-start" /> : <UserPlusIcon data-icon="inline-start" />}
                    {mine ? "Unassign me" : "Assign me"}
                  </Button>
                )}
                <Button
                  size="xs"
                  className="ml-auto"
                  onClick={() => setGithub({ selected: [item.id], anchor: item.id, handoffOpen: true, openItemId: null })}
                >
                  Hand off <ArrowRightIcon data-icon="inline-end" />
                </Button>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ background: OPTION_COLORS[column?.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} />
                  {column?.name ?? "No status"}
                </dd>
                {item.priority && (
                  <>
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd className="flex items-center gap-1.5"><FlagIcon className="size-3.5 text-muted-foreground" />{item.priority}</dd>
                  </>
                )}
                {item.iteration && (
                  <>
                    <dt className="text-muted-foreground">Sprint</dt>
                    <dd className="flex items-center gap-1.5"><CalendarRangeIcon className="size-3.5 text-muted-foreground" />{item.iteration}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">Assignees</dt>
                <dd className="flex items-center gap-2">
                  {item.assignees.length ? (
                    <>
                      <Avatars users={item.assignees} max={6} />
                      <span className="truncate text-xs text-muted-foreground">{item.assignees.map((a) => a.login).join(", ")}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">No one</span>
                  )}
                </dd>
                {item.labels.length > 0 && (
                  <>
                    <dt className="text-muted-foreground">Labels</dt>
                    <dd className="flex flex-wrap gap-1">{item.labels.map((l) => <LabelPill key={l.name} label={l} />)}</dd>
                  </>
                )}
              </dl>

              {item.linkedPrs.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">Linked pull requests</h3>
                  <ul className="space-y-1">
                    {item.linkedPrs.map((pr) => (
                      <li key={pr.url}>
                        <a href={pr.url} target="_blank" rel="noreferrer noopener" className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-muted">
                          <GitPullRequestIcon className="size-3.5 text-emerald-500" />
                          <span className="font-mono text-xs">#{pr.number}</span>
                          <span className="truncate">{pr.title ?? ""}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground uppercase">{pr.state}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Separator />

              <section>
                {!detail ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                  </div>
                ) : detail.body.trim() ? (
                  <Markdown text={detail.body} />
                ) : (
                  <p className="text-sm text-muted-foreground">No description.</p>
                )}
              </section>

              {detail && detail.comments.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    Recent comments {detail.comments.length > COMMENTS_SHOWN && `(last ${COMMENTS_SHOWN})`}
                  </h3>
                  {detail.comments.slice(-COMMENTS_SHOWN).map((c, i) => (
                    <div key={i} className="rounded-xl border bg-muted/20 p-3">
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        <span className="font-medium">{c.author}</span>
                        <span className="text-muted-foreground">{timeAgo(Date.parse(c.createdAt))}</span>
                      </div>
                      <Markdown text={c.body} />
                    </div>
                  ))}
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
