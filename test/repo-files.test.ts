import { describe, expect, it } from 'vitest';
import { rankFiles } from '../src/server/services/repo-files.js';

describe('rankFiles', () => {
  const files = ['src/app.ts', 'docs/specs/github-board.md', 'README.md', 'src/github/client.ts', 'notes/github.md'];
  it('puts markdown first and filters by query', () => {
    expect(rankFiles(files, 'github', 10)).toEqual(['notes/github.md', 'docs/specs/github-board.md', 'src/github/client.ts']);
    expect(rankFiles(files, '', 2)).toEqual(['README.md', 'notes/github.md']);
  });
});
