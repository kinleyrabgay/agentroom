import { AgentEventType } from '../../shared/enums.js';
import { ACCOUNT_POLL_MS, ACCOUNT_REFRESH_AFTER_RUN_MS } from '../config/constants.js';
import type { Provider } from '../providers/provider.js';
import type { Hub } from '../realtime/hub.js';

/**
 * Keeps account-wide plan usage fresh: on start, every couple of minutes while a UI is open,
 * and shortly after each run. No-op for providers that can't report it.
 */
export class AccountMonitor {
  private poll: NodeJS.Timeout | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private refreshing = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly provider: Provider, private readonly hub: Hub, private readonly cwd: string) {}

  start() {
    if (!this.provider.fetchAccountUsage) return;
    void this.refresh();
    this.poll = setInterval(() => this.hub.hasUi && void this.refresh(), ACCOUNT_POLL_MS);
    this.unsubscribe = this.hub.onEvent((e) => {
      if (e.type !== AgentEventType.RunDone) return;
      clearTimeout(this.debounce);
      this.debounce = setTimeout(() => void this.refresh(), ACCOUNT_REFRESH_AFTER_RUN_MS);
    });
  }

  stop() {
    clearInterval(this.poll);
    clearTimeout(this.debounce);
    this.unsubscribe?.();
  }

  private async refresh() {
    if (this.refreshing || !this.provider.fetchAccountUsage) return;
    this.refreshing = true;
    try {
      const account = await this.provider.fetchAccountUsage(this.cwd);
      if (account) this.hub.setAccount(account);
    } finally {
      this.refreshing = false;
    }
  }
}
