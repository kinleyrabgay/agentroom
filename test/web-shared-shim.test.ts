import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// web/lib/shared.ts mirrors src/shared/index.ts without `.js` specifiers (Turbopack can't map them).
// Keep the two in sync: every module the shared barrel exports must be re-exported by the web shim.
const modules = (file: string) =>
  [...fs.readFileSync(file, 'utf8').matchAll(/export (?:type )?\*(?: as \w+)? from ['"]([^'"]+)['"]/g)]
    .map((m) => m[1].replace(/^\.\.\/\.\.\/src\/shared\//, './').replace(/\.js$/, '').replace(/\/index$/, '/index'))
    .sort();

describe('web shared shim', () => {
  it('re-exports every module of the shared barrel', () => {
    const barrel = modules('src/shared/index.ts');
    const shim = modules('web/lib/shared.ts');
    expect(shim).toEqual(barrel);
  });
});
