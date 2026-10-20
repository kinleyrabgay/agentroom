import { ActorType, AuditKind, GoalStatus } from '../../shared/enums.js';
import type { AuditActor, Goal } from '../../shared/types/index.js';
import type { NewAuditEntry } from '../services/audit.service.js';
import { issueRefs, type IssueSources, type SourceIssue } from '../integrations/issues/issue-source.js';
import type { CardSpec } from './teams/cards.js';

/** Who sent a message from a chat tool, already checked against the allow-list by the adapter. */
export interface IntakeUser {
  /** Id in the chat tool (Teams: AAD object id). */
  externalId: string;
  name: string;
  /** Git identity for the audit log, when mapped. */
  identity?: string;
  role: 'member' | 'approver';
}

export interface IntakeMessage {
  /** Which adapter: 'teams' (later 'slack', 'bot-framework'…). */
  channel: string;
  user: IntakeUser;
  /** Plain text with mentions and markup already removed. */
  text: string;
}

export interface IntakeResult {
  /** Answer right away (Teams outgoing webhooks must answer within 5 seconds). */
  reply: CardSpec;
  /** A goal this message started (the adapter remembers it to post updates). */
  goalId?: string;
  /** Slower work (fetching issues for a hand-off); its result is posted when ready. */
  later?: Promise<{ reply: CardSpec; goalId?: string }>;
}

export interface IntakeDeps {
  goals: {
    list(): Goal[];
    start(brief: string, title: string): Goal;
    approve(id: string): Goal;
    replan(id: string, feedback: string): Goal;
  };
  gate: {
    pendingRequests(): { requestId: string; botId: string; tool: string; summary: string; held: boolean }[];
    resolve(requestId: string, allow: boolean, always?: boolean, actor?: AuditActor): void;
  };
  sources: IssueSources;
  /** Injection check on inbound text: a warning (and a security finding) or null. */
  inspect?: (text: string, source: string) => string | null;
  botName: (id: string) => string;
  audit: (e: NewAuditEntry) => void;
}

const TEXT_MAX = 4000;
const TITLE_MAX = 80;
const OPEN = new Set<string>([GoalStatus.Planning, GoalStatus.AwaitingApproval, GoalStatus.Building, GoalStatus.Securing, GoalStatus.Testing, GoalStatus.Reporting, GoalStatus.Paused]);

/** Short code for a permission request, typed back as `allow 3f9a1c`. */
export const requestCode = (requestId: string) => requestId.replace(/-/g, '').slice(0, 6).toLowerCase();

const HELP_HINTS = ['fix ENG-123', 'add CSV export to reports', 'status', 'pending', 'approve G-12', 'changes G-12 <what to change>', 'allow <code>', 'deny <code>'];

/**
 * Chat-tool agnostic intake: turns a message from an allow-listed person into a goal, a hand-off,
 * or an answer (status, approvals). Adapters (Teams today; Slack or a Bot Framework bot later)
 * verify the sender and render the reply.
 */
export class IntakeService {
  constructor(private readonly deps: IntakeDeps) {}

  private actor(m: IntakeMessage): AuditActor {
    return { type: ActorType.External, name: `${m.channel === 'teams' ? 'Teams' : m.channel}: ${m.user.identity ?? m.user.name}` };
  }

  handle(m: IntakeMessage): IntakeResult {
    const text = m.text.trim().slice(0, TEXT_MAX);
    const [word = '', ...rest] = text.split(/\s+/);
    const cmd = word.toLowerCase();
    const arg = rest.join(' ').trim();

    if (!text || cmd === 'help' || cmd === '?') return { reply: help(m.user) };
    if (cmd === 'status') return { reply: this.status() };
    if (cmd === 'pending') return { reply: this.pending() };
    if (['approve', 'changes', 'allow', 'deny'].includes(cmd)) {
      if (m.user.role !== 'approver') {
        return { reply: { title: 'Only approvers can do that', text: `Ask the AgentRoom owner to make you an approver (Settings → Integrations → Teams).`, tone: 'warning' } };
      }
      if (cmd === 'approve') return { reply: this.approve(m, arg) };
      if (cmd === 'changes') return { reply: this.changes(m, arg) };
      return { reply: this.decide(m, arg, cmd === 'allow') };
    }
    return this.work(m, text);
  }

