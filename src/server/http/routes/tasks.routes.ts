import type { Hono } from 'hono';
import type { Project } from '../../../core/project.js';
import type { TaskUpdate } from '../../../core/repositories/task.repository.js';
import type { NewTaskInput } from '../../../shared/types/index.js';
import { body, respond } from '../respond.js';

/**
 * Board tasks. PATCH: `null` (or "") clears assignee, blockedReason, goalId, repo.
 * `repoCheck` (multi-repo workspaces) validates a task's repo: unknown ids throw, the primary repo is stored as unset.
 */
export function taskRoutes(app: Hono, project: Project, changed: () => void, repoCheck?: (repo: string) => string | null) {
  const withRepo = <T extends { repo?: string | null }>(input: T): T => {
    if (input.repo === undefined) return input;
    if (!repoCheck) {
      const { repo: _r, ...rest } = input;
      return rest as T;
    }
    return { ...input, repo: input.repo ? repoCheck(input.repo) : null };
  };
  const write = <T>(fn: () => T) => () => {
    const out = fn();
    changed();
    return out;
  };
  app.get('/tasks', (c) => c.json(project.tasks.list({ goalId: c.req.query('goalId') || undefined })));
  app.post('/tasks', async (c) => {
    const input = await body<NewTaskInput>(c);
    if (!input.title?.trim()) return c.json({ error: 'title is required' }, 400);
    return respond(
      c,
      write(() => {
        const { repo, ...rest } = withRepo(input as NewTaskInput & { repo?: string | null });
        return project.tasks.create({ ...rest, ...(repo ? { repo } : {}), title: input.title.trim(), createdBy: 'human' });
      }),
    );
  });
  app.patch('/tasks/:id', async (c) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...patch } = await body<TaskUpdate & { id?: string; createdAt?: string }>(c);
    return respond(c, write(() => project.tasks.update(c.req.param('id'), withRepo(patch))));
  });
  app.delete('/tasks/:id', (c) => respond(c, write(() => project.tasks.delete(c.req.param('id')))));
}
