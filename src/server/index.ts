import { serve } from '@hono/node-server';
import { BIND_HOST, TOKEN_QUERY } from '../shared/constants.js';
import { Project } from '../core/project.js';
import { PermissionGate } from './agents/permission-gate.js';
import { SessionStore } from './agents/session-store.js';
import { Team } from './agents/team.js';
import { createApp } from './http/app.js';
import { createSessionToken } from './http/auth.js';
import { PreviewService } from './preview/preview.service.js';
import { createProvider } from './providers/registry.js';
import { Hub } from './realtime/hub.js';
import { createClientMessageRouter } from './realtime/ws.handler.js';
import { AccountMonitor } from './services/account-monitor.js';
import { ModelCatalog } from './services/model-catalog.js';
import { NotificationService } from './services/notification.service.js';
import { AlertService } from './services/alerts/alert.service.js';
import { createAlertChannel } from './services/alerts/channels.js';
import { GhCliClient } from './integrations/github/gh-client.js';
import { GithubProjectService } from './integrations/github/github-project.service.js';
import { HandoffService } from './integrations/github/handoff.service.js';
import { pushBoard, pushProjectState, watchProject } from './watch/project-watcher.js';
import { GoalRunner } from './workflow/goal-runner.js';

export interface StartOptions {
  root: string;
  port: number;
  provider: string;
  model?: string;
}

export interface RunningServer {
  url: string;
  close: () => Promise<void>;
}

/** Composition root: wires the project, realtime hub, agents, previews and HTTP app together. */
export async function startServer(opts: StartOptions): Promise<RunningServer> {
  const project = new Project(opts.root);
  const provider = createProvider(opts.provider);
  const config = project.config.get();
  if (opts.model || opts.provider !== config.provider) {
    project.config.update({ provider: provider.id as typeof config.provider, ...(opts.model ? { model: opts.model } : {}) });
  }

  const hub = new Hub(project.paths.runs);
  const previews = new PreviewService(hub);
  const permissions = new PermissionGate(hub, () => project.config.get(), project.root);
  const sessions = new SessionStore(project.paths.sessionsFile);
  const notifications = new NotificationService(hub, project.paths.inboxFile);
  const boardChanged = () => pushBoard(project, hub);
  const team = new Team({ project, hub, provider, previews, permissions, sessions, notifications, boardChanged });
  const goals = new GoalRunner({ project, team, hub, notifications, boardChanged });
  goals.recoverOnStartup();
  const github = new GithubProjectService(new GhCliClient(), {
    projectFile: project.paths.githubProjectFile,
    itemsCache: project.paths.githubItemsCache,
  });
  const handoff = new HandoffService({
    root: project.root,
    bots: () => project.bots.list(),
    itemDetail: (id) => github.itemDetail(id),
    startGoal: (brief, title, sources) => goals.start(brief, title, sources),
    sendToBot: (botId, text) => void team.send(botId, text).catch(() => {}),
  });
  const models = new ModelCatalog(provider, project.root);
  const account = new AccountMonitor(provider, hub, project.root);

  const token = createSessionToken();
  const url = `http://${BIND_HOST}:${opts.port}/?${TOKEN_QUERY}=${token}`;
  const alerts = new AlertService({
    hub,
    channel: createAlertChannel(),
    prefsFile: project.paths.alertsFile,
    projectName: project.info().name,
    url: () => url,
    botName: (id) => (id ? project.bots.get(id)?.name : undefined),
  });
  const { app, injectWebSocket } = createApp({
    token,
    project,
    team,
    hub,
    models,
    goals,
    alerts,
    github,
    handoff,
    boardChanged,
    router: createClientMessageRouter({ hub, team, permissions, previews, notifications }),
    onConnect: () => pushProjectState(project, hub),
  });
  const stopWatching = watchProject(project, hub);

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: BIND_HOST }, () => resolve(s));
    s.once('error', reject);
  });
  injectWebSocket(server);
  models.warm();
  account.start();

  return {
    url,
    close: async () => {
      team.stop();
      account.stop();
      previews.closeAll();
      await stopWatching();
      server.close();
    },
  };
}
