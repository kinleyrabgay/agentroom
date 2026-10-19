import { FindingCategory, FindingSeverity, FindingSource } from '../../../shared/enums.js';
import { parseUnifiedDiff, type FileDiff } from '../diff.js';
import type { FindingDraft } from '../types.js';
import { ENV_EXAMPLE, ENV_FILE, FIXTURE_FILE, LINE_RULES, SKIP_FILE, type LineRule } from './rules.js';

const SNIPPET_MAX = 160;

/** Show the first 4 characters of a secret, never the rest. */
export function redact(secret: string): string {
  return secret.length <= 4 ? '…' : `${secret.slice(0, 4)}…`;
}

function snippetFor(rule: LineRule, line: string, m: RegExpExecArray): string {
  let text = line.trim();
  if (rule.secret) {
    const secret = m[1] ?? m[0];
    text = text.split(secret).join(redact(secret));
  }
  return text.length > SNIPPET_MAX ? `${text.slice(0, SNIPPET_MAX - 1)}…` : text;
}

/** Scan the lines a diff adds. Pure: no IO. */
export function scanDiff(diff: string): FindingDraft[] {
  return scanFiles(parseUnifiedDiff(diff));
}

export function scanFiles(files: FileDiff[]): FindingDraft[] {
  const out: FindingDraft[] = [];
  for (const f of files) {
    if (f.isDeleted || f.isBinary) continue;
    if (ENV_FILE.test(f.path) && !ENV_EXAMPLE.test(f.path) && f.added.length) {
      out.push({
        severity: FindingSeverity.Critical,
        category: FindingCategory.Secret,
        source: FindingSource.Scanner,
        rule: 'secret.env-file',
        title: 'Environment file committed',
        detail: '`.env` files usually hold real credentials. Remove it from git, add it to .gitignore, and commit a `.env.example` with placeholders instead.',
        file: f.path,
        line: f.added[0].line,
      });
      continue;
    }
    if (SKIP_FILE.test(f.path)) continue;
    const fixture = FIXTURE_FILE.test(f.path);
    for (const { line, text } of f.added) {
      if (text.length > 2000) continue; // minified / generated
      // A known token format beats the generic "hardcoded credential" heuristic on the same line.
      let knownSecret = false;
      for (const rule of LINE_RULES) {
        if (fixture && rule.generic) continue;
        if (knownSecret && rule.generic && rule.category === FindingCategory.Secret) continue;
        const m = rule.pattern.exec(text);
        if (!m || (rule.accept && !rule.accept(text, m))) continue;
        if (rule.category === FindingCategory.Secret && !rule.generic) knownSecret = true;
        out.push({
          severity: rule.severity,
          category: rule.category,
          source: FindingSource.Scanner,
          rule: rule.id,
          title: rule.title,
          detail: rule.detail,
          file: f.path,
          line,
          snippet: snippetFor(rule, text, m),
        });
      }
    }
  }
  return out;
}
