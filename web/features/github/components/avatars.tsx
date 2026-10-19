/* eslint-disable @next/next/no-img-element -- static export: avatars are remote GitHub images */
import type { GithubUser } from "@shared"
import { cn } from "@/lib/utils"

/** Overlapping assignee avatars. */
export function Avatars({ users, max = 3, className }: { users: GithubUser[]; max?: number; className?: string }) {
  if (!users.length) return null
  const shown = users.slice(0, max)
  return (
    <span className={cn("flex -space-x-1.5", className)}>
      {shown.map((u) => (
        <img key={u.login} src={u.avatarUrl} alt={u.login} title={u.login} className="size-6 rounded-full border-2 border-card bg-muted" />
      ))}
      {users.length > max && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full border-2 border-card bg-muted px-0.5 text-xs font-medium">+{users.length - max}</span>
      )}
    </span>
  )
}
