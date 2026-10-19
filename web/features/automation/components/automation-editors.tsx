"use client"

import { closeSchedule, closeTrigger, useAutomationUi } from "../lib/ui-store"
import { ScheduleDialog } from "./schedule-dialog"
import { TriggerDialog } from "./trigger-dialog"

/** Mounted once in the shell: the schedule and trigger editors, opened from anywhere. */
export function AutomationEditors() {
  const draft = useAutomationUi((s) => s.scheduleDraft)
  const triggerOpen = useAutomationUi((s) => s.triggerOpen)
  const trigger = useAutomationUi((s) => s.trigger)
  return (
    <>
      <ScheduleDialog open={!!draft} onOpenChange={(v) => !v && closeSchedule()} draft={draft} />
      <TriggerDialog open={triggerOpen} onOpenChange={(v) => !v && closeTrigger()} trigger={trigger} />
    </>
  )
}
