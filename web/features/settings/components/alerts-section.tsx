"use client"

import { AlertPrefsForm } from "@/features/alerts/components/alert-prefs-form"
import { useAlertPrefs } from "@/features/alerts/hooks/use-alert-prefs"
import { SettingsSection } from "../lib/constants"
import { SettingsCard } from "./settings-card"

/** OS notifications, sound and voice — personal, stored in runs/alerts.json. */
export function AlertsSection() {
  const state = useAlertPrefs()
  return (
    <SettingsCard id={SettingsSection.Alerts}>
      <AlertPrefsForm state={state} />
    </SettingsCard>
  )
}
