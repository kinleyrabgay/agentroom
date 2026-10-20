import { FindingStatus, HostTool, TaskKind } from '../../shared/enums.js';
import type { Goal, Task } from '../../shared/types/index.js';
import type { GoalAssessment } from '../security/security.service.js';
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
    goal.guidance ? `## How to approach this ${goal.template ? `"${goal.template.name}" ` : ''}goal (team template)\n${goal.guidance.trim()}` : '',
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
    goal.worktree
      ? `- You're in the goal's own folder on branch \`${goal.worktree.branch}\` (already checked out; don't switch branches). AgentRoom commits your changes as a checkpoint when the task ends. Do not push.`
      : `- Commit your work on branch \`agentroom/${goal.id.toLowerCase()}\` (create it if needed) with a clear message. Do not push.`,
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

export function securityPrompt(goal: Goal, a: GoalAssessment, tasks: Task[], roles: TeamRoles): string {
  const open = a.findings.filter((f) => f.status === FindingStatus.Open || f.status === FindingStatus.Approved);
  return [
    `# Security review of goal ${goal.id}: ${goal.title}`,
    `The developer finished building. Review the change for security problems before QA.`,
    `## Change`,
    `${a.stats.files} files, +${a.stats.additions} −${a.stats.deletions}${goal.baseRef ? ` since commit ${goal.baseRef.slice(0, 10)} (see \`git diff ${goal.baseRef.slice(0, 10)}\`)` : ''}.`,
    a.stats.paths.length ? a.stats.paths.slice(0, 60).map((p) => `- ${p}`).join('\n') : '',
    a.repos.length
      ? `## Other repos in this change\nPaths above starting with a repo id are in that repo. Review them the same way:\n${a.repos
          .map((r) => {
            const st = goal.repos?.[r.repo];
            const dir = st?.worktree?.path;
            return `- \`${r.repo}\`: ${r.stats.files} files, +${r.stats.additions} −${r.stats.deletions}${dir ? ` in ${dir}` : ''}${st?.baseRef ? ` (\`git diff ${st.baseRef.slice(0, 10)}\` there)` : ''}${r.sensitive.length ? `; sensitive: ${r.sensitive.join(', ')}` : ''}`;
          })
          .join('\n')}\nWhen you record a finding in another repo, name the repo in its title and use that repo's file path.`
      : '',
    `## Risk score: ${a.risk.score} (${a.risk.level})`,
    a.risk.factors.map((f) => `- ${f.label} (+${f.points})`).join('\n'),
    open.length
      ? `## Automated findings\n${open.map((f) => `- [${f.severity}] ${f.title}${f.file ? ` — ${f.repo ? `${f.repo}/` : ''}${f.file}${f.line ? `:${f.line}` : ''}` : ''}${f.snippet ? ` — \`${f.snippet}\`` : ''}`).join('\n')}`
      : '## Automated findings\nNone.',
    `## Tasks`,
    tasks.map((t) => `- ${taskLine(t)}`).join('\n'),
    `## Protocol`,
    `- Read the diff and the changed code. Check: injection (SQL/shell/template), authentication & authorization on new endpoints, input validation, secrets in code or config, unsafe deserialization, path traversal, SSRF, XSS, CSRF, CORS, crypto misuse, logging of sensitive data, dependency changes.`,
    `- Confirm or refute each automated finding by reading the code.`,
    `- Record every real issue with \`${T.SecurityFinding}\` (critical = must fix before merge; warning = needs a look; info = note).`,
    `- For each critical issue, also create a bug with \`${T.TaskCreate}\` (kind "${TaskKind.Bug}", goalId "${goal.id}", assignee "${roles.developer.id}") with the exploit scenario and the fix as acceptance criteria. The developer fixes them in the next round and you will review again.`,
    `- Do not change code yourself, do not commit.`,
    `Finish with a short verdict: "pass", or the list of must-fix issues.`,
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

/** Verify phase: QA describes how to prove the feature works in a real browser (the engine runs it). */
export function verifyPrompt(goal: Goal, tasks: Task[], previous: { scenarios: unknown; error?: string } | null): string {
  return [
    `# Proof of work for goal ${goal.id}: ${goal.title}`,
    `Tests passed. Now AgentRoom will start the app from the goal's folder, run your scenario in a headless browser, record it as a GIF for the pull request, and run accessibility, performance and visual checks.`,
    `Write 1–2 short scenarios that show the change working the way a user would see it. Read the code to get real paths, labels and selectors. Prefer visible text (\`text=Export\`) over brittle CSS.`,
    `## Tasks`,
    tasks.map((t) => `- ${taskLine(t)}`).join('\n'),
    previous ? `## Last attempt\n${previous.error ? `It failed: ${previous.error}\n` : ''}\`\`\`json\n${JSON.stringify(previous.scenarios, null, 2)}\n\`\`\`` : '',
    `## Format`,
    'Reply with one ```json block, nothing after it:',
    '```json\n{ "scenarios": [ { "name": "Export reports as CSV", "path": "/reports", "steps": [\n  { "action": "click", "target": "text=Export", "label": "Open the export menu" },\n  { "action": "click", "target": "text=CSV" },\n  { "action": "expect", "value": "Download ready" }\n] } ] }\n```',
    `Actions: goto (target: path), click (target), fill (target, value), press (target: key), wait (value: text or ms), expect (value: text that must appear), screenshot. At most 15 steps. Only paths on the app itself; never real credentials (use obvious test values).`,
    `If the change has no visible UI (a library, a CLI, an API), reply with \`{ "scenarios": [] }\`.`,
    `Don't change code and don't commit.`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
