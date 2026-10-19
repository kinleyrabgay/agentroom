"use client"

import { create } from "zustand"
import type { Trigger } from "@shared"
import type { ScheduleDraft } from "../components/schedule-dialog"

interface AutomationUi {
  scheduleDraft: ScheduleDraft | null
  triggerOpen: boolean
  trigger: Trigger | null
}

/** Which automation editor is open (so ⌘K, the composer and pages can open them). */
export const useAutomationUi = create<AutomationUi>(() => ({ scheduleDraft: null, triggerOpen: false, trigger: null }))

export const openSchedule = (draft: ScheduleDraft = {}) => useAutomationUi.setState({ scheduleDraft: draft })
export const closeSchedule = () => useAutomationUi.setState({ scheduleDraft: null })
export const openTrigger = (trigger: Trigger | null = null) => useAutomationUi.setState({ triggerOpen: true, trigger })
export const closeTrigger = () => useAutomationUi.setState({ triggerOpen: false, trigger: null })
