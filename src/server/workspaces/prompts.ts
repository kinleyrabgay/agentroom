import type { RepoRef } from '../../core/workspaces/index.js';
import { HostTool } from '../../shared/enums.js';

/** Added to the Planner's prompt in a workspace: plan per repo. */
export function workspacePlanSection(goalId: string, repos: RepoRef[]): string {
  const primary = repos.find((r) => r.primary)!;
  return [
    `## This goal can span ${repos.length} repos`,
    ...repos.map((r) => `- \`${r.id}\`${r.primary ? ' (primary)' : ''}: ${r.root}`),
    `- Read every repo the change needs before planning; trace calls across them (API routes, shared packages, schemas).`,
    `- Pass \`repo\` to \`${HostTool.TaskCreate}\` on every ${goalId} task: the id of the one repo that task changes (omit it for \`${primary.id}\`). A task never changes two repos; split it instead.`,
    `- Order work so providers come before consumers (API or shared package first, then the client), with \`dependsOn\` between them.`,
    `- Each repo gets its own branch and its own pull request; say in the plan overview what each repo's part does.`,
  ].join('\n');
}

/** Added to a build/test prompt when the task's repo isn't the primary one (or in any workspace). */
export function workspaceTaskSection(task: { id: string; repo?: string }, repo: RepoRef, cwd: string, others: { id: string; dir: string }[], app: { devCommand?: string; url?: string } = {}): string {
  return [
    `## Repo for ${task.id}: \`${repo.id}\``,
    `- You're working in ${cwd}. Change files only in this repo.`,
    `- Tests and checks for this task run in this repo's folder, with this repo's own test command.`,
    app.devCommand || app.url ? `- This repo's app: ${[app.devCommand ? `start it with \`${app.devCommand}\` in ${cwd}` : '', app.url ? `open ${app.url}` : ''].filter(Boolean).join(', then ')}.` : '',
    others.length ? `- Other repos of the goal, to read only: ${others.map((o) => `\`${o.id}\` at ${o.dir}`).join('; ')}.` : '',
    `- If this repo needs a change in another repo first, set a blockedReason on the task naming it instead of editing there.`,
  ]
    .filter(Boolean)
    .join('\n');
}
