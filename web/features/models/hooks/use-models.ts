"use client"

import { useEffect } from "react"
import { projectApi } from "@/lib/api/endpoints"
import { LoadStatus, useAppStore } from "@/lib/store/app-store"

/** The provider's model list, fetched once per session and cached in the store. */
export function useModels() {
  const models = useAppStore((s) => s.models)
  const status = useAppStore((s) => s.modelsStatus)

  useEffect(() => {
    if (useAppStore.getState().modelsStatus !== LoadStatus.Idle) return
    useAppStore.setState({ modelsStatus: LoadStatus.Loading })
    projectApi
      .models()
      .then((models) => useAppStore.setState({ models, modelsStatus: LoadStatus.Ready }))
      .catch(() => useAppStore.setState({ modelsStatus: LoadStatus.Error }))
  }, [])

  return { models, status }
}
