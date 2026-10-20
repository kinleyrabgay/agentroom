import type { PrReviewComment, PrReviewEvent, PrReviewState } from "@shared"
import type { Tone } from "@/components/kit/tone"

export const REVIEW_STATE: Record<PrReviewState, { label: string; tone: Tone }> = {
  preparing: { label: "Checking out", tone: "brand" },
  reviewing: { label: "Reviewing", tone: "brand" },
  ready: { label: "Draft ready", tone: "warning" },
  posted: { label: "Posted", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
}

export const EVENT_LABEL: Record<PrReviewEvent, string> = {
  COMMENT: "Comment",
  REQUEST_CHANGES: "Request changes",
  APPROVE: "Approve",
}

export const SEVERITY: Record<PrReviewComment["severity"], { label: string; tone: Tone }> = {
  blocker: { label: "Blocker", tone: "danger" },
  major: { label: "Major", tone: "warning" },
  minor: { label: "Minor", tone: "info" },
  nit: { label: "Nit", tone: "neutral" },
}
