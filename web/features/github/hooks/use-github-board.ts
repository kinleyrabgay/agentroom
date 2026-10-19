"use client"

import { useEffect } from "react"
import { POLL_MS } from "../constants"
import { loadBoard, loadProject } from "../lib/actions"
import { SetupState, useGithubStore } from "../lib/github-store"

/**
 * Board lifecycle while the view is mounted: cached board instantly, then live;
 * refresh every POLL_MS only while the tab is visible, and when it becomes visible again.
 */
export function useGithubBoard() {
  const setup = useGithubStore((s) => s.setup)

  useEffect(() => {
    void loadProject()
  }, [])

  useEffect(() => {
    if (setup !== SetupState.Connected) return
    void loadBoard(false).then(() => loadBoard(true))

    const tick = () => {
      if (document.visibilityState === "visible") void loadBoard(true)
    }
    const timer = setInterval(tick, POLL_MS)
    const onVisible = () => {
      const fetchedAt = useGithubStore.getState().board?.fetchedAt ?? 0
      if (document.visibilityState === "visible" && Date.now() - fetchedAt > POLL_MS) void loadBoard(true)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [setup])
}
