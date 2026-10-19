import { z } from 'zod';
import { GoalStatus, HostTool, TaskKind, TaskStatus } from '../../../shared/enums.js';
import { TaskStatusSchema } from '../../../shared/schemas.js';
import type { NewTaskInput, Task } from '../../../shared/types/index.js';
import type { GoalRepository } from '../../../core/repositories/goal.repository.js';
import type { TaskRepository, TaskUpdate } from '../../../core/repositories/task.repository.js';
import type { HostToolDef } from '../../providers/provider.js';

const values = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];
const KindSchema = z.enum(values(TaskKind));

export interface TaskToolDeps {
  tasks: TaskRepository;
  goals: GoalRepository;
  /** Called after any board write so the UI updates immediately. */
  changed: () => void;
  /** Goal the bot is currently working on (set by the workflow engine); new tasks default to it. */
  goalId?: string;
  /** Resolves an assignee to its bot role, to infer a task's kind. */
  roleOf?: (botId: string) => string | undefined;
}

/**
 * Fill in what models often leave out: the active goal, the kind (from the assignee's role or a
 * "QA:"/"Bug:" title prefix), and a description when only notes were given.
 */
export function withTaskDefaults(input: NewTaskInput, deps: Pick<TaskToolDeps, 'goalId' | 'roleOf'>): NewTaskInput {
  const out: NewTaskInput = { ...input };
  if (!out.goalId && deps.goalId) out.goalId = deps.goalId;
  if (!out.kind) {
    const prefix = /^(qa|bug)\s*[:\-]/i.exec(out.title)?.[1]?.toLowerCase();
    const role = out.assignee ? deps.roleOf?.(out.assignee)?.toLowerCase() : undefined;
    out.kind = prefix === 'bug' ? TaskKind.Bug : prefix === 'qa' || role === 'qa' ? TaskKind.QA : TaskKind.Dev;
  }
  if (!out.description && out.notes) {
    out.description = out.notes;
    delete out.notes;
  }
  return out;
}

/** Compact one-line view for task_list. */
export function taskLine(t: Task): string {
  const done = t.acceptance.filter((a) => a.done).length;
  const parts = [
    `${t.id} [${t.status}] (${t.kind})`,
    t.title,
    t.assignee ? `@${t.assignee}` : '',
    t.goalId ? `goal ${t.goalId}` : '',
    t.acceptance.length ? `acceptance ${done}/${t.acceptance.length}` : '',
    t.dependsOn.length ? `after ${t.dependsOn.join(',')}` : '',
    t.blockedReason ? `BLOCKED: ${t.blockedReason}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Task board tools every bot gets. */
export function taskTools(deps: TaskToolDeps, botId: string): HostToolDef[] {
  const { tasks, changed } = deps;
  const write = <T>(fn: () => T): string => {
    const out = fn();
    changed();
    return JSON.stringify(out, null, 2);
  };

  return [
    {
      name: HostTool.TaskList,
      description: 'List tasks on the board (one line each). Filter by goal id.',
      schema: { goalId: z.string().optional() },
      handler: async ({ goalId }) => {
        const list = tasks.list({ goalId }).sort((a, b) => a.order - b.order);
        return list.length ? list.map(taskLine).join('\n') : 'No tasks.';
      },
    },
    {
      name: HostTool.TaskGet,
      description: 'Get one task with full details (description, acceptance criteria, files, dependencies, log).',
      schema: { id: z.string() },
      handler: async ({ id }) => {
        const t = tasks.get(id);
        if (!t) throw new Error(`task "${id}" not found`);
        return JSON.stringify(t, null, 2);
      },
    },
    {
      name: HostTool.TaskCreate,
      description:
        'Create a task. For goal work always set goalId, kind, assignee, a markdown description, testable acceptance criteria, ' +
        'files expected to change, and dependsOn (task ids that must finish first).',
      schema: {
        title: z.string().describe('Short imperative title'),
        kind: KindSchema.optional().describe('dev | qa | bug | research'),
        goalId: z.string().optional().describe('Defaults to the goal you are working on'),
        assignee: z.string().optional().describe('bot id'),
        description: z.string().optional().describe('Markdown: what and why, approach, edge cases'),
        acceptance: z.array(z.string()).optional().describe('Testable acceptance criteria'),
        files: z.array(z.string()).optional().describe('Files/areas expected to change'),
        dependsOn: z.array(z.string()).optional(),
        order: z.number().optional().describe('Execution order within the goal'),
        notes: z.string().optional(),
      },
      handler: async (a) => write(() => tasks.create(withTaskDefaults({ ...a, createdBy: botId }, deps))),
    },
    {
      name: HostTool.TaskUpdate,
      description:
        'Update a task. status: todo|doing|review|done. appendLog adds a progress note. acceptanceDone ticks criteria by index (0-based). ' +
        'blockedReason marks it blocked (null clears). description/notes replace existing text.',
      schema: {
        id: z.string(),
        status: TaskStatusSchema.optional(),
        title: z.string().optional(),
        kind: KindSchema.optional(),
        assignee: z.string().nullable().optional(),
        description: z.string().optional(),
        notes: z.string().optional(),
        files: z.array(z.string()).optional(),
        dependsOn: z.array(z.string()).optional(),
        acceptance: z.array(z.string()).optional().describe('Replace all acceptance criteria'),
        acceptanceDone: z.array(z.number().int()).optional(),
        appendLog: z.string().optional(),
        blockedReason: z.string().nullable().optional(),
        order: z.number().optional(),
      },
      handler: async ({ id, appendLog, acceptanceDone, acceptance, ...patch }) =>
        write(() => {
          const update: TaskUpdate = { ...patch };
          if (acceptance) update.acceptance = acceptance.map((text: string) => ({ text, done: false }));
          let t = tasks.update(id, update);
          if (acceptanceDone?.length) t = tasks.tickAcceptance(id, acceptanceDone);
          if (appendLog) t = tasks.appendLog(id, botId, appendLog);
          return t;
        }),
    },
  ];
}

/** Extra tools for planner bots: write the plan overview and prune tasks while planning. */
export function planningTools({ tasks, goals, changed }: TaskToolDeps, botId: string): HostToolDef[] {
  const editable = (t: Task) => {
    const goal = t.goalId ? goals.get(t.goalId) : undefined;
    const planning = goal && (goal.status === GoalStatus.Planning || goal.status === GoalStatus.AwaitingApproval);
    return planning || t.createdBy === botId;
  };
  return [
    {
      name: HostTool.PlanOverview,
      description: 'Write the plan overview for a goal (markdown): approach, affected areas, risks, how it will be verified.',
      schema: { goalId: z.string(), markdown: z.string() },
      handler: async ({ goalId, markdown }) => {
        goals.update(goalId, { plan: markdown });
        changed();
        return `Plan overview saved for ${goalId}.`;
      },
    },
    {
      name: HostTool.TaskDelete,
      description: 'Delete a task while its goal is still being planned (or one you created).',
      schema: { id: z.string() },
      handler: async ({ id }) => {
        const t = tasks.get(id);
        if (!t) throw new Error(`task "${id}" not found`);
        if (!editable(t)) throw new Error(`${id} can't be deleted once its goal is approved.`);
        tasks.delete(id);
        changed();
        return `Deleted ${id}.`;
      },
    },
  ];
}

/** Tasks that don't need doing anymore count as finished for dependency checks. */
export const isFinished = (t: Task) => t.status === TaskStatus.Done || t.status === TaskStatus.Review;
