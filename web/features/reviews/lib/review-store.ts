"use client"

import { create } from "zustand"
import type { PrReview, PrReviewDetail } from "@shared"
import { reviewApi } from "@/lib/api/intake-endpoints"

interface ReviewState {
  reviews: PrReview[]
  loaded: boolean
  error: string | null
  /** Review shown in full (`#/reviews/R-3`). */
  openId: string | null
  details: Record<string, PrReviewDetail>
}

export const useReviewStore = create<ReviewState>(() => ({ reviews: [], loaded: false, error: null, openId: null, details: {} }))

export const setReviews = (patch: Partial<ReviewState>) => useReviewStore.setState(patch)

export const isRunning = (r: PrReview) => r.state === "preparing" || r.state === "reviewing"

export async function loadReviews() {
  try {
    const reviews = await reviewApi.list()
    const prev = useReviewStore.getState()
    // Details of reviews whose state moved on are stale: drop them so they reload.
    const details = { ...prev.details }
    for (const r of reviews) if (details[r.id] && details[r.id]!.review.updatedAt !== r.updatedAt) delete details[r.id]
    setReviews({ reviews, loaded: true, error: null, details })
  } catch (e) {
    setReviews({ loaded: true, error: (e as Error).message })
  }
}

export async function loadReviewDetail(id: string) {
  const d = await reviewApi.get(id)
  useReviewStore.setState((s) => ({ details: { ...s.details, [id]: d }, reviews: s.reviews.map((r) => (r.id === id ? d.review : r)) }))
  return d
}

/** Replace one review in the list and its detail (after an edit). */
export function putReview(review: PrReview) {
  useReviewStore.setState((s) => ({
    reviews: s.reviews.some((r) => r.id === review.id) ? s.reviews.map((r) => (r.id === review.id ? review : r)) : [review, ...s.reviews],
    details: s.details[review.id] ? { ...s.details, [review.id]: { ...s.details[review.id]!, review } } : s.details,
  }))
}

export function reviewLabel(id: string) {
  const r = useReviewStore.getState().reviews.find((x) => x.id === id)
  return r ? `#${r.number}` : id
}
