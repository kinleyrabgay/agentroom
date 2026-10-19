import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// A zustand selector must return a stable reference. Creating a fallback array/object inside it
// (e.g. `useStore((s) => s.x ?? [])`) yields a new value on every read, and React re-renders forever
// ("Maximum update depth exceeded"). Select the stable value and apply the fallback outside.
const BAD = /use\w*Store\(\s*\(?\s*\w+\s*\)?\s*=>[^)]*\?\?\s*(\[\]|\{\})\s*\)/;

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('web store selectors', () => {
  it('never create fallback arrays/objects inside a selector', () => {
    const offenders = ['web/features', 'web/components', 'web/lib', 'web/hooks']
      .flatMap(files)
      .flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
      .filter(({ line }) => BAD.test(line))
      .map(({ f, i, line }) => `${f}:${i + 1}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});
