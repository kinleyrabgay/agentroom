"use client"

import { create } from "zustand"
import { toast } from "sonner"
import type { ContextAsk } from "@shared"
import { contextApi } from "@/lib/api/endpoints"

interface AskState {
  /** This person's questions, newest first (null until loaded). */
  items: ContextAsk[] | null
  loadError: string | null
  /** Questions being answered right now (survive switching tabs). */
  pending: { key: string; question: string; startedAt: number }[]
}

export const useAskStore = create<AskState>(() => ({ items: null, loadError: null, pending: [] }))

export async function loadAsks() {
  try {
    useAskStore.setState({ items: await contextApi.asks(), loadError: null })
  } catch (e) {
    useAskStore.setState({ loadError: (e as Error).message })
  }
}

/** Ask the codebase. Resolves when answered; failures show as a toast and keep the question. */
export async function askQuestion(question: string): Promise<boolean> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  useAskStore.setState((s) => ({ pending: [{ key, question, startedAt: Date.now() }, ...s.pending] }))
  try {
    const item = await contextApi.ask(question)
    useAskStore.setState((s) => ({ items: [item, ...(s.items ?? []).filter((x) => x.id !== item.id)] }))
    if (!item.ok) toast.error(item.error ?? "Couldn't answer that.")
    return item.ok
  } catch (e) {
    toast.error((e as Error).message)
    return false
  } finally {
    useAskStore.setState((s) => ({ pending: s.pending.filter((p) => p.key !== key) }))
  }
}

export async function deleteAsk(id: string) {
  try {
    useAskStore.setState({ items: await contextApi.deleteAsk(id) })
  } catch (e) {
    toast.error((e as Error).message)
  }
}

export async function pinAsk(id: string, moduleId: string) {
  try {
    const next = await contextApi.pinAsk(id, moduleId)
    useAskStore.setState((s) => ({ items: (s.items ?? []).map((x) => (x.id === id ? next : x)) }))
    toast.success("Pinned to the module's notes", { description: "Bots treat notes as rules for that module." })
  } catch (e) {
    toast.error((e as Error).message)
  }
}
