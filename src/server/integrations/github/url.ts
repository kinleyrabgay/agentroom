/** A GitHub Projects (v2) board address. */
export interface ProjectRef {
  ownerType: 'org' | 'user';
  owner: string;
  number: number;
  /** Canonical URL without views/filters. */
  url: string;
}

const PROJECT_URL = /^https?:\/\/github\.com\/(orgs|users)\/([A-Za-z0-9][A-Za-z0-9-]*)\/projects\/(\d+)(?:[/?#].*)?$/;

/** Parse `https://github.com/orgs/<org>/projects/<n>` or `/users/<user>/projects/<n>` (views and query ignored). */
export function parseProjectUrl(raw: string): ProjectRef {
  const m = PROJECT_URL.exec(raw.trim());
  if (!m) {
    throw new Error('Paste a GitHub project URL like https://github.com/orgs/<org>/projects/<number> or https://github.com/users/<user>/projects/<number>.');
  }
  const ownerType = m[1] === 'orgs' ? 'org' : 'user';
  const number = Number(m[3]);
  return { ownerType, owner: m[2], number, url: `https://github.com/${m[1]}/${m[2]}/projects/${number}` };
}
