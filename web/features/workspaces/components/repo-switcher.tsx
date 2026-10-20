"use client"

import { useEffect } from "react"
import { Dropdown } from "@/components/kit/dropdown"
import { loadWorkspace, selectRepo, useWorkspaceStore } from "../lib/workspace-store"

const ALL = "__all"

/** Multi-repo workspaces: which repo the board and the Context page show (hidden outside a workspace). */
export function RepoSwitcher({ className }: { className?: string }) {
  const workspace = useWorkspaceStore((s) => s.workspace)
  const repo = useWorkspaceStore((s) => s.repo)

  useEffect(() => {
    void loadWorkspace()
  }, [])

  if (!workspace) return null
  return (
    <Dropdown<string>
      variant="pill"
      label="Repo"
      className={className}
      active={!!repo}
      showSearch={workspace.repos.length > 6}
      popoverWidth={240}
      datas={[
        { value: ALL, label: "All repos", sublabel: `${workspace.repos.length} repos, one board` },
        ...workspace.repos.map((r) => ({
          value: r.id,
          label: r.name,
          sublabel: [r.primary ? "primary" : "", r.branch ?? "no git"].filter(Boolean).join(" · "),
        })),
      ]}
      selectedValue={repo ?? ALL}
      onSelect={(v) => selectRepo(v === ALL ? null : (v as string))}
    />
  )
}
