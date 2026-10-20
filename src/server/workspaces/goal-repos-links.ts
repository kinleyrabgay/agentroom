/** The block that ties a goal's pull requests across a workspace's repos together ("Part 2 of 3"). */

export const LINKS_START = '<!-- agentroom:linked-prs -->';
export const LINKS_END = '<!-- /agentroom:linked-prs -->';

export interface PrPart {
  repo: string;
  name: string;
  url?: string;
}

export function linkedPrSection(goalId: string, parts: PrPart[], current: string): string {
  const i = parts.findIndex((p) => p.repo === current);
  return [
    LINKS_START,
    `> **Part ${i + 1} of ${parts.length}** of AgentRoom goal ${goalId}, which spans ${parts.length} repos. Review and merge them together.`,
    '>',
    ...parts.map((p) => `> - \`${p.name}\`: ${p.repo === current ? 'this PR' : p.url ? p.url : 'not opened yet'}`),
    LINKS_END,
  ].join('\n');
}

/** Put the block at the top of a PR body, replacing an earlier one. */
export function withLinkedSection(body: string, section: string): string {
  const a = body.indexOf(LINKS_START);
  const b = body.indexOf(LINKS_END);
  if (a >= 0 && b > a) return `${body.slice(0, a)}${section}${body.slice(b + LINKS_END.length)}`;
  return `${section}\n\n${body}`;
}
