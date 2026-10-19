import { ProviderId } from '../../shared/enums.js';
import { ClaudeProvider } from './claude/claude.provider.js';
import type { Provider } from './provider.js';

const factories: Record<string, () => Provider> = {
  [ProviderId.Claude]: () => new ClaudeProvider(),
};

export const availableProviders = () => Object.keys(factories);

export function createProvider(id: string): Provider {
  const make = factories[id];
  if (!make) throw new Error(`Unknown provider "${id}". Available: ${availableProviders().join(', ')}`);
  return make();
}
