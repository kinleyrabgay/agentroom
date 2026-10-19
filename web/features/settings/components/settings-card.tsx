"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SECTIONS, type SettingsSection } from "../lib/constants"

/** One section of the Settings page; `id` is the scroll anchor used by the section nav. */
export function SettingsCard({ id, aside, children }: { id: SettingsSection; aside?: React.ReactNode; children: React.ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!
  const Icon = meta.icon
  return (
    <Card id={`settings-${id}`} data-section={id} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-4 text-muted-foreground" />
          {meta.label}
          <span className="ml-auto">{aside}</span>
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
