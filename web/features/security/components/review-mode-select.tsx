"use client"

import { ShieldIcon } from "lucide-react"
import { SecurityReviewMode } from "@shared"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { REVIEW_MODE_META } from "../constants"

/** Security review mode picker: Auto / Always / Off. */
export function ReviewModeSelect({
  value,
  onChange,
  size = "sm",
  className,
  id,
}: {
  value: SecurityReviewMode
  onChange: (v: SecurityReviewMode) => void
  size?: "sm" | "default"
  className?: string
  id?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SecurityReviewMode)}>
      <SelectTrigger id={id} size={size} className={cn("gap-1.5", className)} aria-label="Security review">
        <ShieldIcon className="size-3.5 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.values(SecurityReviewMode).map((m) => (
          <SelectItem key={m} value={m}>
            Review: {REVIEW_MODE_META[m].label}
            {m === SecurityReviewMode.Auto && <span className="text-muted-foreground"> (recommended)</span>}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
