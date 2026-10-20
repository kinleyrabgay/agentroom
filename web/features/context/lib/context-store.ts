"use client"

import { create } from "zustand"
import type { ContextGraphView, ContextImpact, ContextModuleDetail, ContextStatus } from "@shared"
import { contextApi } from "@/lib/api/endpoints"

export interface ContextState {
  /** Pushed live by the server (StateType.Context); null until the first push or fetch. */
  status: ContextStatus | null
  graph: ContextGraphView | null
  graphError: string | null
  loadingGraph: boolean
  /** Module open in the Inspector. */
  openModuleId: string | null
  details: Record<string, ContextModuleDetail>
  detailErrors: Record<string, string>
  /** Code peek dialog. */
  peek: { path: string; line?: number } | null
  /** Impact mode: pick files, see what depends on them. */
  impactOn: boolean
  impactFiles: string[]
  impact: ContextImpact | null
  /** What bots see (INDEX.md) dialog. */
  indexOpen: boolean
  /** Context page tab (`#/context/<tab>`). */
  tab: ContextTab
  /** Text waiting in the Ask box (set from ⌘K, the Tour and module panels). */
  askDraft: { text: string; at: number } | null
}

export type ContextTab = "map" | "ask" | "tour" | "docs"
export const CONTEXT_TABS: ContextTab[] = ["map", "ask", "tour", "docs"]

export const useContextStore = create<ContextState>(() => ({
  status: null,
  graph: null,
  graphError: null,
  loadingGraph: false,
  openModuleId: null,
  details: {},
  detailErrors: {},
  peek: null,
  impactOn: false,
  impactFiles: [],
  impact: null,
  indexOpen: false,
  tab: "map",
  askDraft: null,
}))

/** Switch the Context page tab; leaving the map closes its panels. */
export function setContextTab(tab: ContextTab) {
  setContext(tab === "map" ? { tab } : { tab, impactOn: false })
}

/** Open Ask with a question ready to send (or edit). */
export function askAbout(text: string) {
  setContext({ tab: "ask", impactOn: false, askDraft: { text, at: Date.now() } })
}

export const setContext = (patch: Partial<ContextState>) => useContextStore.setState(patch)

export async function loadGraph() {
  setContext({ loadingGraph: true })
  try {
    const graph = await contextApi.graph()
    setContext({ graph, graphError: null })
  } catch (e) {
    setContext({ graphError: (e as Error).message })
  } finally {
    setContext({ loadingGraph: false })
  }
}

export async function loadModule(id: string) {
  try {
    const d = await contextApi.module(id)
    useContextStore.setState((s) => ({ details: { ...s.details, [id]: d }, detailErrors: omit(s.detailErrors, id) }))
  } catch (e) {
    useContextStore.setState((s) => ({ detailErrors: { ...s.detailErrors, [id]: (e as Error).message } }))
  }
}

/** A module changed (notes, decisions, rejected claim): keep its detail and the graph in step. */
export function putModule(d: ContextModuleDetail) {
  useContextStore.setState((s) => ({
    details: { ...s.details, [d.id]: d },
    graph: s.graph ? { ...s.graph, modules: s.graph.modules.map((m) => (m.id === d.id ? { ...m, purpose: d.purpose, status: d.status } : m)) } : s.graph,
  }))
}

export async function setImpactFiles(files: string[]) {
  setContext({ impactFiles: files })
  if (!files.length) return setContext({ impact: null })
  try {
    setContext({ impact: await contextApi.impact(files) })
  } catch {
    setContext({ impact: null })
  }
}

/** Live status from the server. A finished sync refreshes the map and the open module. */
export function applyContextStatus(next: ContextStatus) {
  const prev = useContextStore.getState().status
  setContext({ status: next })
  const finished = prev?.syncing && !next.syncing
  const changed = prev && (prev.indexedAt !== next.indexedAt || prev.cards.fresh !== next.cards.fresh || prev.cards.stale !== next.cards.stale)
  if (finished || changed || (!prev && next.built)) {
    const s = useContextStore.getState()
    if (s.graph || finished || changed) void loadGraph()
    if (s.openModuleId) void loadModule(s.openModuleId)
  }
}

export function openModule(id: string | null) {
  setContext({ openModuleId: id })
  if (id) void loadModule(id)
}

function omit<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const next = { ...rec }
  delete next[key]
  return next
}
