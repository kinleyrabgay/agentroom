import { z } from 'zod';
import { HostTool } from '../../../shared/enums.js';
import type { HostToolDef } from '../../providers/provider.js';

export type Delegate = (to: string, instruction: string) => Promise<string>;

/** Lets a manager hand work to its direct reports and wait for their final answer. */
export function delegateTool(reports: string[], delegate: Delegate): HostToolDef {
  return {
    name: HostTool.Delegate,
    description: `Give an instruction to a teammate and wait for their final report. Available: ${reports.join(', ')}.`,
    schema: {
      bot: z.string().describe(`one of: ${reports.join(', ')}`),
      instruction: z.string().describe('Self-contained instruction, including the task id if any.'),
    },
    handler: async ({ bot, instruction }) => {
      if (!reports.includes(bot)) throw new Error(`can only delegate to: ${reports.join(', ')}`);
      return delegate(bot, instruction);
    },
  };
}
