import type { EffortLevel } from '../enums.js';

/** A model the current provider offers, as shown in the model + effort picker. */
export interface ModelOption {
  /** What to store in bot.md / config.json (alias like "sonnet", or a full id). */
  value: string;
  label: string;
  description: string;
  /** Concrete model id the alias resolves to, when known. */
  resolvedModel?: string;
  /** Effort levels the model accepts; empty when effort isn't supported. */
  efforts: EffortLevel[];
}

/** Response of GET /api/models. */
export interface ProviderModels {
  provider: string;
  models: ModelOption[];
  fetchedAt: number;
}
