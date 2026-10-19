"use client"

import { EmptyState } from "@/components/kit/state-view"
import { GithubMark } from "@/components/kit/brand-icons"
import { ConnectForm } from "./connect-form"

/** First run: paste the project URL, preview its columns, done. */
export function SetupCard() {
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-10">
        <EmptyState
          // EmptyState takes a lucide icon; the GitHub mark has the same shape (className in, svg out).
          icon={GithubMark}
          title="Connect your GitHub project board"
          description="See your project's columns and cards here, assign yourself, and hand cards to the team."
          className="py-6"
        />
        <div className="rounded-2xl border bg-card p-5">
          <ConnectForm />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Saved to <code className="font-mono">.agentroom/github/project.json</code> so your team shares it. AgentRoom uses your{" "}
            <code className="font-mono">gh</code> login and only writes to GitHub when you assign or unassign yourself.
          </p>
        </div>
      </div>
    </div>
  )
}
