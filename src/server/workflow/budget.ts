/** Spend limits for goal runs and chats. Pure math, so it's easy to test. */
export interface BudgetInput {
  /** The goal's cap in USD (its own, else the team default); null = no cap. */
  goalCap: number | null;
  goalSpent: number;
  /** Daily cap across all bots; null = no cap. */
  dayCap: number | null;
  daySpent: number;
  /** Fraction of a cap at which to warn (0.8 = 80%). */
  warnAt: number;
}

export type BudgetScope = 'goal' | 'day';

export interface BudgetCheck {
  /** USD left before the tighter cap; Infinity when nothing is capped. */
  remaining: number;
  /** Which cap is used up, if any. */
  exceeded: BudgetScope | null;
  /** Caps at or past the warning line (but not used up). */
  warn: BudgetScope[];
}

/** Below this a run can't do anything useful: treat the cap as used up. */
const MIN_RUN_USD = 0.01;

export function checkBudget(b: BudgetInput): BudgetCheck {
  const goalLeft = b.goalCap === null ? Infinity : b.goalCap - b.goalSpent;
  const dayLeft = b.dayCap === null ? Infinity : b.dayCap - b.daySpent;
  const exceeded: BudgetScope | null = dayLeft < MIN_RUN_USD ? 'day' : goalLeft < MIN_RUN_USD ? 'goal' : null;
  const warn: BudgetScope[] = [];
  if (!exceeded) {
    if (b.goalCap !== null && b.goalSpent >= b.goalCap * b.warnAt) warn.push('goal');
    if (b.dayCap !== null && b.daySpent >= b.dayCap * b.warnAt) warn.push('day');
  }
  return { remaining: Math.max(0, Math.min(goalLeft, dayLeft)), exceeded, warn };
}

export const usd = (n: number) => `$${n.toFixed(2)}`;

/** Remembers which warnings were already sent, so each cap warns once (per goal, per day). */
export class WarnOnce {
  private sent = new Set<string>();

  /** True the first time for this key. */
  first(key: string): boolean {
    if (this.sent.has(key)) return false;
    this.sent.add(key);
    return true;
  }
}

/** Local calendar day, e.g. "2026-10-19" (daily caps reset at local midnight). */
export function dayKey(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