  private status(): CardSpec {
    const open = this.deps.goals.list().filter((g) => OPEN.has(g.status));
    if (!open.length) return { title: 'Nothing running', text: 'No open goals. Mention me with what you need.', hints: ['fix ENG-123', 'add …'] };
    return {
      title: `${open.length} open ${open.length === 1 ? 'goal' : 'goals'}`,
      facts: open.slice(-10).map((g) => ({ title: g.id, value: `${label(g.status)} · ${g.title}` })),
    };
  }

  private pending(): CardSpec {
    const plans = this.deps.goals.list().filter((g) => g.status === GoalStatus.AwaitingApproval);
    const reqs = this.deps.gate.pendingRequests();
    if (!plans.length && !reqs.length) return { title: 'Nothing is waiting', tone: 'good' };
    const facts = [
      ...plans.map((g) => ({ title: g.id, value: `Plan ready: ${g.title}` })),
      ...reqs.map((r) => ({ title: requestCode(r.requestId), value: `${this.deps.botName(r.botId)} · ${r.tool}: ${r.summary}${r.held ? ' (security review: open AgentRoom)' : ''}` })),
    ];
    return { title: `${facts.length} waiting on someone`, facts, hints: ['approve G-n', 'changes G-n <feedback>', 'allow <code>', 'deny <code>'] };
  }

  private goal(arg: string): Goal | undefined {
    const id = /G-\d+/i.exec(arg)?.[0]?.toUpperCase();
    return id ? this.deps.goals.list().find((g) => g.id === id) : undefined;
  }

  private approve(m: IntakeMessage, arg: string): CardSpec {
    const g = this.goal(arg);
    if (!g) return { title: 'Which goal?', text: 'Write it like `approve G-12`.', tone: 'warning' };
    if (g.status !== GoalStatus.AwaitingApproval) return { title: `${g.id} isn't waiting for approval`, text: `It's ${label(g.status).toLowerCase()}.` };
    this.deps.goals.approve(g.id);
    this.deps.audit({ kind: AuditKind.Goal, actor: this.actor(m), summary: `Approved plan of ${g.id}`, goalId: g.id, decision: 'allowed' });
    return { title: `${g.id} approved`, subtitle: g.title, text: 'The team is building it now.', tone: 'good' };
  }

  private changes(m: IntakeMessage, arg: string): CardSpec {
    const g = this.goal(arg);
    const feedback = arg.replace(/^\s*G-\d+\s*:?\s*/i, '').trim();
    if (!g || !feedback) return { title: 'What should change?', text: 'Write it like `changes G-12 keep the old endpoint working`.', tone: 'warning' };
    if (g.status !== GoalStatus.AwaitingApproval) return { title: `${g.id} isn't waiting for approval`, text: `It's ${label(g.status).toLowerCase()}.` };
    this.deps.goals.replan(g.id, feedback.slice(0, 4000));
    this.deps.audit({ kind: AuditKind.Goal, actor: this.actor(m), summary: `Requested changes to ${g.id}`, goalId: g.id });
    return { title: `Re-planning ${g.id}`, subtitle: g.title, text: 'The planner is updating the plan with your feedback.' };
  }

  private decide(m: IntakeMessage, arg: string, allow: boolean): CardSpec {
    const code = arg.trim().toLowerCase();
    if (!code) return { title: 'Which request?', text: 'Write `pending` to see the codes, then `allow <code>`.', tone: 'warning' };
    const matches = this.deps.gate.pendingRequests().filter((r) => requestCode(r.requestId).startsWith(code));
    if (matches.length !== 1) return { title: matches.length ? 'More than one request matches' : 'No waiting request has that code', text: 'Write `pending` for the current codes.', tone: 'warning' };
    const r = matches[0]!;
    if (r.held) return { title: 'This one needs AgentRoom', text: 'It was held by the security check; review the findings in AgentRoom.', tone: 'warning' };
    this.deps.gate.resolve(r.requestId, allow, false, this.actor(m));
    return { title: `${allow ? 'Allowed' : 'Denied'}: ${r.tool}`, subtitle: `${this.deps.botName(r.botId)} · ${r.summary}`, tone: allow ? 'good' : 'attention' };
  }

  /** Free text: hand off referenced issues, or start a goal from the words. */
  private work(m: IntakeMessage, text: string): IntakeResult {
    const warning = this.deps.inspect?.(text, `a Teams message from ${m.user.name}`) ?? null;
    if (warning) {
      this.deps.audit({ kind: AuditKind.Intake, actor: this.actor(m), summary: 'Refused a message that reads like a prompt injection', decision: 'denied', detail: { text: text.slice(0, 500) } });
      return { reply: { title: "I didn't start this", text: 'The message reads like instructions aimed at the bots themselves, so it was flagged for review. Start it from AgentRoom if it is intended.', tone: 'attention' } };
    }
    const refs = issueRefs(text);
    if (refs.length) {
      const later = this.handoffRefs(m, refs, text);
      return { reply: { title: `Looking up ${refs.join(', ')}…`, text: 'I’ll post here when the team has it.' }, later };
    }
    return this.startGoal(m, text);
  }

