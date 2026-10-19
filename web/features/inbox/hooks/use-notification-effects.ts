"use client"

import { useEffect } from "react"
import { toast } from "sonner"
import { plainText } from "@shared"
import { onNotification } from "@/lib/realtime/notification-bus"
import { NOTIFICATION_META } from "../lib/meta"
import { openNotificationTarget } from "../lib/route"

/** Toast every new notification in-app. Away-from-desk alerts (OS notification, sound, voice) come from the server. */
export function useNotificationEffects() {
  useEffect(
    () =>
      onNotification((n) => {
        const meta = NOTIFICATION_META[n.kind]
        const action = meta.action ? { label: meta.action, onClick: () => openNotificationTarget(n) } : undefined
        toast(plainText(n.title, 80), {
          description: n.body ? plainText(n.body, 140) : undefined,
          action,
          duration: action ? 10000 : 5000,
        })
      }),
    []
  )
}

export function NotificationEffects() {
  useNotificationEffects()
  return null
}
