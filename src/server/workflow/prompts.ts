import { HostTool, TaskKind } from '../../shared/enums.js';
import type { Goal, Task } from '../../shared/types/index.js';
import { taskLine } from '../agents/tools/task.tools.js';
import type { TeamRoles } from './roles.js';

/**
 * Instructions the Team Lead hands each bot at every phase of a goal. They spell out the
 * board protocol (which tools, which fields, which statuses) so the engine can rely on it;
 * the bots' own prompts and skills shape *how* they do the work.
 */

const T = HostTool;

const fence = (s: string) => '```\n' + s.trim() + '\n```';

export function planPrompt(goal: Goal, roles: TeamRoles, existing: Task[]): string {
  const replan = existing.length > 0 || !!goal.feedback;
  return [
    `# Plan goal ${goal.id}: ${goal.title}`,
    `The human's request:`,
    fence(goal.brief),
    replan && goal.feedback ? `## The human reviewed your previous plan and asked for changes\n${fence(goal.feedback)}` : '',
    replan && existing.length
      ? `## Current tasks for ${goal.id}\n${existing.map(taskLine).join('\n')}\nRevise them: \`${T.TaskUpdate}\` to change, \`${T.TaskDelete}\` to remove, \`${T.TaskCreate}\` to add. Don't duplicate tasks that are still right.`
      : '',
    `## How to plan`,
    `1. Investigate before you write anything: find the entry points, the code that must change, the existing tests, and how the project is built, run and tested. Read the actual files.`,
    `2. Save an overview with \`${T.PlanOverview}\` (goalId "${goal.id}"): the approach, the areas affected, risks/unknowns, and how the result will be verified.`,
    `3. Create the tasks with \`${T.TaskCreate}\`, always passing goalId "${goal.id}":`,
    `   - **Dev tasks** (kind "${TaskKind.Dev}", assignee "${roles.developer.id}"): each one coherent change a developer can finish in about 1–2 hours. Give each a markdown description (what, why, approach, edge cases), \`files\` expected to change, 2–5 testable \`acceptance\` criteria, \`dependsOn\` for ordering constraints, and \`order\` (1, 2, 3…). Include writing/updating unit tests in the dev task that changes the code.`,
    `   - **QA tasks** (kind "${TaskKind.QA}", assignee "${roles.qa.id}"): verify the dev work end to end: run the relevant test suites, and for any UI change open the running app in the browser and walk the user flow. Map each QA task's acceptance criteria to the dev tasks' criteria. Usually 1–3 QA tasks, ordered after the dev tasks, with dependsOn on the dev tasks they verify.`,
    `4. Do NOT change any code, run builds, or commit. Planning only.`,
    `5. If something essential is unclear (product decision, missing access), ask with \`${T.AskHuman}\` instead of guessing.`,
    `Finish with a 3–6 line summary of the plan for the Team Lead.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function buildPrompt(goal: Goal, task: Task, previousBlock?: string): string {
  return [
    `# Build ${task.id} for goal ${goal.id}: ${task.title}`,
    `## Task`,
    fence(JSON.stringify(pick(task), null, 2)),
    goal.plan ? `## Plan overview\n${goal.plan}` : '',
    previousBlock ? `## This task was blocked before\nReason: ${previousBlock}\nCheck the inbox answer / task log and continue.` : '',
    `## Protocol`,
    `- The task is already marked "doing". Read the files first, then implement exactly this task; don't drift into other tasks.`,
    `- Log meaningful progress with \`${T.TaskUpdate}\` appendLog (what you changed, commands run and their result).`,
    `- Tick acceptance criteria as you satisfy them with \`${T.TaskUpdate}\` acceptanceDone (0-based indexes).`,
    `- Add or update unit tests and run them (and the build/lint the project uses) before you finish.`,
    `- Commit your work on branch \`agentroom/${goal.id.toLowerCase()}\` (create it if needed) with a clear message. Do not push.`,
    `- When done, set status "review" with \`${T.TaskUpdate}\`.`,
    `- If you are blocked (missing access, a decision only the human can make, broken environment): set \`blockedReason\` with \`${T.TaskUpdate}\` and ask with \`${T.AskHuman}\`. If the answer unblocks you, clear blockedReason (null) and continue.`,
    `Finish with a short summary: files changed, tests run and results.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function testPrompt(goal: Goal, task: Task, devTasks: Task[], roles: TeamRoles): string {
  return [
    `# QA ${task.id} for goal ${goal.id}: ${task.title}`,
    `## QA task`,
    fence(JSON.stringify(pick(task), null, 2)),
    `## Work to verify`,
    devTasks.map((t) => `- ${taskLine(t)}`).join('\n') || '(none)',
    goal.plan ? `## Plan overview\n${goal.plan}` : '',
    `## Protocol`,
    `- Mark this QA task "doing", then verify every acceptance criterion: run the relevant tests/build, and for UI changes open the running app with \`${T.BrowserOpen}\` and exercise the flow like a user (check \`${T.BrowserConsole}\` for errors). If you don't know the dev-server URL or it isn't running, ask with \`${T.AskHuman}\`.`,
    `- Use \`${T.TaskGet}\` on the dev tasks to read their acceptance criteria and logs.`,
    `- Log evidence with \`${T.TaskUpdate}\` appendLog (commands, results, what you saw). Tick passed criteria with acceptanceDone.`,
    `- If something fails: create a bug with \`${T.TaskCreate}\` (kind "${TaskKind.Bug}", goalId "${goal.id}", assignee "${roles.developer.id}", description with steps to reproduce, expected vs actual and evidence, acceptance criteria for the fix). Leave this QA task in "todo" and log which bug(s) block it.`,
    `- If everything passes: set this QA task to "done".`,
    `- Don't fix production code yourself.`,
    `Finish with a pass/fail summary.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function reportPrompt(goal: Goal, tasks: Task[]): string {
  return [
    `# Report on goal ${goal.id}: ${goal.title}`,
    `All tasks are complete and QA passed. Write the final report for the human in concise markdown:`,
    `- **Outcome**: one or two sentences.`,
    `- **Changes**: per task, what changed (files) — use the task logs.`,
    `- **Verification**: tests run and QA evidence.`,
    `- **Risks / follow-ups**: anything the human should know or do next (e.g. push the branch, open a PR).`,
    `Use \`${T.TaskGet}\` for details. Don't change code.`,
    `## Tasks`,
    tasks.map((t) => `- ${taskLine(t)}`).join('\n'),
    goal.plan ? `## Plan overview\n${goal.plan}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Task fields worth showing a bot (skip timestamps). */
function pick(t: Task) {
  const { createdAt: _c, updatedAt: _u, ...rest } = t;
  return rest;
}
