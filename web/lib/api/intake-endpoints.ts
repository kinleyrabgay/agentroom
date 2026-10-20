import type {
  HandoffResult,
  PrReview,
  PrReviewComment,
  PrReviewDetail,
  PrReviewEvent,
  TeamsConfig,
  TeamsStatus,
  TrackerConfig,
  TrackerHandoffInput,
  TrackerId,
  TrackerIssueDetail,
  TrackerIssueFilters,
  TrackerIssuesPage,
  TrackerScope,
  TrackerStatus,
} from "@shared"
import { request } from "./client"

const seg = encodeURIComponent

/** Linear and Jira: credentials stay local, the team/project is committed. Writes to the tracker only from clicks or opt-in rules. */
export const trackerApi = {
  all: () => request<Record<TrackerId, TrackerStatus>>("GET", "/trackers"),
  status: (id: TrackerId) => request<TrackerStatus>("GET", `/trackers/${id}`),
  connect: (id: TrackerId, input: { apiKey?: string; site?: string; email?: string; token?: string }) =>
    request<TrackerStatus & { scopes: TrackerScope[]; viewer: { name: string } }>("PUT", `/trackers/${id}/credentials`, input),
  disconnect: (id: TrackerId) => request<TrackerStatus>("DELETE", `/trackers/${id}/credentials`),
  scopes: (id: TrackerId) => request<TrackerScope[]>("GET", `/trackers/${id}/scopes`),
  saveConfig: (id: TrackerId, config: Partial<Omit<TrackerConfig, "tracker">>) => request<TrackerStatus>("PUT", `/trackers/${id}/config`, config),
  issues: (id: TrackerId, f: TrackerIssueFilters & { refresh?: boolean }) => {
    const q = new URLSearchParams()
    if (f.states?.length) q.set("states", f.states.join(","))
    if (f.query) q.set("q", f.query)
    if (f.mine) q.set("mine", "1")
    if (f.closed) q.set("closed", "1")
    if (f.refresh) q.set("refresh", "1")
    const s = q.toString()
    return request<TrackerIssuesPage>("GET", `/trackers/${id}/issues${s ? `?${s}` : ""}`)
  },
  issue: (id: TrackerId, issue: string) => request<TrackerIssueDetail>("GET", `/trackers/${id}/issues/${seg(issue)}`),
  handoff: (id: TrackerId, input: TrackerHandoffInput) => request<HandoffResult>("POST", `/trackers/${id}/handoff`, input),
  move: (id: TrackerId, issue: string, state: string) => request<{ ok: true }>("POST", `/trackers/${id}/issues/${seg(issue)}/move`, { state }),
}

/** Microsoft Teams intake (outgoing webhook in, Workflows webhook out). Secrets are write-only. */
export const teamsApi = {
  status: () => request<TeamsStatus>("GET", "/teams"),
  update: (patch: Partial<TeamsConfig>) => request<TeamsStatus>("PUT", "/teams/config", patch),
  secrets: (input: { outgoingSecret?: string; workflowUrl?: string }) => request<TeamsStatus>("PUT", "/teams/secrets", input),
  test: () => request<{ ok: true }>("POST", "/teams/test"),
}

/** PR review from a link. Nothing reaches GitHub until `post`. */
export const reviewApi = {
  list: () => request<PrReview[]>("GET", "/reviews"),
  start: (url: string, botId?: string) => request<PrReview>("POST", "/reviews", { url, ...(botId ? { botId } : {}) }),
  get: (id: string) => request<PrReviewDetail>("GET", `/reviews/${seg(id)}`),
  update: (id: string, patch: { summary?: string; suggestedEvent?: PrReviewEvent; comments?: PrReviewComment[]; general?: string[] }) =>
    request<PrReview>("PATCH", `/reviews/${seg(id)}`, patch),
  rerun: (id: string, allowScripts = false) => request<PrReview>("POST", `/reviews/${seg(id)}/rerun`, { allowScripts }),
  post: (id: string, event: PrReviewEvent) => request<PrReview>("POST", `/reviews/${seg(id)}/post`, { event }),
  cleanup: (id: string) => request<PrReview>("POST", `/reviews/${seg(id)}/cleanup`),
  remove: (id: string) => request<{ ok: true }>("DELETE", `/reviews/${seg(id)}`),
}
