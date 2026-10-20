import type { AutopilotStatus } from "@shared"
import type { Tone } from "@/components/kit/tone"

/** How each autopilot state reads in the UI. */
export const AUTOPILOT_STATUS: Record<AutopilotStatus, { label: string; tone: Tone }> = {
  reproducing: { label: "Reproducing", tone: "brand" },
  reproduced: { label: "Reproduced", tone: "info" },
  not_reproduced: { label: "Couldn't reproduce", tone: "warning" },
  needs_human: { label: "Needs you", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  unverified: { label: "Not verified", tone: "warning" },
  ready: { label: "Ready for review", tone: "success" },
  pr_opened: { label: "PR opened", tone: "success" },
}

/** Confidence score → tone: green from 80, amber from 50. */
export function confidenceTone(score: number): Tone {
  return score >= 80 ? "success" : score >= 50 ? "warning" : "danger"
}
