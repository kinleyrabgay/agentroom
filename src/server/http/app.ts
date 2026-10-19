import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import { API_PREFIX, TOKEN_QUERY, WS_PATH } from '../../shared/constants.js';
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
import type { AuditService, HumanAudit } from '../services/audit.service.js';
import type { LedgerService } from '../services/ledger.service.js';
import type { SecretsStore } from '../services/secrets.store.js';

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

  const api = new Hono();
  const cors = devCors(process.env.AGENTROOM_DEV_ORIGIN);
  if (cors) api.use('*', cors);
  api.use('*', requireToken(deps.token));
  infoRoutes(api, deps.project, deps.models);
  botRoutes(api, deps.project, deps.team);
  skillRoutes(api, deps.project);
  taskRoutes(api, deps.project, deps.boardChanged);
  goalRoutes(api, deps.goals, deps.humanAudit);
  settingsRoutes(api, deps.project, deps.secrets, deps.hub, deps.humanAudit);
  governanceRoutes(api, deps.ledger, deps.audit);
  alertRoutes(api, deps.alerts);
  githubRoutes(api, deps.github, deps.handoff, deps.project.root, deps.humanAudit);
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

  serveUi(app, findUiDir());
  return { app, injectWebSocket };
}
