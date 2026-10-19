/** The status vocabulary. Every badge, dot, callout and pill takes one of these, never a raw colour. */
export type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral"

export const TONE_CLASS: Record<Tone, string> = {
  brand: "tone-brand",
  success: "tone-success",
  warning: "tone-warning",
  danger: "tone-danger",
  info: "tone-info",
  neutral: "tone-neutral",
}
