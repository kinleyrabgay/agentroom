"use client"

import { SecurityReviewMode } from "@shared"
import { cn } from "@/lib/utils"
import { Dropdown } from "@/components/kit/dropdown"
import { REVIEW_MODE_META } from "../constants"

/** Security review mode picker: Auto / Always / Off, each with what it means. */
export function ReviewModeSelect({
  value,
  onChange,
  size = "sm",
  className,
}: {
  value: SecurityReviewMode
  onChange: (v: SecurityReviewMode) => void
  size?: "sm" | "default"
  className?: string
  /** Kept for callers that pair it with a <Label>; the trigger is labelled "Security review". */
  id?: string
}) {
  return (
    <Dropdown<SecurityReviewMode>
      datas={Object.values(SecurityReviewMode).map((m) => ({
        value: m,
        label: `Review: ${REVIEW_MODE_META[m].label}${m === SecurityReviewMode.Auto ? " (recommended)" : ""}`,
        sublabel: REVIEW_MODE_META[m].description,
      }))}
      selectedValue={value}
      showSearch={false}
      popoverWidth={320}
      onSelect={(v) => onChange(v as SecurityReviewMode)}
      className={cn(size === "sm" ? "h-8 text-[13px]" : "h-9", className)}
    />
  )
}
