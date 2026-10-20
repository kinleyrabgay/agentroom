import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { Goal, GoalPatch } from '../../../shared/types/index.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { GoalRunner } from '../../workflow/goal-runner.js';
import { body, respond } from '../respond.js';
import { composeBrief, type GoalTemplateRepository } from '../../../core/repositories/goal-template.repository.js';
import { designFromFields } from '../../autopilot/design.js';

/** Goals: start a run, and the human's controls over it (approve, request changes, pause/resume, cancel). */
export function goalRoutes(app: Hono, goals: GoalRunner, audit: HumanAudit, templates?: GoalTemplateRepository) {
  /** Run a goal action and log it as the human's. */
  const act = (id: string, verb: string, fn: () => Goal | void, detail?: Record<string, unknown>) => {
    const out = fn();
    audit(AuditKind.Goal, `${verb} ${id}`, { goalId: id, ...(detail ? { detail } : {}) });
    return out;
  };
  app.get('/goals', (c) => c.json(goals.list()));
  app.post('/goals', async (c) => {
    const { brief, title, securityReview, attachments, templateId, fields, budgetUsd } = await body<{
      brief?: string;
      title?: string;
      securityReview?: Goal['securityReview'];
      attachments?: unknown;
      /** Start from a goal template: its fields become the brief, its guidance goes to the Planner. */
      templateId?: string;
      fields?: Record<string, string>;
      /** Spend cap for this goal (USD). */
      budgetUsd?: number;
    }>(c);
    return respond(c, () => {
      const ids = Array.isArray(attachments) ? attachments.map(String) : [];
      const template = templateId ? templates?.get(String(templateId)) : undefined;
      if (templateId && !template) throw new Error(`Unknown goal template "${templateId}".`);
      const text = template ? composeBrief(template, fields ?? {}, String(brief ?? '')) : String(brief ?? '');
      // Implement design goals: the design to compare against; an uploaded design image is attached too.
      const design = template ? designFromFields(template, fields ?? {}) : undefined;
      if (design?.uploadId && !ids.includes(design.uploadId)) ids.push(design.uploadId);
      const goal = goals.start(text, title, [], securityReview ?? template?.securityReview, ids, template ? { template: { id: template.id, name: template.name }, guidance: template.guidance } : {});
      if (design) goals.setDesign(goal.id, design);
      if (typeof budgetUsd === 'number' && budgetUsd > 0) goals.update(goal.id, { budgetUsd });
      audit(AuditKind.Goal, `Started ${goal.id}: ${goal.title}`, { goalId: goal.id, ...(template ? { detail: { template: template.id } } : {}) });
      return goal;
    });
  });
  app.patch('/goals/:id', async (c) => {
    const patch = await body<GoalPatch>(c);
    return respond(c, () => goals.update(c.req.param('id'), patch));
  });
  app.post('/goals/:id/approve', (c) => respond(c, () => act(c.req.param('id'), 'Approved plan of', () => goals.approve(c.req.param('id')))));
  app.post('/goals/:id/pause', (c) => respond(c, () => act(c.req.param('id'), 'Paused', () => goals.pause(c.req.param('id')))));
  app.post('/goals/:id/resume', (c) => respond(c, () => act(c.req.param('id'), 'Resumed', () => goals.resume(c.req.param('id')))));
  app.post('/goals/:id/cancel', (c) => respond(c, () => act(c.req.param('id'), 'Cancelled', () => goals.cancel(c.req.param('id')))));
  app.post('/goals/:id/replan', async (c) => {
    const { feedback } = await body<{ feedback?: string }>(c);
    const id = c.req.param('id');
    return respond(c, () => act(id, 'Requested changes to', () => goals.replan(id, String(feedback ?? '')), { feedback }));
  });
  app.delete('/goals/:id', (c) => respond(c, () => act(c.req.param('id'), 'Deleted', () => goals.remove(c.req.param('id')))));

  // Budgets
  app.get('/budgets', (c) => respond(c, () => goals.budgetSummary()));

  // Changes (diff review), review comments, per-task revert
  // Multi-repo workspaces: ?repo=<id> picks one of the goal's repos (unset = primary).
  const repoOf = (c: { req: { query: (k: string) => string | undefined } }) => c.req.query('repo') || undefined;
  app.get('/goals/:id/changes', (c) => respond(c, () => goals.changes(c.req.param('id'), repoOf(c))));
  app.post('/goals/:id/comments', async (c) => {
    const b = await body<{ file?: string; line?: number; body?: string; repo?: string }>(c);
    return respond(c, () => goals.addComment(c.req.param('id'), { file: String(b.file ?? ''), line: b.line, body: String(b.body ?? ''), ...(b.repo ? { repo: String(b.repo) } : {}) }, goals.human()));
  });
  app.delete('/goals/:id/comments/:commentId', (c) => respond(c, () => goals.deleteComment(c.req.param('id'), c.req.param('commentId'))));
  app.post('/goals/:id/request-changes', (c) => respond(c, () => act(c.req.param('id'), 'Sent review comments to the Developer for', () => goals.requestChanges(c.req.param('id')))));
  app.post('/goals/:id/tasks/:taskId/revert', (c) => respond(c, () => goals.revertTask(c.req.param('id'), c.req.param('taskId'), goals.human())));

  // Publish: PR, local merge, folder cleanup
  app.get('/goals/:id/pr-draft', (c) => respond(c, () => goals.prDraft(c.req.param('id'), repoOf(c))));
  app.post('/goals/:id/pr', async (c) => {
    const id = c.req.param('id');
    const b = await body<{ title?: string; body?: string; draft?: boolean; repo?: string }>(c);
    return respond(c, async () => {
      const repo = typeof b.repo === 'string' && b.repo ? b.repo : undefined;
      const goal = await goals.openPr(id, { title: b.title, body: b.body, draft: b.draft === true, ...(repo ? { repo } : {}) });
      const part = repo ? goal.repos?.[repo] : undefined;
      const branch = (part ? part.worktree?.branch : goal.worktree?.branch) ?? id;
      const pr = part ? part.pr : goal.pr;
      audit(AuditKind.Push, `Pushed ${branch}${part ? ` in ${repo}` : ''}`, { goalId: id });
      audit(AuditKind.PullRequest, `Opened PR for ${id}${part ? ` in ${repo}` : ''}${pr ? `: ${pr.url}` : ''}`, { goalId: id, detail: { pr, draft: b.draft === true, ...(repo ? { repo } : {}) } });
      return goal;
    });
  });
  app.post('/goals/:id/merge-local', async (c) => {
    const id = c.req.param('id');
    const b = await body<{ repo?: string }>(c);
    return respond(c, async () => {
      const repo = typeof b.repo === 'string' && b.repo ? b.repo : undefined;
      const goal = await goals.mergeLocal(id, repo);
      const branch = (repo ? goal.repos?.[repo]?.worktree?.branch : goal.worktree?.branch) ?? id;
      audit(AuditKind.Goal, `Merged ${branch} into the current branch${repo ? ` of ${repo}` : ''}`, { goalId: id });
      return goal;
    });
  });
  app.post('/goals/:id/cleanup', (c) => {
    const id = c.req.param('id');
    return respond(c, async () => {
      const goal = await goals.cleanup(id);
      audit(AuditKind.Goal, `Removed the folder of ${id} (branch kept)`, { goalId: id });
      return goal;
    });
  });
}
