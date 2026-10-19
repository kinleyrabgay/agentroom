"use client"

import { useEffect, useLayoutEffect, useRef } from "react"

/** How close to the bottom (px) still counts as "following" the conversation. */
const FOLLOW_PX = 120

/**
 * Keep a scroll container on the latest content: it opens at the bottom (and again whenever
 * `resetKey` changes, e.g. switching bots), and follows new content while the user is at the
 * bottom. Scrolling up stops the following until they scroll back down.
 * Late layout (markdown, images, expanding tool groups) is tracked with a ResizeObserver on
 * the container's first child, so render the content inside one stable wrapper element.
 */
export function useStickToBottom(dep: unknown, resetKey?: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const following = useRef(true)

  const toBottom = () => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_PX
    }
    el.addEventListener("scroll", onScroll, { passive: true })
    const ro = new ResizeObserver(() => {
      if (following.current) toBottom()
    })
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => {
      el.removeEventListener("scroll", onScroll)
      ro.disconnect()
    }
  }, [resetKey])

  // Opened or switched: start at the latest message.
  useLayoutEffect(() => {
    following.current = true
    toBottom()
  }, [resetKey])

  // New content: follow it if the user is at the bottom.
  useLayoutEffect(() => {
    if (following.current) toBottom()
  }, [dep])

  return ref
}
