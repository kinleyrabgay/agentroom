import { z } from 'zod';
import { HostTool } from '../../../shared/enums.js';
import type { ContextReader } from '../../../core/context/index.js';
import type { HostToolDef } from '../../providers/provider.js';

/** Runs a read and turns "not built yet" and similar into a plain answer instead of a tool error. */
const safe = (fn: () => string) => async () => {
  try {
    return fn();
  } catch (err) {
    return (err as Error).message;
  }
};

/**
 * Read-only repo map: module cards, search, dependencies and blast radius. Answers are compact text
 * with `path:line` pointers, so a bot can go straight to the right file instead of exploring.
 */
export function contextTools(reader: ContextReader): HostToolDef[] {
  return [
    {
      name: HostTool.ContextOverview,
      description: 'The repo map: every module with its purpose and main dependencies. Usually already in your instructions; call it again after a sync.',
      schema: {},
      handler: () => safe(() => reader.overview())(),
    },
    {
      name: HostTool.ContextModule,
      description:
        "A module's card: purpose, entry points, invariants, gotchas, how to change it, decisions, human notes (authoritative), files with exported symbols, deps and tests. " +
        'Pass a module id, its folder, or any file in it. A ⚠ stale line means the code moved on: verify before relying on it.',
      schema: { target: z.string().min(1).describe('Module id (e.g. src-server-automation), folder, or file path') },
      handler: ({ target }) => safe(() => reader.module(target))(),
    },
    {
      name: HostTool.ContextFind,
      description: 'Search symbols, file paths and module cards. Returns one line per hit with path:line. Use it before broad grep/ls exploration.',
      schema: { query: z.string().min(1).describe('A symbol name, words, or part of a path'), limit: z.number().int().min(1).max(40).optional() },
      handler: ({ query, limit }) => safe(() => reader.find(query, limit ?? 12))(),
    },
    {
      name: HostTool.ContextDeps,
      description:
        'Dependencies of a module, file, `file#symbol` or exported symbol name. direction "uses" = what the target imports; "used_by" = what imports the target.',
      schema: {
        target: z.string().min(1),
        direction: z.enum(['uses', 'used_by']),
        depth: z.number().int().min(1).max(5).optional(),
      },
      handler: ({ target, direction, depth }) => safe(() => reader.deps(target, direction === 'uses' ? 'down' : 'up', depth ?? 2))(),
    },
    {
      name: HostTool.ContextImpact,
      description: 'Blast radius of changing these files: modules and files that depend on them (transitively) and the tests to run.',
      schema: { files: z.array(z.string().min(1)).min(1).max(50) },
      handler: ({ files }) => safe(() => reader.impact(files))(),
    },
  ];
}
