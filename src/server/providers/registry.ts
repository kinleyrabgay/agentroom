import { ProviderId } from '../../shared/enums.js';
import { ClaudeProvider } from './claude/claude.provider.js';
import { CodexProvider } from './codex/codex.provider.js';
import { GeminiProvider } from './gemini/gemini.provider.js';
import { OpenAICompatProvider } from './openai-compat/openai-compat.provider.js';
import type { Provider, ProviderDeps } from './provider.js';

/** Settings-free defaults, for callers outside the server (CLI checks). */
const NO_DEPS: ProviderDeps = {
  engine: () => ({
    codex: { sandbox: 'workspace-write', network: false, priceInPerMtok: 0, priceOutPerMtok: 0 },
    gemini: { approvalMode: 'auto_edit', sandbox: true, priceInPerMtok: 0, priceOutPerMtok: 0 },
    openaiCompat: { baseUrl: 'http://localhost:11434/v1', model: '', priceInPerMtok: 0, priceOutPerMtok: 0, maxTurns: 40 },
    fallback: { enabled: true, onRateLimit: true, onOutage: true, onError: false },
    learning: { minSamples: 10, trackOutcomes: true, evalBudgetUsd: 0.5 },
  }),
  secret: () => undefined,
};

const factories: Record<string, (deps: ProviderDeps) => Provider> = {
  [ProviderId.Claude]: () => new ClaudeProvider(),
  [ProviderId.Codex]: (d) => new CodexProvider(d),
  [ProviderId.Gemini]: (d) => new GeminiProvider(d),
  [ProviderId.OpenAICompat]: (d) => new OpenAICompatProvider(d),
};

/** Providers that aren't verified end to end against the real service. */
export const EXPERIMENTAL_PROVIDERS: ReadonlySet<string> = new Set([ProviderId.Codex, ProviderId.Gemini, ProviderId.OpenAICompat]);

export const availableProviders = () => Object.keys(factories);

export function createProvider(id: string, deps: ProviderDeps = NO_DEPS): Provider {
  const make = factories[id];
  if (!make) throw new Error(`Unknown provider "${id}". Available: ${availableProviders().join(', ')}`);
  return make(deps);
}

/** One instance per provider, created on first use. The project's main provider is passed in already built. */
export class ProviderPool {
  private readonly instances = new Map<string, Provider>();

  constructor(
    readonly primary: Provider,
    private readonly deps: ProviderDeps,
    /** Already-built providers (tests, custom adapters). */
    preset: Provider[] = [],
  ) {
    for (const p of [primary, ...preset]) this.instances.set(p.id, p);
  }

  get(id: string): Provider {
    let p = this.instances.get(id);
    if (!p) {
      p = createProvider(id, this.deps);
      this.instances.set(id, p);
    }
    return p;
  }
}
