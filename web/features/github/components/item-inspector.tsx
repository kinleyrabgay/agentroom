"use client"

/* eslint-disable @next/next/no-img-element -- static export: avatars are remote GitHub images */
import { useEffect } from "react"
import { ExternalLinkIcon, GitPullRequestIcon, MessageSquareIcon, TagIcon, UserMinusIcon, UserPlusIcon, UsersIcon } from "lucide-react"
import type { Goal, GithubItem, GithubUser } from "@shared"
import { cn } from "@/lib/utils"
import { timeAgo } from "@/lib/time"
import { githubApi } from "@/lib/api/endpoints"
import { Markdown } from "@/components/shared/markdown"
import { DetailSection, HandoffSection, InspectorPanel, JumpToHandoff } from "@/components/shared/inspector-panel"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ToneBadge } from "@/components/kit/badge"
import { PropertyGrid } from "@/components/kit/property-grid"
import { OPTION_COLORS } from "../constants"
import { loadDetail, setAssigned } from "../lib/actions"
import { itemRef } from "../lib/board-view"
import { setGithub, useGithubStore } from "../lib/github-store"
import { useGoalsBySource } from "../lib/source-goal"
import { GoalBadge } from "./goal-badge"
import { ItemTypeIcon } from "./item-type-icon"
import { LabelPill } from "./label-pill"

const COMMENTS_SHOWN = 5
const HANDOFF_ID = "github-handoff"

/** Short name for the Inspector switch: "#4503" or "Card". */
export function githubItemLabel(id: string): string {
  const item = useGithubStore.getState().board?.items.find((i) => i.id === id)
  return item?.number !== undefined ? `#${item.number}` : "Card"
}

/** Card details in the Inspector: properties, description, PRs, comments; Assign me; hand-off at the bottom. */
export function GithubItemInspector({ id }: { id: string }) {
  const board = useGithubStore((s) => s.board)
  const detail = useGithubStore((s) => s.details[id])
  const item = board?.items.find((i) => i.id === id) ?? detail?.item
  const viewer = board?.viewer
  const column = board?.project.columns.find((c) => c.id === item?.statusId)
  const goal = useGoalsBySource("github").get(id)

  useEffect(() => {
    void loadDetail(id)
  }, [id])

  const close = () => setGithub({ openItemId: null })
  if (!item) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  const mine = !!viewer && item.assignees.some((a) => a.login === viewer.login)

  return (
    <InspectorPanel
      label={`GitHub card ${itemRef(item)}`}
      onClose={close}
      refLine={<RefLine item={item} goal={goal} />}
      title={item.title}
      actions={
        <>
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
          <JumpToHandoff targetId={HANDOFF_ID} />
        </>
      }
    >
      <div className="space-y-6 p-5">
        <PropertyGrid
          className="rounded-xl border bg-sunken/50 p-4 sm:grid-cols-3"
          items={[
            {
              label: "Status",
              value: (
                <span className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: OPTION_COLORS[column?.color ?? "GRAY"] ?? OPTION_COLORS.GRAY }} aria-hidden />
                  <span className="truncate">{column?.name ?? "No status"}</span>
                </span>
              ),
            },
            { label: "Priority", value: item.priority },
            { label: "Sprint", value: item.iteration },
            {
              label: "Repository",
              value: item.repo ? (
                <span className="font-mono text-[13px]" title={item.repo}>
                  {item.repo.split("/").pop()}
                </span>
              ) : (
                "Draft"
              ),
            },
            { label: "Updated", value: <span title={new Date(item.updatedAt).toLocaleString()}>{timeAgo(Date.parse(item.updatedAt))}</span> },
            { label: "Pull requests", value: item.linkedPrs.length ? `${item.linkedPrs.length} linked` : undefined },
          ]}
        />

        <DetailSection icon={UsersIcon} title="Assignees" count={item.assignees.length}>
          {item.assignees.length ? (
            <div className="flex flex-wrap gap-1.5">
              {item.assignees.map((u) => (
                <UserChip key={u.login} user={u} you={u.login === viewer?.login} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No one is assigned.</p>
          )}
        </DetailSection>

        {item.labels.length > 0 && (
          <DetailSection icon={TagIcon} title="Labels">
            <div className="flex flex-wrap gap-1.5">
              {item.labels.map((l) => (
                <LabelPill key={l.name} label={l} />
              ))}
            </div>
          </DetailSection>
        )}

        {item.linkedPrs.length > 0 && (
          <DetailSection icon={GitPullRequestIcon} title="Linked pull requests" count={item.linkedPrs.length}>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {item.linkedPrs.map((pr) => (
                <li key={pr.url}>
                  <a
                    href={pr.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-2 px-3 py-2 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <GitPullRequestIcon className="size-4 shrink-0 text-success" />
                    <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
                    <span className="truncate">{pr.title ?? ""}</span>
                    <ToneBadge size="sm" tone={pr.state === "MERGED" ? "info" : pr.state === "CLOSED" ? "neutral" : "success"} className="ml-auto capitalize">
                      {pr.state.toLowerCase()}
                    </ToneBadge>
                  </a>
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        <DetailSection title="Description">
          <div className="rounded-xl border p-4">
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
          </div>
        </DetailSection>

        {detail && detail.comments.length > 0 && (
          <DetailSection
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
                    <div className="flex items-center gap-2 border-b bg-sunken/60 px-3 py-1.5 text-xs">
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
          </DetailSection>
        )}

        <HandoffSection
          id={HANDOFF_ID}
          description="Everything above (title, description, labels, comments) goes along. Add what only you know."
          form={{
            count: 1,
            directContent: "the card details",
            send: (input) => githubApi.handoff({ itemIds: [item.id], ...input }),
            later: { source: "github", ids: [item.id], label: item.number ? `#${item.number}` : item.title },
            onDone: close,
          }}
        />
      </div>
    </InspectorPanel>
  )
}

/** "org / repo  #4503  Open  [goal]": the long org name never pushes the number off screen. */
function RefLine({ item, goal }: { item: GithubItem; goal?: Goal }) {
  const [org, repo] = item.repo ? item.repo.split("/") : [undefined, undefined]
  const closed = item.state === "CLOSED" || item.state === "MERGED"
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <ItemTypeIcon item={item} className="size-4" />
      {item.repo ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex min-w-0 items-center gap-1 font-mono" tabIndex={0}>
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
      {item.number !== undefined && <span className="shrink-0 rounded-md border bg-sunken px-1.5 py-0.5 font-mono text-xs text-foreground">#{item.number}</span>}
      {item.state && (
        <ToneBadge size="sm" tone={closed ? "neutral" : "success"} className="capitalize">
          {item.state.toLowerCase()}
        </ToneBadge>
      )}
      {goal && <GoalBadge goal={goal} />}
    </div>
  )
}

function UserChip({ user, you }: { user: GithubUser; you: boolean }) {
  return (
    <span className={cn("flex h-7 items-center gap-1.5 rounded-full border pr-3 pl-0.5 text-[13px]", you ? "tone-brand tone-soft text-foreground" : "bg-surface")}>
      <img src={user.avatarUrl} alt="" className="size-6 rounded-full bg-muted" />
      {user.login}
      {you && <span className="text-muted-foreground">(you)</span>}
    </span>
  )
}
