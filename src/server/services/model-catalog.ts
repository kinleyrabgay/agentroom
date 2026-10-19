import type { ModelOption, ProviderModels } from '../../shared/types/index.js';
import type { Provider } from '../providers/provider.js';

/** The provider's model list, fetched once and cached. Callers during the fetch share it. */
export class ModelCatalog {
  private inflight: Promise<ProviderModels> | null = null;

  constructor(private readonly provider: Provider, private readonly cwd: string) {}

  /** Start fetching in the background (call at startup). */
  warm() {
    void this.get();
  }

  get(): Promise<ProviderModels> {
    this.inflight ??= this.provider
      .listModels(this.cwd)
      .catch((): ModelOption[] => [])
      .then((models) => {
        // Don't cache an empty list: a later request retries.
        if (!models.length) this.inflight = null;
        return { provider: this.provider.id, models, fetchedAt: Date.now() };
      });
    return this.inflight;
  }
}
