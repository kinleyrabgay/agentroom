"use client"

import { useEffect } from "react"
import { Dropdown } from "@/components/kit/dropdown"
import { loadRoom, selectRepo, useRoomStore } from "../lib/room-store"

const ALL = "__all"

/** Multi-repo rooms: which repo the board and the Context page show (hidden outside a room). */
export function RepoSwitcher({ className }: { className?: string }) {
  const room = useRoomStore((s) => s.room)
  const repo = useRoomStore((s) => s.repo)

  useEffect(() => {
    void loadRoom()
  }, [])

  if (!room) return null
  return (
    <Dropdown<string>
      variant="pill"
      label="Repo"
      className={className}
      active={!!repo}
      showSearch={room.repos.length > 6}
      popoverWidth={240}
      datas={[
        { value: ALL, label: "All repos", sublabel: `${room.repos.length} repos, one board` },
        ...room.repos.map((r) => ({
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
