"use client"

import { useEffect, useState } from "react"
import { PlusIcon, SearchIcon, SparklesIcon } from "lucide-react"
import { SkillScope, type SkillInput } from "@shared"
import { useAppStore } from "@/lib/store/app-store"
import { CollapsibleSidebarGroup } from "@/components/shared/collapsible-sidebar-group"
import {
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { endSkillDrag, startSkillDrag } from "../lib/drag"
import { NEW_SKILL } from "../lib/skill-store"
import { SkillDialog } from "./skill-dialog"

const LIBRARY = { scope: SkillScope.Library } as const

/** Sidebar list of the shared skill library: search, edit, and drag onto bots. */
export function SkillLibrary() {
  const skills = useAppStore((s) => s.skills)
  const bots = useAppStore((s) => s.bots)
  const [q, setQ] = useState("")
  const [editing, setEditing] = useState<SkillInput | null>(null)
  // Safety net: a drag cancelled outside any target still ends the drag state.
  useEffect(() => {
    window.addEventListener("dragend", endSkillDrag)
    window.addEventListener("drop", endSkillDrag)
    return () => {
      window.removeEventListener("dragend", endSkillDrag)
      window.removeEventListener("drop", endSkillDrag)
    }
  }, [])
  const shown = skills.filter((s) =>
    (s.name + s.description).toLowerCase().includes(q.toLowerCase())
  )

  return (
    <>
      <CollapsibleSidebarGroup
        id="skills"
        label="Skills"
        className="group-data-[collapsible=icon]:hidden"
        action={
          <SidebarGroupAction
            aria-label="New skill"
            onClick={() => setEditing(NEW_SKILL)}
          >
            <PlusIcon /> <span className="sr-only">New skill</span>
          </SidebarGroupAction>
        }
      >
        <SidebarGroupContent className="space-y-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <SidebarInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills"
              className="pl-7"
            />
          </div>
          <p className="px-2 text-xs text-muted-foreground">
            Drag onto a bot, or manage in a bot&apos;s Skills tab.
          </p>
          <SidebarMenu>
            {shown.map((s) => {
              const users = bots.filter((b) => b.skills.includes(s.name))
              return (
                <SidebarMenuItem key={s.name}>
                  <SidebarMenuButton
                    draggable
                    onDragStart={(e) => startSkillDrag(e, s.name)}
                    onDragEnd={endSkillDrag}
                    onClick={() => setEditing(s)}
                    className="h-auto cursor-grab flex-col items-start gap-0.5 py-2 active:cursor-grabbing"
                  >
                    <div className="flex w-full items-center gap-2">
                      <SparklesIcon className="size-3.5 text-muted-foreground" />
                      <span className="truncate font-mono text-xs">
                        {s.name}
                      </span>
                      <span className="ml-auto flex -space-x-1">
                        {users.map((b) => (
                          <span
                            key={b.id}
                            title={b.name}
                            className="text-xs"
                          >
                            {b.avatar}
                          </span>
                        ))}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
                      {s.description}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
            {!shown.length && (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                No skills
              </li>
            )}
          </SidebarMenu>
        </SidebarGroupContent>
      </CollapsibleSidebarGroup>
      {editing && (
        <SkillDialog
          skill={editing}
          target={LIBRARY}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}
