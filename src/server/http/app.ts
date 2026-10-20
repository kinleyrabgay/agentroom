import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { API_PREFIX, BIND_HOST, PUBLIC_HOST, TOKEN_QUERY, WS_PATH } from '../../shared/constants.js';
import type { Project } from '../../core/project.js';
import type { Team } from '../agents/team.js';
import { WS_UNAUTHORIZED } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';
import type { ClientMessageRouter } from '../realtime/ws.handler.js';
import type { ModelCatalog } from '../services/model-catalog.js';
import type { GoalRunner } from '../workflow/goal-runner.js';
import { devCors, requireToken, tokenMatches } from './auth.js';
import { botRoutes } from './routes/bots.routes.js';
import { infoRoutes } from './routes/info.routes.js';
import { skillRoutes } from './routes/skills.routes.js';
import { goalRoutes } from './routes/goals.routes.js';
import { alertRoutes } from './routes/alerts.routes.js';
import { githubRoutes } from './routes/github.routes.js';
import type { GithubProjectService } from '../integrations/github/github-project.service.js';
import type { HandoffService } from '../integrations/github/handoff.service.js';
import type { AlertService } from '../services/alerts/alert.service.js';
import { taskRoutes } from './routes/tasks.routes.js';
import { findUiDir, serveUi } from './static.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { governanceRoutes } from './routes/governance.routes.js';
import { insightsRoutes } from './routes/insights.routes.js';
import { InsightsService } from '../services/insights.service.js';
import { securityRoutes } from './routes/security.routes.js';
import { uploadRoutes } from './routes/uploads.routes.js';
import type { UploadStore } from '../services/upload.store.js';
import type { SecurityService } from '../security/security.service.js';
import type { AuditService, HumanAudit } from '../services/audit.service.js';
import type { LedgerService } from '../services/ledger.service.js';
import type { SecretsStore } from '../services/secrets.store.js';
import type { McpService } from '../services/mcp/mcp.service.js';
import { mcpRoutes } from './routes/mcp.routes.js';
import { sentryRoutes } from './routes/sentry.routes.js';
import { memoryRoutes } from './routes/memory.routes.js';
import { REMOTE_PUBLIC_PATH, remoteControlRoutes, remotePublicRoutes, tunnelGuard } from './routes/remote.routes.js';
import type { RemoteService } from '../remote/remote.service.js';
import type { AutomationService } from '../automation/automation.service.js';
import { automationRoutes, type RunnerControls } from './routes/automation.routes.js';
import { goalTemplateRoutes } from './routes/goal-templates.routes.js';
import { contextRoutes } from './routes/context.routes.js';
import type { ContextService } from '../context/context.service.js';
import { reviewRoutes, teamsPublicRoutes, teamsRoutes, trackerRoutes } from './routes/intake.routes.js';
import type { TrackerService } from '../integrations/issues/tracker.service.js';
import type { TeamsService } from '../intake/teams/teams.service.js';
import type { PrReviewService } from '../review/pr-review.service.js';
import type { TrackerId } from '../../shared/types/index.js';
import type { SentryService } from '../integrations/sentry/sentry.service.js';
import type { HandoffResult, SentryHandoffInput } from '../../shared/types/index.js';

export interface AppDeps {
  token: string;
  project: Project;
  team: Team;
  hub: Hub;
  models: ModelCatalog;
  goals: GoalRunner;
  alerts: AlertService;
  github: GithubProjectService;
  handoff: HandoffService;
  ledger: LedgerService;
  audit: AuditService;
  /** Records actions the human takes through the API. */
  humanAudit: HumanAudit;
  secrets: SecretsStore;
  mcp: McpService;
  sentry: SentryService;
  sentryHandoff: (input: SentryHandoffInput) => Promise<HandoffResult>;
  /** Phone approvals (tunnel + remote token). */
  remote?: RemoteService;
  /** Schedules, triggers, brief; background mode. */
  automation?: AutomationService;
  runner?: RunnerControls;
  security: SecurityService;
  uploads: UploadStore;
  /** Repo context (module map, cards). */
  context?: ContextService;
  /** Linear and Jira. */
  trackers?: Record<TrackerId, TrackerService>;
  /** Microsoft Teams intake. */
  teams?: TeamsService;
  /** PR review from a link. */
  reviews?: PrReviewService;
  /** "Name <email>" of the human using the UI. */
  humanName: () => string;
  /** Push the board to the UI right after a REST write. */
  boardChanged: () => void;
  router: ClientMessageRouter;
  /** Called when a UI connects, to push the current state. */
  onConnect: () => void;
}

