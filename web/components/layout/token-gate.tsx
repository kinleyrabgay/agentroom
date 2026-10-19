"use client"

import { useEffect } from "react"
import { useAppStore } from "@/lib/store/app-store"
import { LockIcon } from "lucide-react"
import { initSessionToken } from "@/lib/session"
import { connect } from "@/lib/realtime/socket"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"

/** Reads the session token and connects; renders children only when a token is present. */
export function TokenGate({ children }: { children: React.ReactNode }) {
  const token = useAppStore((s) => s.token)
  const checked = useAppStore((s) => s.tokenChecked)

  // Reading the URL/sessionStorage must happen on the client, after hydration.
  useEffect(() => {
    if (initSessionToken()) connect()
  }, [])
  const state = !checked ? "pending" : token ? "ok" : "missing"

  if (state === "pending") return null
  if (state === "missing") {
    return (
      <div className="grid h-svh place-items-center p-6">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LockIcon />
            </EmptyMedia>
            <EmptyTitle>Missing session token</EmptyTitle>
            <EmptyDescription>
              Open the full URL printed by <code className="font-mono">agentroom start</code> in your terminal.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }
  return <>{children}</>
}
