import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { PrReviewComment, PrReviewEvent, TeamsConfig, TrackerHandoffInput, TrackerId, TrackerIssueFilters } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { TrackerService } from '../../integrations/issues/tracker.service.js';
import { TrackerError } from '../../integrations/issues/tracker-client.js';
import type { TeamsService } from '../../intake/teams/teams.service.js';
import { TEAMS_INBOUND_PATH } from '../../intake/teams/teams.service.js';
import type { PrReviewService } from '../../review/pr-review.service.js';
import { body, respond } from '../respond.js';

const TRACKERS = new Set<TrackerId>(['linear', 'jira']);

/** Linear and Jira: connect, pick a team/project, list issues, hand them to bots, explicit status moves. */
export function trackerRoutes(api: Hono, trackers: Record<TrackerId, TrackerService>, audit: HumanAudit) {
  const pick = (id: string) => {
    if (!TRACKERS.has(id as TrackerId)) throw new TrackerError(`Unknown tracker "${id}".`);
    return trackers[id as TrackerId];
  };
  api.get('/trackers', (c) => c.json({ linear: trackers.linear.status(), jira: trackers.jira.status() }));
  api.get('/trackers/:id', (c) => respond(c, () => pick(c.req.param('id')).status()));
  api.put('/trackers/:id/credentials', async (c) => {
    const b = await body<{ apiKey?: string; site?: string; email?: string; token?: string }>(c);
    return respond(c, () => pick(c.req.param('id')).connect(b));
  });
  api.delete('/trackers/:id/credentials', (c) => respond(c, () => pick(c.req.param('id')).disconnect()));
  api.get('/trackers/:id/scopes', (c) => respond(c, () => pick(c.req.param('id')).scopes()));
  api.put('/trackers/:id/config', async (c) => {
    const b = await body(c);
    return respond(c, () => pick(c.req.param('id')).saveConfig(b));
  });
  api.get('/trackers/:id/issues', (c) =>
    respond(c, () => {
      const q = c.req.query();
      const filters: TrackerIssueFilters = {
        ...(q.states ? { states: q.states.split(',').filter(Boolean) } : {}),
        ...(q.q ? { query: q.q.slice(0, 200) } : {}),
        ...(q.mine === '1' ? { mine: true } : {}),
        ...(q.closed === '1' ? { closed: true } : {}),
      };
      return pick(c.req.param('id')).issues(filters, { refresh: q.refresh === '1' });
    }),
  );
  api.get('/trackers/:id/issues/:issue', (c) => respond(c, () => pick(c.req.param('id')).detail(c.req.param('issue'))));
  api.post('/trackers/:id/handoff', async (c) => {
    const b = await body<TrackerHandoffInput>(c);
    return respond(c, async () => {
      const t = pick(c.req.param('id'));
      const res = await t.handoff(b);
      audit(AuditKind.Handoff, `Handed ${b.issueIds?.length ?? 0} ${t.label} ${b.issueIds?.length === 1 ? 'issue' : 'issues'} to ${res.botId}`, { ...(res.goal ? { goalId: res.goal.id } : {}), botId: res.botId });
      return res;
    });
  });
  /** Explicit, clicked status change. */
  api.post('/trackers/:id/issues/:issue/move', async (c) => {
    const { state } = await body<{ state?: string }>(c);
    return respond(c, async () => {
      if (!state) throw new TrackerError('Pick a state.');
      await pick(c.req.param('id')).moveTo(c.req.param('issue'), state, 'clicked in AgentRoom');
    });
  });
}

/** Teams setup (local, session-token API). */
export function teamsRoutes(api: Hono, teams: TeamsService, humanName: () => string) {
  api.get('/teams', (c) => c.json(teams.status()));
  api.put('/teams/config', async (c) => {
    const b = await body<Partial<TeamsConfig>>(c);
    return respond(c, () => teams.updateConfig(b, humanName()));
  });
  api.put('/teams/secrets', async (c) => {
    const b = await body<{ outgoingSecret?: string; workflowUrl?: string }>(c);
    return respond(c, () => teams.setSecrets(b, humanName()));
  });
  api.post('/teams/test', (c) => respond(c, () => teams.test(humanName())));
}

/**
 * The Teams outgoing webhook, reachable through the public tunnel. No session token: the HMAC
 * signature (and the allow-list behind it) is the authentication.
 */
export function teamsPublicRoutes(app: Hono, teams: TeamsService) {
  app.post(TEAMS_INBOUND_PATH, async (c) => {
    const key = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!teams.allow(key)) return c.json({ error: 'Too many requests' }, 429);
    const raw = Buffer.from(await c.req.arrayBuffer());
    const res = teams.inbound(raw, c.req.header('authorization'));
    c.header('cache-control', 'no-store');
    return c.json(res.body, res.status as 200);
  });
}

/** PR review from a link: start, edit the draft, post only on click. */
export function reviewRoutes(api: Hono, reviews: PrReviewService, humanName: () => string) {
  api.get('/reviews', (c) => c.json(reviews.list()));
  api.post('/reviews', async (c) => {
    const b = await body<{ url?: string; botId?: string }>(c);
    return respond(c, () => reviews.start({ url: String(b.url ?? ''), ...(b.botId ? { botId: b.botId } : {}), by: humanName() }));
  });
  api.get('/reviews/:id', (c) => respond(c, () => reviews.detail(c.req.param('id'))));
  api.patch('/reviews/:id', async (c) => {
    const b = await body<{ summary?: string; suggestedEvent?: PrReviewEvent; comments?: PrReviewComment[]; general?: string[] }>(c);
    return respond(c, () => reviews.update(c.req.param('id'), b));
  });
  api.post('/reviews/:id/rerun', async (c) => {
    const b = await body<{ allowScripts?: boolean }>(c);
    return respond(c, () => reviews.rerun(c.req.param('id'), { allowScripts: b.allowScripts === true, by: humanName() }));
  });
  api.post('/reviews/:id/post', async (c) => {
    const b = await body<{ event?: PrReviewEvent }>(c);
    return respond(c, () => reviews.post(c.req.param('id'), { event: (b.event ?? 'COMMENT') as PrReviewEvent, by: humanName() }));
  });
  api.post('/reviews/:id/cleanup', (c) => respond(c, () => reviews.cleanup(c.req.param('id'))));
  api.delete('/reviews/:id', (c) => respond(c, () => reviews.remove(c.req.param('id'))));
}
