import type { GithubProjectService } from '../github/github-project.service.js';
import type { HandoffService } from '../github/handoff.service.js';
import type { SentryService } from '../sentry/sentry.service.js';
import type { HandoffResult, SentryHandoffInput } from '../../../shared/types/index.js';
import type { IssueSource, SourceIssue } from './issue-source.js';

/** The GitHub Project board as an issue source ("#45" → the board card for issue 45). */
export function githubSource(github: GithubProjectService, handoff: HandoffService): IssueSource {
  const list = async (): Promise<SourceIssue[]> => {
    const board = await github.board({ refresh: true });
    const names = new Map(board.project.columns.map((c) => [c.id, c.name]));
    return board.items.map((i) => ({
      source: 'github',
      id: i.id,
      ref: i.number !== undefined ? `#${i.number}` : i.title,
      title: i.title,
      ...(i.url ? { url: i.url } : {}),
      state: i.statusId ? (names.get(i.statusId) ?? '') : '',
    }));
  };
  return {
    id: 'github',
    label: 'GitHub',
    ready: () => !!github.config(),
    list,
    matches: (ref) => /^#\d+$/.test(ref),
    find: async (ref) => (await list()).find((i) => i.ref === ref) ?? null,
    handoff: (input) => handoff.handoff({ itemIds: input.ids, ...(input.botId ? { botId: input.botId } : {}), ...(input.note ? { note: input.note } : {}) }),
  };
}

/** Sentry as an issue source ("WEB-4X" → that issue, when the prefix is one of the configured projects). */
export function sentrySource(sentry: SentryService, handoff: (input: SentryHandoffInput) => Promise<HandoffResult>): IssueSource {
  const toSource = (i: { id: string; shortId: string; title: string; permalink?: string; status?: string }): SourceIssue => ({
    source: 'sentry',
    id: i.id,
    ref: i.shortId,
    title: i.title,
    ...(i.permalink ? { url: i.permalink } : {}),
    state: i.status ?? 'unresolved',
  });
  const ready = () => {
    const st = sentry.status();
    return !!st.config && st.hasToken;
  };
  return {
    id: 'sentry',
    label: 'Sentry',
    ready,
    list: async () => (await sentry.issues({ sort: 'new', period: '24h', status: 'unresolved' })).issues.map(toSource),
    // Sentry short ids are PROJECT-XX; without a project list any prefix is worth a lookup.
    matches: (ref) => {
      const projects = sentry.config()?.projects ?? [];
      const prefix = ref.split('-')[0]!.toLowerCase();
      return /^[A-Z][A-Z0-9]*-[A-Z0-9]+$/.test(ref) && (!projects.length || projects.some((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '') === prefix.replace(/[^a-z0-9]/g, '')));
    },
    find: async (ref) => {
      const page = await sentry.issues({ query: ref, status: 'all', period: '14d' });
      const hit = page.issues.find((i) => i.shortId.toUpperCase() === ref.toUpperCase());
      return hit ? toSource(hit) : null;
    },
    handoff: (input) => handoff({ issueIds: input.ids, ...(input.botId ? { botId: input.botId } : {}), ...(input.note ? { note: input.note } : {}) }),
  };
}
