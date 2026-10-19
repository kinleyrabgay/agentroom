import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { EffortLevel } from '../../../shared/enums.js';
import type { ModelOption } from '../../../shared/types/index.js';
import { MODEL_FETCH_TIMEOUT_MS } from '../../config/constants.js';
import { withIdleSession } from './idle-session.js';

const KNOWN_EFFORTS = new Set<string>(Object.values(EffortLevel));

/** SDK model info → the picker's ModelOption. Pure. */
export function toModelOption(m: ModelInfo): ModelOption {
  const efforts = !m.supportsEffort ? [] : (m.supportedEffortLevels ?? []).filter((e): e is EffortLevel => KNOWN_EFFORTS.has(e));
  return {
    value: m.value,
    label: m.displayName || m.value,
    description: m.description ?? '',
    ...(m.resolvedModel ? { resolvedModel: m.resolvedModel } : {}),
    efforts,
  };
}

/** Models the user's Claude Code login can use, with their effort levels. */
export function fetchClaudeModels(cwd: string, timeoutMs = MODEL_FETCH_TIMEOUT_MS): Promise<ModelOption[]> {
  return withIdleSession(cwd, timeoutMs, async (q) => (await q.supportedModels()).map(toModelOption));
}
