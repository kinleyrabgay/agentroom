import { EffortLevel, type ModelOption, type ProviderModels } from "@shared"

export const EFFORT_LABEL: Record<EffortLevel, string> = {
  [EffortLevel.Low]: "Low",
  [EffortLevel.Medium]: "Medium",
  [EffortLevel.High]: "High",
  [EffortLevel.XHigh]: "Extra high",
  [EffortLevel.Max]: "Max",
}

/** Find the option for a stored model value (alias like "sonnet" or a full id). */
export function findModel(models: ProviderModels | null, value: string | undefined): ModelOption | undefined {
  if (!value || !models) return undefined
  return models.models.find((m) => m.value === value || m.resolvedModel === value)
}

/** Display name for a model value, falling back to the raw id. */
export const modelLabel = (models: ProviderModels | null, value: string | undefined) => findModel(models, value)?.label ?? value ?? ""

export interface EffectiveModel {
  label: string
  effort?: EffortLevel
  /** True when the bot uses the project's model. */
  inherited: boolean
}

/** What a bot actually runs with: its own model/effort, else the project defaults. */
export function effectiveModel(
  models: ProviderModels | null,
  own: { model?: string; effort?: EffortLevel },
  project: { model?: string; effort?: EffortLevel } | undefined
): EffectiveModel {
  const value = own.model ?? project?.model
  return { label: modelLabel(models, value) || "default model", effort: own.effort ?? project?.effort, inherited: !own.model }
}

export const formatModel = (m: EffectiveModel) => (m.effort ? `${m.label} · ${EFFORT_LABEL[m.effort]}` : m.label)
