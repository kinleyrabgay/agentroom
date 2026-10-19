import { randomUUID } from 'node:crypto';
import { AgentEventType, BotStatus } from '../../shared/enums.js';
import type { Config } from '../../shared/types/index.js';
import type { Hub } from '../realtime/hub.js';
import { decide } from '../safety/permission-policy.js';
import type { PermissionAnswer } from '../providers/provider.js';
import { describeTool } from './tool-descriptions.js';

type Pending = { botId: string; group: string; resolve: (a: PermissionAnswer) => void };

const DENIED = 'The human denied this action. Choose a different approach or ask them.';
const STICKY_PREFIX = '__sticky__';

/**
 * Asks the human for approval when the policy says so, and remembers "Always allow" choices
 * for this server session. Dangerous (sticky) asks are never remembered.
 */
export class PermissionGate {
  private pending = new Map<string, Pending>();
  private sessionAllowed = new Set<string>();

  constructor(
    private readonly hub: Hub,
    private readonly config: () => Config,
    private readonly cwd: string,
  ) {}

  ask(botId: string, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionAnswer> {
    const decision = decide(tool, input, this.config(), this.sessionAllowed);
    if (decision.action === 'allow') return Promise.resolve({ allow: true });

    const requestId = randomUUID();
    const prev = this.hub.statuses[botId];
    this.hub.emit({ type: AgentEventType.BotStatus, botId, status: BotStatus.Waiting, activity: `Needs approval: ${tool}` });
    this.hub.emit({
      type: AgentEventType.PermissionRequest,
      botId,
      requestId,
      tool,
      input,
      reason: decision.reason,
      summary: describeTool(tool, input, this.cwd).summary,
    });

    return new Promise((resolve) => {
      this.pending.set(requestId, {
        botId,
        group: decision.sticky ? `${STICKY_PREFIX}${requestId}` : decision.group,
        resolve: (a) => {
          if (prev) this.hub.emit({ type: AgentEventType.BotStatus, botId, status: BotStatus.Working, activity: prev.activity });
          resolve(a);
        },
      });
      signal.addEventListener('abort', () => this.answer(requestId, { allow: false, message: 'Aborted.' }), { once: true });
    });
  }

  resolve(requestId: string, allow: boolean, always = false) {
    const p = this.pending.get(requestId);
    if (!p) return;
    if (allow && always) this.sessionAllowed.add(p.group);
    this.answer(requestId, allow ? { allow: true } : { allow: false, message: DENIED });
  }

  /** Deny everything pending (for one bot, or all). */
  cancel(botId?: string) {
    for (const [id, p] of this.pending) {
      if (!botId || p.botId === botId) this.answer(id, { allow: false, message: 'Stopped by human.' });
    }
  }

  private answer(requestId: string, a: PermissionAnswer) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    this.hub.emit({ type: AgentEventType.PermissionResolved, botId: p.botId, requestId, allowed: a.allow });
    p.resolve(a);
  }
}
