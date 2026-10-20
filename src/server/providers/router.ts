import { ProviderId, type EffortLevel, type WorkPhase } from '../../shared/enums.js';
import type { Bot, Config, Settings } from '../../shared/types/index.js';
import { ProviderUnavailableError } from './provider.js';
import { classifyFailure } from './shared/run-events.js';

/** One provider + model a run may use, in the order they're tried. */
export interface RouteAttempt {
  provider: string;
  model: string;
  effort?: EffortLevel;
}

type PhaseRoute = Settings['models'][keyof Settings['models']];

/**
 * The providers a run tries, in order. The phase setting (settings.models[phase]) picks the provider
 * and model inside goals; direct chats use the project provider with the bot's own model. Fallbacks
 * come from the phase; when the first choice isn't Claude, Claude is the implicit last resort.
 * Pure, for testability.
 */
export function planRoute(o: { bot: Bot; phase?: WorkPhase; settings: Settings; config: Pick<Config, 'provider' | 'model' | 'effort'> }): RouteAttempt[] {
  const phases = o.settings.models as Record<string, PhaseRoute | undefined>;
  const p = o.phase ? phases[o.phase] : undefined;
  const ownModel = o.bot.model ?? o.config.model;
  const effort = p?.effort ?? o.bot.effort ?? o.config.effort;
  const primary = p?.provider ?? o.config.provider ?? ProviderId.Claude;
  const chain: RouteAttempt[] = [{ provider: primary, model: p?.model ?? ownModel, ...(effort ? { effort } : {}) }];
  if (o.settings.engine.fallback.enabled) {
    for (const f of p?.fallbacks ?? []) chain.push({ provider: f.provider, model: f.model ?? (f.provider === ProviderId.Claude ? ownModel : ''), ...(effort ? { effort } : {}) });
    if (!chain.some((a) => a.provider === ProviderId.Claude)) chain.push({ provider: ProviderId.Claude, model: ownModel, ...(effort ? { effort } : {}) });
  }
  const seen = new Set<string>();
  return chain.filter((a) => {
    const k = `${a.provider}\u0000${a.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type FallbackReason = 'rate-limit' | 'outage' | 'auth' | 'not-installed' | 'error';

/**
 * Whether a failed attempt may move on to the next provider. Never after the run did something
 * (a tool call): retrying elsewhere could repeat a write or a command.
 */
export function fallbackReason(failure: unknown, o: { progressed: boolean; aborted: boolean; settings: Settings['engine']['fallback'] }): FallbackReason | null {
  if (o.progressed || o.aborted || !o.settings.enabled) return null;
  const reason: FallbackReason | null =
    failure instanceof ProviderUnavailableError ? failure.reason : classifyFailure(failure instanceof Error ? failure.message : String(failure ?? '')) ?? 'error';
  switch (reason) {
    case 'not-installed':
    case 'auth':
      return reason;
    case 'rate-limit':
      return o.settings.onRateLimit ? reason : null;
    case 'outage':
      return o.settings.onOutage ? reason : null;
    default:
      return o.settings.onError ? 'error' : null;
  }
}

const REASON_TEXT: Record<FallbackReason, string> = {
  'rate-limit': 'is rate-limited',
  outage: "isn't responding",
  auth: "isn't signed in",
  'not-installed': "isn't installed",
  error: 'failed',
};

export const PROVIDER_NAMES: Record<string, string> = {
  [ProviderId.Claude]: 'Claude',
  [ProviderId.Codex]: 'Codex',
  [ProviderId.Gemini]: 'Gemini',
  [ProviderId.OpenAICompat]: 'OpenAI-compatible',
};

export const fallbackNote = (from: string, to: string, reason: FallbackReason) =>
  `↪ ${PROVIDER_NAMES[from] ?? from} ${REASON_TEXT[reason]}, so this run continues on ${PROVIDER_NAMES[to] ?? to}.`;