  private startGoal(m: IntakeMessage, text: string): IntakeResult {
    const title = text.replace(/\s+/g, ' ').slice(0, TITLE_MAX);
    const brief = `${text}\n\n— Requested by ${m.user.name} in Microsoft Teams.`;
    const goal = this.deps.goals.start(brief, title);
    this.deps.audit({ kind: AuditKind.Intake, actor: this.actor(m), summary: `Started ${goal.id} from Teams: ${title}`, goalId: goal.id });
    return {
      goalId: goal.id,
      reply: { title: `Planning ${goal.id}`, subtitle: title, text: 'I’ll post the plan here for approval before anything is built.', tone: 'accent' },
    };
  }

  private async handoffRefs(m: IntakeMessage, refs: string[], text: string): Promise<{ reply: CardSpec; goalId?: string }> {
    const found: SourceIssue[] = [];
    const missing: string[] = [];
    for (const ref of refs) {
      const hit = await this.deps.sources.resolve(ref);
      if (hit) found.push(hit);
      else missing.push(ref);
    }
    if (!found.length) {
      // Nothing matched a connected tracker: treat the words as the request itself.
      const r = this.startGoal(m, text);
      return { reply: { ...r.reply, subtitle: `${missing.join(', ')} not found in a connected tracker · ${r.reply.subtitle ?? ''}` }, ...(r.goalId ? { goalId: r.goalId } : {}) };
    }
    // One hand-off per source; the lead gets the note with the original message.
    const bySource = new Map<string, SourceIssue[]>();
    for (const f of found) bySource.set(f.source, [...(bySource.get(f.source) ?? []), f]);
    let goalId: string | undefined;
    const started: string[] = [];
    for (const [sourceId, items] of bySource) {
      const source = this.deps.sources.get(items[0]!.source)!;
      const res = await source.handoff({ ids: items.map((i) => i.id), note: `${text}\n\n— Requested by ${m.user.name} in Microsoft Teams.` });
      goalId ??= res.goal?.id;
      started.push(`${items.map((i) => i.ref).join(', ')} → ${res.goal ? res.goal.id : this.deps.botName(res.botId)}`);
      this.deps.audit({ kind: AuditKind.Handoff, actor: this.actor(m), summary: `Handed ${source.label} ${items.map((i) => i.ref).join(', ')} to ${this.deps.botName(res.botId)} from Teams`, ...(res.goal ? { goalId: res.goal.id } : {}), detail: { source: sourceId } });
    }
    return {
      ...(goalId ? { goalId } : {}),
      reply: {
        title: goalId ? `Planning ${goalId}` : 'Handed off',
        subtitle: found.map((f) => `${f.ref} ${f.title}`).join(' · ').slice(0, 200),
        facts: started.map((s) => ({ title: 'Started', value: s })),
        ...(missing.length ? { text: `Not found in a connected tracker: ${missing.join(', ')}.` } : {}),
        links: found.filter((f) => f.url).slice(0, 3).map((f) => ({ title: f.ref, url: f.url! })),
        tone: 'accent',
      },
    };
  }
}

function help(user: IntakeUser): CardSpec {
  return {
    title: 'AgentRoom',
    text: `Mention me with what you need and the team plans it. Mention an issue (ENG-123, WEB-4X, #45) to hand it off.${user.role === 'approver' ? ' As an approver you can also approve plans and requests.' : ''}`,
    hints: user.role === 'approver' ? HELP_HINTS : HELP_HINTS.slice(0, 4),
  };
}

const LABELS: Record<string, string> = {
  [GoalStatus.Planning]: 'Planning',
  [GoalStatus.AwaitingApproval]: 'Plan ready',
  [GoalStatus.Building]: 'Building',
  [GoalStatus.Securing]: 'Security check',
  [GoalStatus.Testing]: 'Testing',
  [GoalStatus.Reporting]: 'Reporting',
  [GoalStatus.Paused]: 'Paused',
  [GoalStatus.Done]: 'Done',
  [GoalStatus.Failed]: 'Failed',
};
export const label = (s: string) => LABELS[s] ?? s;
