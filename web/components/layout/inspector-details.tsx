"use client"

import type { ReactNode } from "react"
import { View } from "@/lib/constants"
import { useAppStore } from "@/lib/store/app-store"
import { TaskInspector } from "@/features/tasks/components/task-sheet/task-inspector"
import { githubItemLabel, GithubItemInspector } from "@/features/github/components/item-inspector"
import { useGithubStore } from "@/features/github/lib/github-store"
import { sentryIssueLabel, SentryIssueInspector } from "@/features/sentry/components/issue-inspector"
import { useSentryStore } from "@/features/sentry/lib/sentry-store"
import { contextModuleLabel, ModuleInspector } from "@/features/context/components/module-inspector"
import { useContextStore } from "@/features/context/lib/context-store"

/** What the Inspector shows besides a bot: the open issue, card or task of the current page. */
export interface InspectorDetail {
  /** Changes when a different thing opens (brings the detail to the front). */
  key: string
  /** Short name for the switcher, e.g. "WEB-4X". */
  label: string
  node: ReactNode
}

/**
 * The detail for the current page, or null. Each page registers its own here as it moves
 * from a Sheet into the Inspector: read the page's open id from its store and return its panel.
 */
export function useInspectorDetail(): InspectorDetail | null {
  const view = useAppStore((s) => s.view)
  const taskId = useAppStore((s) => s.selectedTaskId)
  const issueId = useSentryStore((s) => s.openIssueId)
  const issueLabel = useSentryStore((s) => (s.openIssueId ? sentryIssueLabel(s.openIssueId) : ""))
  const itemId = useGithubStore((s) => s.openItemId)
  const itemLabel = useGithubStore((s) => (s.openItemId ? githubItemLabel(s.openItemId) : ""))
  const moduleId = useContextStore((s) => s.openModuleId)
  const moduleLabel = useContextStore((s) => (s.openModuleId ? contextModuleLabel(s.openModuleId) : ""))
  if (view === View.Work && taskId) return { key: `task:${taskId}`, label: taskId, node: <TaskInspector /> }
  if (view === View.Sentry && issueId) return { key: `sentry:${issueId}`, label: issueLabel, node: <SentryIssueInspector id={issueId} /> }
  if (view === View.Github && itemId) return { key: `github:${itemId}`, label: itemLabel, node: <GithubItemInspector id={itemId} /> }
  if (view === View.Context && moduleId) return { key: `context:${moduleId}`, label: moduleLabel, node: <ModuleInspector id={moduleId} /> }
  return null
}
