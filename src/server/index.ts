import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { BIND_HOST, PUBLIC_HOST, TOKEN_QUERY } from '../shared/constants.js';
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
import { gitUser } from '../core/git.js';
import { AuditService, humanAudit } from './services/audit.service.js';
import { LedgerService } from './services/ledger.service.js';
import { SecretsStore } from './services/secrets.store.js';
import { FindingsStore } from './security/findings.store.js';
import { DependencyGuard } from './security/dependency/dependency-guard.js';
import { CliGitReader } from './security/git.js';
import { SecurityService } from './security/security.service.js';
import { UploadStore } from './services/upload.store.js';
import { McpRepository } from '../core/repositories/mcp.repository.js';
import { McpService } from './services/mcp/mcp.service.js';
import { McpScope } from '../shared/enums.js';
import { SentryService } from './integrations/sentry/sentry.service.js';
import { RemoteService } from './remote/remote.service.js';
import { startCloudflared } from './remote/tunnel.js';
import { AgentEventType } from '../shared/enums.js';
import { handoffSentry } from './integrations/sentry/sentry-handoff.js';
import { AutomationRepository, parseOwner } from '../core/repositories/automation.repository.js';
import { AutomationService } from './automation/automation.service.js';
import { backgroundStatus, clearSession, installBackground, uninstallBackground, writeSession } from './runner/background.js';
import { composeBrief } from '../core/repositories/goal-template.repository.js';
import { ActorType, AuditKind, StateType } from '../shared/enums.js';

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
  const audit = new AuditService(project.paths.auditFile, project.settings.get().audit.retentionDays);
  const humanName = () => gitUser(project.root);
  const ledger = new LedgerService(project.paths.ledgerFile);
  const secrets = new SecretsStore(project.paths.secretsFile);
  const permissions = new PermissionGate(hub, () => project.config.get(), project.root, {
    record: (e) => audit.record(e),
    humanName,
  });
  const sessions = new SessionStore(project.paths.sessionsFile);
  const notifications = new NotificationService(hub, project.paths.inboxFile);
  const findings = new FindingsStore({ file: project.paths.securityFile, hub, audit: (e) => audit.record(e) });
  const security = new SecurityService({
    git: new CliGitReader(project.root),
    guard: new DependencyGuard({ cwd: project.root }),
    findings,
    settings: () => project.settings.get(),
    notifications,
    goalBase: (id) => project.goals.get(id)?.baseRef,
    // A goal's own folder (worktree): its diffs and publish gates are read there.
    goalCwd: (id) => {
      const wt = project.goals.get(id)?.worktree;
      return wt && fs.existsSync(wt.path) ? wt.path : undefined;
    },
    gitFor: (cwd) => new CliGitReader(cwd),
  });
  permissions.useSecurity({
    check: (botId, command, goalId) => security.gate(command, { botId, ...(goalId ? { goalId } : {}) }),
    approve: (ids, actor) => security.approveHeld(ids, actor),
    deniedMessage: (f) => SecurityService.deniedMessage(f),
  });
  const mcp = new McpService({
    repo: new McpRepository({ [McpScope.Team]: project.paths.mcpFile, [McpScope.Personal]: project.paths.mcpLocalFile }),
    secrets,
    hub,
    cwd: project.root,
    bots: () => project.bots.list(),
  });
  permissions.useMcp(mcp);
  const boardChanged = () => pushBoard(project, hub);
  const uploads = new UploadStore(project.paths.uploads, project.root);
  uploads.prune();
  const team = new Team({ project, hub, provider, previews, permissions, sessions, notifications, boardChanged, ledger, security, uploads, mcp });
  const goals = new GoalRunner({ project, team, hub, notifications, boardChanged, security, uploads, ledger, audit: (e) => audit.record(e), humanName });
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
    guard: (text, source) => security.guardUntrusted(text, source, {}),
  });
  const sentry = new SentryService(project.paths.sentryFile, secrets);
  const sentryHandoff = (input: Parameters<typeof handoffSentry>[1]) =>
    handoffSentry(
      {
        root: project.root,
        bots: () => project.bots.list(),
        detail: (id) => sentry.detail(id),
        startGoal: (brief, title, sources) => goals.start(brief, title, sources),
        sendToBot: (botId, text) => void team.send(botId, text).catch(() => {}),
        guard: (text, source) => security.guardUntrusted(text, source, {}),
        hasSentryTools: (bot) => mcp.hasServerFor(bot, 'sentry'),
      },
      input,
    );
  const models = new ModelCatalog(provider, project.root);
  const account = new AccountMonitor(provider, hub, project.root);

  const token = createSessionToken();
  const url = `http://${PUBLIC_HOST}:${opts.port}/?${TOKEN_QUERY}=${token}`;
  const alerts = new AlertService({
    hub,
    channel: createAlertChannel(),
    prefsFile: project.paths.alertsFile,
    projectName: project.info().name,
    url: () => url,
    botName: (id) => (id ? project.bots.get(id)?.name : undefined),
  });
  // Phone approvals: reasons of pending requests come from the live events.
  const requestReasons = new Map<string, string>();
  hub.onEvent((e) => {
    if (e.type === AgentEventType.PermissionRequest) requestReasons.set(e.requestId, e.reason);
    if (e.type === AgentEventType.PermissionResolved) requestReasons.delete(e.requestId);
  });
  const remote = new RemoteService({
    port: opts.port,
    startTunnel: startCloudflared,
    bots: () => project.bots.list(),
    gate: permissions,
    notifications,
    goals,
    tasks: () => project.tasks.list(),
    audit: (e) => audit.record(e),
    reasonOf: (id) => requestReasons.get(id),
  });
  const runnerOpts = { root: project.root, port: opts.port, provider: provider.id, logFile: project.paths.daemonLog };
  const automation = new AutomationService({
    repo: new AutomationRepository(
      {
        schedules: project.paths.schedulesFile,
        triggers: project.paths.triggersFile,
        personalSchedules: project.paths.personalSchedulesFile,
        personalTriggers: project.paths.personalTriggersFile,
      },
      () => parseOwner(humanName()),
    ),
    stateFile: project.paths.automationStateFile,
    historyFile: project.paths.automationHistoryFile,
    pushState: (snapshot) => hub.state({ type: StateType.Automation, automation: snapshot }),
    isActive: () => hub.isActive,
    onPresence: (fn) => hub.onPresence(fn),
    startGoal: (a) => {
      const template = a.templateId ? project.goalTemplates.get(a.templateId) : undefined;
      if (a.templateId && !template) throw new Error(`Unknown goal template "${a.templateId}".`);
      const text = template ? composeBrief(template, a.fields ?? {}, a.brief) : a.brief;
      const goal = goals.start(text, a.title, [], template?.securityReview, [], template ? { template: { id: template.id, name: template.name }, guidance: template.guidance } : {});
      return a.budgetUsd ? goals.update(goal.id, { budgetUsd: a.budgetUsd }) : goal;
    },
    approvePlan: (id) => void goals.approve(id),
    setGoalBudget: (id, usd) => void goals.update(id, { budgetUsd: usd }),
    goals: () => goals.list(),
    sendToBot: (botId, text) => void team.send(botId, text).catch(() => {}),
    handoff: (source, input) =>
      source === 'github'
        ? handoff.handoff({ itemIds: input.ids, ...(input.botId ? { botId: input.botId } : {}), ...(input.note ? { note: input.note } : {}) })
        : sentryHandoff({ issueIds: input.ids, ...(input.botId ? { botId: input.botId } : {}), ...(input.note ? { note: input.note } : {}) }),
    notify: (n) => void notifications.create(n),
    notifications: () => notifications.list(),
    pendingApprovals: () => permissions.pendingRequests().length,
    ledgerSince: (since) => ledger.list({ since }),
    spentToday: () => ledger.spentToday(),
    settings: () => project.settings.get(),
    sentryIssues: async () => {
      const st = sentry.status();
      if (!st.config || !st.hasToken) return null;
      const page = await sentry.issues({ sort: 'new', period: '24h', status: 'unresolved' });
      return page.issues;
    },
    githubCards: async () => {
      if (!github.config()) return null;
      const board = await github.board({ refresh: true });
      const names = new Map(board.project.columns.map((c) => [c.id, c.name]));
      return board.items.map((i) => ({ id: i.id, title: i.title, ...(i.url ? { url: i.url } : {}), status: i.statusId ? (names.get(i.statusId) ?? '') : '' }));
    },
    webhook: (ch) => (ch === 'slack' ? secrets.read().slackWebhook : secrets.read().teamsWebhook),
    projectName: project.info().name,
    url: () => url,
    audit: (summary, detail) => audit.record({ kind: AuditKind.Automation, actor: { type: ActorType.Human, name: humanName() }, summary, ...(detail ? { detail } : {}) }),
    human: humanName,
  });
  const runner = {
    status: () => backgroundStatus(runnerOpts),
    install: async () => {
      const st = await installBackground(runnerOpts);
      audit.record({ kind: AuditKind.Automation, actor: { type: ActorType.Human, name: humanName() }, summary: 'Background mode installed' });
      return st;
    },
    uninstall: async () => {
      const st = await uninstallBackground(runnerOpts);
      audit.record({ kind: AuditKind.Automation, actor: { type: ActorType.Human, name: humanName() }, summary: 'Background mode removed' });
      return st;
    },
  };
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
    ledger,
    audit,
    humanAudit: humanAudit(audit, humanName),
    secrets,
    mcp,
    sentry,
    sentryHandoff,
    remote,
    automation,
    runner,
    security,
    uploads,
    humanName,
    boardChanged,
    router: createClientMessageRouter({ hub, team, permissions, previews, notifications }),
    onConnect: () => {
      pushProjectState(project, hub);
      findings.push();
      mcp.push();
      automation.push();
    },
  });
  const stopWatching = watchProject(project, hub, () => void mcp.refresh());

  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    const s = serve({ fetch: app.fetch, port: opts.port, hostname: BIND_HOST }, () => resolve(s));
    s.once('error', reject);
  });
  injectWebSocket(server);
  models.warm();
  account.start();
  mcp.start();
  automation.start();
  writeSession(project.paths.sessionFile, { port: opts.port, token, url, pid: process.pid, startedAt: new Date().toISOString() });

  return {
    url,
    close: async () => {
      team.stop();
      account.stop();
      mcp.stop();
      automation.stop();
      clearSession(project.paths.sessionFile);
      remote.close();
      previews.closeAll();
      await stopWatching();
      server.close();
    },
  };
}
