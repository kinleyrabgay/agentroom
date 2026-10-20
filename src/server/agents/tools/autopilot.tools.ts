import { z } from 'zod';
import { HostTool } from '../../../shared/enums.js';
import type { HostToolDef } from '../../providers/provider.js';

export interface AutopilotReporter {
  report(goalId: string, input: { reproduced: boolean; how: string; testFile?: string; testCommand?: string; repo?: string }): string;
}

/** Autopilot goals only: tell AgentRoom whether the bug was reproduced and which test proves it. */
export function autopilotTools(reporter: AutopilotReporter, goalId: string, otherRepos: string[] = []): HostToolDef[] {
  return [
    {
      name: HostTool.AutopilotReport,
      description:
        'Autopilot goals: report whether you reproduced the bug and the failing test that proves it. AgentRoom then runs that test on the starting commit (it must fail) and on the fix (it must pass). If you cannot reproduce it, report reproduced=false: the goal stops for the human instead of guessing a fix. testCommand must be a plain test-runner command that runs only that test, e.g. "npx vitest run test/cart.test.ts" or "pytest tests/test_cart.py" (no shell operators or quotes).',
      schema: {
        reproduced: z.boolean(),
        how: z.string().describe('How you reproduced it (or what you tried), in a few sentences'),
        testFile: z.string().optional().describe('Repo-relative path of the failing test'),
        testCommand: z.string().optional().describe('Command that runs only that test'),
        ...(otherRepos.length ? { repo: z.string().optional().describe(`Workspace repo the test is in, when it isn't the primary repo: one of ${otherRepos.join(', ')}`) } : {}),
      },
      handler: async ({ reproduced, how, testFile, testCommand, repo }) =>
        reporter.report(goalId, { reproduced, how, ...(testFile ? { testFile } : {}), ...(testCommand ? { testCommand } : {}), ...(typeof repo === 'string' && repo ? { repo } : {}) }),
    },
  ];
}
