import type { Bot, Goal, GoalSource, GithubItemDetail, HandoffInput, HandoffResult } from '../../../shared/types/index.js';
import { HANDOFF_COMMENTS } from '../../config/constants.js';
import { resolveRepoFiles } from '../../services/repo-files.js';
import { resolveLead } from '../../workflow/roles.js';

/** What a hand-off needs from the rest of the server (narrow interfaces, easy to fake). */
export interface HandoffDeps {
  root: string;
  bots: () => Bot[];
  itemDetail: (id: string) => Promise<GithubItemDetail>;
  startGoal: (brief: string, title: string, sources: GoalSource[]) => Goal;
  sendToBot: (botId: string, text: string) => void;
  /** Wraps issue bodies/comments as untrusted data and flags prompt injection. */
  guard?: (text: string, source: string) => string;
}

const TITLE_MAX = 80;

/** Hand GitHub cards to a bot: the lead starts a goal run, any other bot gets the brief as a message. */
export class HandoffService {
  constructor(private readonly deps: HandoffDeps) {}

  async handoff(input: HandoffInput): Promise<HandoffResult> {
    const ids = [...new Set(input.itemIds ?? [])];
    if (!ids.length) throw new Error('Select at least one card.');
    const bots = this.deps.bots();
    const lead = resolveLead(bots);
    const botId = input.botId ?? lead?.id;
    const bot = bots.find((b) => b.id === botId);
    if (!bot) throw new Error(botId ? `Unknown bot "${botId}".` : 'No Team Lead bot found.');

    const files = resolveRepoFiles(this.deps.root, input.files ?? []);
    const links = (input.links ?? []).map((l) => String(l).trim()).filter(Boolean);
    for (const l of links) if (!/^https?:\/\//i.test(l)) throw new Error(`"${l}" isn't a link (http/https).`);

    const details = await Promise.all(ids.map((id) => this.deps.itemDetail(id)));
    const brief = buildBrief(details, input.note?.trim() ?? '', files, links, this.deps.guard);
    const sources: GoalSource[] = details.map(({ item }) => ({
      type: 'github',
      itemId: item.id,
      title: item.title,
      ...(item.url ? { url: item.url } : {}),
      ...(item.number !== undefined ? { number: item.number } : {}),
      ...(item.repo ? { repo: item.repo } : {}),
    }));

    if (bot.id === lead?.id) {
      const first = details[0].item.title;
      const title = details.length === 1 ? first : `${details.length} GitHub cards: ${first}`;
      return { botId: bot.id, goal: this.deps.startGoal(brief, title.slice(0, TITLE_MAX), sources) };
    }
    this.deps.sendToBot(bot.id, brief);
    return { botId: bot.id };
  }
}

const ref = (d: GithubItemDetail) => {
  const { item } = d;
  return item.repo && item.number !== undefined ? `${item.repo}#${item.number}` : item.type === 'DraftIssue' ? 'Draft' : '';
};

/** Markdown brief: each card (with body and recent comments), then the human's notes, files and links. */
export function buildBrief(
  details: GithubItemDetail[],
  note: string,
  files: string[],
  links: string[],
  /** Issue text is written by anyone with access to the repo: treat it as untrusted. */
  guard: (text: string, source: string) => string = (t) => t,
): string {
  const parts: string[] = [
    details.length === 1 ? 'Work on this GitHub card.' : `Work on these ${details.length} GitHub cards.`,
  ];
  for (const d of details) {
    const { item } = d;
    const lines = [`### ${[ref(d), item.title].filter(Boolean).join(' ')}`];
    if (item.url) lines.push(item.url);
    const meta = [
      item.labels.length ? `Labels: ${item.labels.map((l) => l.name).join(', ')}` : '',
      item.assignees.length ? `Assignees: ${item.assignees.map((a) => `@${a.login}`).join(', ')}` : '',
      item.priority ? `Priority: ${item.priority}` : '',
      item.linkedPrs.length ? `Linked PRs: ${item.linkedPrs.map((p) => p.url).join(', ')}` : '',
    ].filter(Boolean);
    if (meta.length) lines.push(meta.join(' · '));
    const content = [d.body.trim() || '_No description._'];
    const comments = d.comments.slice(-HANDOFF_COMMENTS);
    if (comments.length) {
      content.push('', '**Recent comments**');
      for (const c of comments) content.push(`- @${c.author} (${c.createdAt.slice(0, 10)}): ${c.body.trim().replace(/\n+/g, ' ')}`);
    }
    lines.push('', guard(content.join('\n'), `GitHub ${ref(d) || item.title}`));
    parts.push(lines.join('\n'));
  }
  if (note) parts.push(`## Notes from the human\n${note}`);
  if (files.length) parts.push(`## Files to read\n${files.map((f) => `- \`${f}\``).join('\n')}`);
  if (links.length) parts.push(`## Links\n${links.map((l) => `- ${l}`).join('\n')}`);
  return parts.join('\n\n');
}
