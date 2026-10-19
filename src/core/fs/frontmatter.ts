import matter from 'gray-matter';

export interface ParsedDocument {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): ParsedDocument {
  const parsed = matter(text);
  return { data: parsed.data, body: parsed.content.trim() };
}

/**
 * Hand-editable YAML frontmatter: plain scalars when safe, JSON-quoted otherwise (valid YAML),
 * flow-style arrays. Keeps emoji readable, unlike js-yaml's escaping.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const scalar = (v: unknown) => {
    const str = String(v);
    return /^[\w][\w .\-/]*$/.test(str) && !/^(true|false|null|yes|no|~|[\d.]+)$/i.test(str) ? str : JSON.stringify(str);
  };
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.map(scalar).join(', ')}]` : scalar(v)}`);
  return `---\n${lines.join('\n')}\n---\n${body.trim()}\n`;
}
