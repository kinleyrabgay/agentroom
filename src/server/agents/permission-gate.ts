import { randomUUID } from 'node:crypto';
import { ActorType, AgentEventType, AuditKind, BotStatus } from '../../shared/enums.js';
import type { AuditActor, Config } from '../../shared/types/index.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import { classifyToolCall } from './audit-classify.js';
import type { Hub } from '../realtime/hub.js';
import { decide } from '../safety/permission-policy.js';
import type { PermissionAnswer } from '../providers/provider.js';
import { describeTool } from './tool-descriptions.js';

type Pending = {
  botId: string;
  group: string;
  tool: string;
  input: Record<string, unknown>;
  resolve: (a: PermissionAnswer) => void;
};

/** Optional audit hook: records commands, writes and every approval decision. */
export interface GateAudit {
  record: (entry: NewAuditEntry) => void;
  /** "Name <email>" of the human approving in the UI. */
  humanName: () => string;
}

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
    private readonly audit?: GateAudit,
  ) {}

  ask(botId: string, tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<PermissionAnswer> {
    const decision = decide(tool, input, this.config(), this.sessionAllowed);
    if (decision.action === 'allow') {
      // Auto-allowed reads aren't logged; commands, writes and page actions are.
      if (classifyToolCall(tool, input)) {
        this.log(botId, tool, input, true, {
          type: decision.by === 'session' ? ActorType.Session : ActorType.Policy,
          name: decision.rule,
        });
      }
      return Promise.resolve({ allow: true });
    }

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
        tool,
        input,
        group: decision.sticky ? `${STICKY_PREFIX}${requestId}` : decision.group,
        resolve: (a) => {
          if (prev) this.hub.emit({ type: AgentEventType.BotStatus, botId, status: BotStatus.Working, activity: prev.activity });
          resolve(a);
        },
      });
      signal.addEventListener('abort', () => this.answer(requestId, { allow: false, message: 'Aborted.' }), { once: true });
    });
  }

  /** The human's decision. `actor` defaults to the human in the UI (remote approvals pass their own). */
  resolve(requestId: string, allow: boolean, always = false, actor?: AuditActor) {
    const p = this.pending.get(requestId);
    if (!p) return;
    if (allow && always) this.sessionAllowed.add(p.group);
    const who = actor ?? { type: ActorType.Human, name: this.audit?.humanName() ?? 'human' };
    this.log(p.botId, p.tool, p.input, allow, who, always && allow ? { alwaysAllow: p.group } : undefined, true);
    this.answer(requestId, allow ? { allow: true } : { allow: false, message: DENIED });
  }

  /** Deny everything pending (for one bot, or all). */
  cancel(botId?: string) {
    for (const [id, p] of this.pending) {
      if (!botId || p.botId === botId) {
        this.log(p.botId, p.tool, p.input, false, { type: ActorType.System, name: 'stopped' }, undefined, true);
        this.answer(id, { allow: false, message: 'Stopped by human.' });
      }
    }
  }

  /** Write an audit entry for a tool call decision (approvals are always logged, even for unclassified tools). */
  private log(
    botId: string,
    tool: string,
    input: Record<string, unknown>,
    allowed: boolean,
    actor: AuditActor,
    extra?: Record<string, unknown>,
    approval = false,
  ) {
    if (!this.audit) return;
    const cls = classifyToolCall(tool, input);
    const ctx = this.hub.contextOf(botId);
    this.audit.record({
      kind: cls?.kind ?? AuditKind.Approval,
      actor,
      botId,
      ...(ctx?.goalId ? { goalId: ctx.goalId } : {}),
      ...(ctx?.taskId ? { taskId: ctx.taskId } : {}),
      summary: cls?.summary ?? `${tool} ${describeTool(tool, input, this.cwd).summary}`.trim(),
      decision: allowed ? 'allowed' : 'denied',
      detail: { tool, input: trimInput(input), ...(approval ? { approval: true } : {}), ...extra },
    });
  }

  private answer(requestId: string, a: PermissionAnswer) {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    this.hub.emit({ type: AgentEventType.PermissionResolved, botId: p.botId, requestId, allowed: a.allow });
    p.resolve(a);
  }
}

/** Keep audit detail small: long strings (file contents) are clipped. */
function trimInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}… (${v.length} chars)` : v;
  return out;
}
