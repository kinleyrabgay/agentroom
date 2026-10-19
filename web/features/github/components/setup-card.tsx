"use client"

import { GithubMark } from "./github-mark"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ConnectForm } from "./connect-form"

/** First run: paste the project URL, preview its columns, done. */
export function SetupCard() {
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
          <ConnectForm />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Saved to <code className="font-mono">.agentroom/github/project.json</code> so your team shares it. AgentRoom uses your{" "}
            <code className="font-mono">gh</code> login and only writes when you assign or unassign yourself.
          </p>
        </EmptyContent>
      </Empty>
    </div>
  )
}
