import { TaskKind, TaskStatus } from '../../shared/enums.js';
import type { Goal, Task } from '../../shared/types/index.js';

/**
 * "Closes …" for the GitHub cards and "Fixes …" for the Sentry issues a goal came from.
 * Issues in another repo than the PR's are written as owner/repo#n so GitHub still links them.
 */
export function closingLines(goal: Goal, prRepo?: string): string[] {
  const lines: string[] = [];
  for (const s of goal.sources) {
    if (s.type === 'github' && s.number !== undefined) {
      const ref = s.repo && prRepo && s.repo.toLowerCase() !== prRepo.toLowerCase() ? `${s.repo}#${s.number}` : `#${s.number}`;
      lines.push(`Closes ${ref}`);
    } else if (s.type === 'sentry') {
      lines.push(`Fixes ${s.shortId}`);
    }
  }
  return [...new Set(lines)];
}

/** Short test summary from the goal's QA tasks, or null when there were none. */
export function testsLine(tasks: Task[]): string | null {
  const qa = tasks.filter((t) => t.kind === TaskKind.QA);
  if (!qa.length) return null;
  const done = qa.filter((t) => t.status === TaskStatus.Done).length;
  return done === qa.length ? `QA passed (${qa.length} ${qa.length === 1 ? 'task' : 'tasks'})` : `QA: ${done} of ${qa.length} tasks passed`;
}

/** Default PR body: the Team Lead's report, what it closes/fixes, security and test status. */
/** `sections` (e.g. the Proof section) go after the checks, before the footer. */
export function buildPrBody(goal: Goal, tasks: Task[], openFindings: number, prRepo?: string, sections: string[] = []): string {
  const parts: string[] = [];
  const report = goal.summary.trim() || goal.plan.trim() || goal.brief.trim();
  parts.push(report);
  const work = tasks.filter((t) => t.kind !== TaskKind.QA && !t.reverted);
  if (work.length) parts.push(`### Tasks\n${work.map((t) => `- ${t.id}: ${t.title}`).join('\n')}`);
  const closing = closingLines(goal, prRepo);
  if (closing.length) parts.push(closing.join('\n'));
  const checks = [
    `Security: ${openFindings ? `${openFindings} open ${openFindings === 1 ? 'finding' : 'findings'} (see AgentRoom → Security)` : 'no open findings'}`,
    testsLine(tasks) ? `Tests: ${testsLine(tasks)}` : '',
  ].filter(Boolean);
  parts.push(checks.join('\n'));
  parts.push(...sections.filter(Boolean));
  parts.push(`_Made with AgentRoom (${goal.id})._`);
  return parts.join('\n\n');
}