/** HTTP + WebSocket app: token-guarded REST API, the live channel, and the static UI. */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // Through the phone tunnel only the approvals page and its API exist.
  app.use('*', tunnelGuard());

  // Opened as 127.0.0.1? Move the page to localhost, the same site as the previews (see PUBLIC_HOST).
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (c.req.method === 'GET' && url.hostname === BIND_HOST && !url.pathname.startsWith(API_PREFIX) && url.pathname !== WS_PATH && !REMOTE_PUBLIC_PATH.test(url.pathname)) {
      url.hostname = PUBLIC_HOST;
      return c.redirect(url.toString(), 302);
    }
    await next();
  });

  const api = new Hono();
  const cors = devCors(process.env.AGENTROOM_DEV_ORIGIN);
  if (cors) api.use('*', cors);
  api.use('*', requireToken(deps.token));
  infoRoutes(api, deps.project, deps.models);
  botRoutes(api, deps.project, deps.team);
  skillRoutes(api, deps.project);
  taskRoutes(api, deps.project, deps.boardChanged);
  goalRoutes(api, deps.goals, deps.humanAudit, deps.project.goalTemplates);
  memoryRoutes(api, deps.project, deps.humanAudit);
  goalTemplateRoutes(api, deps.project, deps.humanAudit);
  settingsRoutes(api, deps.project, deps.secrets, deps.hub, deps.humanAudit);
  mcpRoutes(api, deps.mcp, deps.humanAudit);
  sentryRoutes(api, deps.sentry, deps.sentryHandoff, deps.humanAudit, () => void deps.mcp.refresh());
  if (deps.remote) remoteControlRoutes(api, deps.remote);
  if (deps.automation && deps.runner) automationRoutes(api, deps.automation, deps.runner);
  governanceRoutes(api, deps.ledger, deps.audit);
  insightsRoutes(api, new InsightsService(deps.project, deps.ledger, deps.audit));
  alertRoutes(api, deps.alerts);
  githubRoutes(api, deps.github, deps.handoff, deps.project.root, deps.humanAudit);
  securityRoutes(api, deps.security, deps.goals, deps.humanName);
  uploadRoutes(api, deps.uploads);
  if (deps.context) contextRoutes(api, deps.context, deps.humanAudit);
  if (deps.trackers) trackerRoutes(api, deps.trackers, deps.humanAudit);
  if (deps.teams) teamsRoutes(api, deps.teams, deps.humanName);
  if (deps.reviews) reviewRoutes(api, deps.reviews, deps.humanName);
  // Unknown API paths get a JSON 404 (never the web page), so clients can tell "not supported" apart.
  api.all('*', (c) => c.json({ error: `Unknown API route: ${c.req.method} ${new URL(c.req.url).pathname}` }, 404));
  app.route(API_PREFIX, api);

  app.get(
    WS_PATH,
    upgradeWebSocket((c) => {
      const ok = tokenMatches(deps.token, c.req.query(TOKEN_QUERY));
      const client = { send: (_: string) => {} };
      return {
        onOpen(_e, ws) {
          if (!ok) return ws.close(WS_UNAUTHORIZED, 'unauthorized');
          client.send = (d) => ws.send(d);
          deps.hub.add(client);
          deps.onConnect();
        },
        onMessage(e) {
          if (ok) deps.router(client, String(e.data));
        },
        onClose() {
          deps.hub.remove(client);
        },
      };
    }),
  );

  if (deps.remote) remotePublicRoutes(app, deps.remote);
  if (deps.teams) teamsPublicRoutes(app, deps.teams);
  serveUi(app, findUiDir());
  return { app, injectWebSocket };
}
