import type { AccountUsage, PlanWindow } from '../../../shared/types/index.js';
import { ACCOUNT_FETCH_TIMEOUT_MS } from '../../config/constants.js';
import { withIdleSession } from './idle-session.js';

type Window = { utilization: number | null; resets_at: string | null } | null | undefined;

/** Plan windows in display order: [response key, label]. */
const WINDOWS: [string, string][] = [
  ['five_hour', 'Session'],
  ['seven_day', 'Weekly'],
  ['seven_day_opus', 'Weekly · Opus'],
  ['seven_day_sonnet', 'Weekly · Sonnet'],
];

/**
 * Account-wide plan usage — the same numbers as Claude Code's `/usage` and status line.
 * Uses the SDK's experimental usage API; returns null when unavailable.
 */
export async function fetchClaudeAccountUsage(cwd: string, timeoutMs = ACCOUNT_FETCH_TIMEOUT_MS): Promise<AccountUsage | null> {
  try {
    return await withIdleSession(cwd, timeoutMs, async (q) => {
      const usageFn = (q as any).usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.bind(q);
      if (!usageFn) return null;
      const [usage, account] = await Promise.all([usageFn({ skipBehaviors: true }), q.accountInfo().catch(() => null)]);
      const rl = usage?.rate_limits;
      const windows: PlanWindow[] = [];
      const push = (key: string, label: string, w: Window) => {
        if (w && w.utilization !== null) windows.push({ key, label, percent: w.utilization, resetsAt: w.resets_at ? Date.parse(w.resets_at) : undefined });
      };
      if (rl) {
        for (const [key, label] of WINDOWS) push(key, label, rl[key]);
        for (const m of rl.model_scoped ?? []) push(`model:${m.display_name}`, `Weekly · ${m.display_name}`, m);
      }
      const extra = rl?.extra_usage;
      return {
        fetchedAt: Date.now(),
        plan: usage?.subscription_type ?? account?.subscriptionType ?? null,
        organization: account?.organization ?? null,
        available: !!usage?.rate_limits_available,
        windows,
        extraUsage: extra?.is_enabled
          ? { usedCredits: extra.used_credits ?? null, monthlyLimit: extra.monthly_limit ?? null, percent: extra.utilization ?? null, currency: extra.currency ?? null }
          : null,
      };
    });
  } catch {
    return null;
  }
}
