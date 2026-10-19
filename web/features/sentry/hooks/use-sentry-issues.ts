"use client"

import { useEffect } from "react"
import { POLL_MS } from "../constants"
import { loadIssues, loadStatus } from "../lib/actions"
import { SentrySetup, useSentryStore } from "../lib/sentry-store"

/**
 * Page lifecycle: check the setup, then load issues; refresh every POLL_MS only while the tab is
 * visible, and as soon as it becomes visible again after a while.
 */
export function useSentryIssues() {
  const setup = useSentryStore((s) => s.setup)

  useEffect(() => {
    void loadStatus()
  }, [])

  useEffect(() => {
    if (setup !== SentrySetup.Connected) return
    void loadIssues()
    const tick = () => {
      if (document.visibilityState === "visible" && useSentryStore.getState().pages <= 1) void loadIssues()
    }
    const timer = setInterval(tick, POLL_MS)
    const onVisible = () => {
      const s = useSentryStore.getState()
      if (document.visibilityState === "visible" && s.pages <= 1 && Date.now() - s.fetchedAt > POLL_MS) void loadIssues()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [setup])
}
