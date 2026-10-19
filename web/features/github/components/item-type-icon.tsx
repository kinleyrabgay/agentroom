import { CircleCheckIcon, CircleDotIcon, FileTextIcon, GitMergeIcon, GitPullRequestClosedIcon, GitPullRequestIcon } from "lucide-react"
import { GithubContentType, type GithubItem } from "@shared"
import { cn } from "@/lib/utils"

/** GitHub-style state icon: open (success), merged/completed (chart-4, GitHub's purple), closed PR (danger), draft. */
export function ItemTypeIcon({ item, className }: { item: Pick<GithubItem, "type" | "state">; className?: string }) {
  const c = cn("size-3.5 shrink-0", className)
  if (item.type === GithubContentType.DraftIssue) return <FileTextIcon className={cn(c, "text-muted-foreground")} aria-label="Draft" />
  if (item.type === GithubContentType.PullRequest) {
    if (item.state === "MERGED") return <GitMergeIcon className={cn(c, "text-chart-4")} aria-label="Merged pull request" />
    if (item.state === "CLOSED") return <GitPullRequestClosedIcon className={cn(c, "text-danger")} aria-label="Closed pull request" />
    return <GitPullRequestIcon className={cn(c, "text-success")} aria-label="Open pull request" />
  }
  if (item.state === "CLOSED") return <CircleCheckIcon className={cn(c, "text-chart-4")} aria-label="Closed issue" />
  return <CircleDotIcon className={cn(c, "text-success")} aria-label="Open issue" />
}
