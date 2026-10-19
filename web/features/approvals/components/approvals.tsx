"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { pendingApprovals } from "@/lib/store/selectors"
import { ApprovalCard } from "./approval-card"

/** Requests waiting on the human, stacked bottom-right. */
export function Approvals() {
  const events = useAppStore((s) => s.events)
  const pending = useMemo(() => pendingApprovals(events), [events])
  if (!pending.length) return null

  return (
    <div className="pointer-events-none fixed right-4 bottom-20 z-40 flex max-h-[70vh] w-[min(440px,calc(100vw-2rem))] flex-col-reverse gap-2 overflow-y-auto">
      {pending.map((p) => (
        <ApprovalCard key={p.requestId} request={p} />
      ))}
    </div>
  )
}
