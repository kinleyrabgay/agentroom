import type { Bot, Goal, GoalSource, HandoffResult, SentryHandoffInput, SentryIssueDetail } from '../../../shared/types/index.js';
import { resolveRepoFiles } from '../../services/repo-files.js';
import { resolveLead } from '../../workflow/roles.js';

export interface SentryHandoffDeps {
  root: string;
  bots: () => Bot[];
  detail: (id: string) => Promise<SentryIssueDetail>;
  startGoal: (brief: string, title: string, sources: GoalSource[]) => Goal;
  sendToBot: (botId: string, text: string) => void;
  /** Error text and stack traces come from the running app: treat as untrusted data. */
  guard?: (text: string, source: string) => string;
  /** The bot can use a Sentry MCP server (more events, tags, Seer). */
  hasSentryTools?: (bot: Bot) => boolean;
}

const TITLE_MAX = 80;
const IN_APP_FRAMES = 8;
const BREADCRUMBS = 12;

/** Hand Sentry issues to a bot: the lead starts a goal run, any other bot gets the brief as a message. */
export async function handoffSentry(deps: SentryHandoffDeps, input: SentryHandoffInput): Promise<HandoffResult> {
  const ids = [...new Set((input.issueIds ?? []).map(String))];
  if (!ids.length) throw new Error('Select at least one issue.');
  const bots = deps.bots();
  const lead = resolveLead(bots);
  const botId = input.botId ?? lead?.id;
  const bot = bots.find((b) => b.id === botId);
  if (!bot) throw new Error(botId ? `Unknown bot "${botId}".` : 'No Team Lead bot found.');

  const files = resolveRepoFiles(deps.root, input.files ?? []);
  const links = (input.links ?? []).map((l) => String(l).trim()).filter(Boolean);
  for (const l of links) if (!/^https?:\/\//i.test(l)) throw new Error(`"${l}" isn't a link (http/https).`);

  const details = await Promise.all(ids.map((id) => deps.detail(id)));
  const brief = buildSentryBrief(details, {
    note: input.note?.trim() ?? '',
    files,
    links,
    guard: deps.guard,
    sentryTools: deps.hasSentryTools?.(bot) ?? false,
  });
  const sources: GoalSource[] = details.map(({ issue }) => ({
    type: 'sentry',
    itemId: issue.id,
    shortId: issue.shortId,
    title: issue.title,
    ...(issue.permalink ? { url: issue.permalink } : {}),
    ...(issue.project.slug ? { project: issue.project.slug } : {}),
  }));

  if (bot.id === lead?.id) {
    const first = details[0]!.issue;
    const title = details.length === 1 ? `Fix ${first.shortId}: ${first.title}` : `Fix ${details.length} Sentry issues: ${first.shortId} …`;
    return { botId: bot.id, goal: deps.startGoal(brief, title.slice(0, TITLE_MAX), sources) };
  }
  deps.sendToBot(bot.id, brief);
  return { botId: bot.id };
}

/** Markdown brief: per issue the facts, the error, in-app frames and recent breadcrumbs; then how to fix and the human's notes. */
export function buildSentryBrief(
  details: SentryIssueDetail[],
  opts: { note: string; files: string[]; links: string[]; guard?: (text: string, source: string) => string; sentryTools: boolean },
): string {
  const guard = opts.guard ?? ((t: string) => t);
  const parts: string[] = [details.length === 1 ? 'Fix this production error reported by Sentry.' : `Fix these ${details.length} production errors reported by Sentry.`];

  for (const { issue, event } of details) {
    const lines = [`### ${issue.shortId} · ${issue.title}`];
    if (issue.permalink) lines.push(issue.permalink);
    lines.push(
      [
        `Project: ${issue.project.slug}`,
        `Level: ${issue.level}${issue.unhandled ? ' (unhandled)' : ''}`,
        `${issue.count} events, ${issue.userCount} users`,
        `First seen ${issue.firstSeen.slice(0, 10)}, last seen ${issue.lastSeen.slice(0, 16).replace('T', ' ')}`,
        issue.substatus ? `Status: ${issue.substatus}` : '',
        event?.release ? `Release: ${event.release}` : '',
        event?.environment ? `Environment: ${event.environment}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
    );

    const body: string[] = [];
    if (issue.culprit) body.push(`Culprit: ${issue.culprit}`);
    for (const ex of event?.exceptions ?? []) {
      body.push('', `**${ex.type}: ${ex.value}**${ex.handled === false ? ' (unhandled)' : ''}`);
      const frames = [...ex.frames].reverse();
      const app = frames.filter((f) => f.inApp).slice(0, IN_APP_FRAMES);
      const shown = app.length ? app : frames.slice(0, 3);
      if (shown.length) body.push(app.length ? 'In-app frames (innermost first):' : 'Top frames (no in-app frames marked):');
      for (const f of shown) {
        const at = `${f.filename}${f.lineNo ? `:${f.lineNo}` : ''}${f.function ? ` in ${f.function}` : ''}`;
        const line = f.context.find(([n]) => n === f.lineNo)?.[1]?.trim();
        body.push(`- ${at}${line ? `\n    \`${line.slice(0, 200)}\`` : ''}`);
      }
    }
    if (!event?.exceptions.length && event?.message) body.push('', `Message: ${event.message}`);
    if (event?.request?.url) body.push('', `Request: ${event.request.method ?? ''} ${event.request.url}`.trim());
    const crumbs = (event?.breadcrumbs ?? []).slice(-BREADCRUMBS);
    if (crumbs.length) {
      body.push('', 'Breadcrumbs before the error (oldest first):');
      for (const b of crumbs) body.push(`- ${[b.timestamp?.slice(11, 19), b.category, b.message].filter(Boolean).join(' · ').slice(0, 200)}`);
    }
    if (event?.contexts.length) body.push('', event.contexts.map((c) => `${c.name}: ${c.value}`).join(' · '));
    lines.push('', guard(body.join('\n').trim() || '_No event details._', `Sentry ${issue.shortId}`));
    parts.push(lines.join('\n'));
  }

  const refs = details.map((d) => d.issue.shortId).join(', ');
  parts.push(
    [
      '## How to fix',
      '1. Find the root cause from the stack trace: start at the innermost in-app frame and read the code around it.',
      '2. Reproduce it with a failing test (or explain why it cannot be reproduced locally).',
      '3. Fix the cause, not just the symptom; handle the bad input/state where it enters.',
      '4. Run the tests and make sure the new one passes.',
      `5. Mention ${refs} in the commit message (e.g. \`Fixes ${details[0]!.issue.shortId}\`) so Sentry links the fix.`,
      opts.sentryTools
        ? 'You have Sentry MCP tools: use them for more events, tags or a different occurrence if the latest one is not enough. Do not change issue status in Sentry.'
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (opts.note) parts.push(`## Notes from the human\n${opts.note}`);
  if (opts.files.length) parts.push(`## Files to read\n${opts.files.map((f) => `- \`${f}\``).join('\n')}`);
  if (opts.links.length) parts.push(`## Links\n${opts.links.map((l) => `- ${l}`).join('\n')}`);
  return parts.join('\n\n');
}
