/** Team packs and the skill registry: what the API and the UI exchange. */

/** How a pack recognises the stack it's for. Any rule that matches suggests the pack. */
export interface PackDetect {
  /** Files or folders that exist at the repo root (e.g. "next.config.ts", "pubspec.yaml"). */
  files?: string[];
  /** Dependencies in package.json (dependencies or devDependencies). */
  packageDeps?: string[];
  /** Dependencies in pubspec.yaml. */
  pubspecDeps?: string[];
}

/** `pack.json` at the root of a pack. */
export interface PackManifest {
  name: string;
  title: string;
  description: string;
  version: string;
  /** Stacks it's built for, shown as chips ("Next.js", "Stripe"). */
  stacks: string[];
  detect: PackDetect;
}

export interface PackFileChange {
  /** Path inside `.agentroom/`. */
  path: string;
  action: 'created' | 'updated' | 'merged' | 'unchanged' | 'kept' | 'conflict' | 'removed' | 'skipped';
  /** Why, for kept/conflict/skipped. */
  note?: string;
}

export interface PackResult {
  name: string;
  version: string;
  changes: PackFileChange[];
  /** Settings keys the pack set, and keys it left alone because you changed them. */
  settings: { applied: string[]; kept: string[] };
  /** Files that need you: your edits and the pack's both changed the same lines. */
  conflicts: string[];
}

export interface PackView extends PackManifest {
  /** Built in to AgentRoom, or a local folder. */
  origin: 'builtin' | 'local';
  /** Matches this repo's stack. */
  suggested: boolean;
  /** Why it was suggested ("package.json depends on next"). */
  reason?: string;
  installed?: { version: string; installedAt: string; files: number; modified: number; updateAvailable: boolean };
  /** What's inside: bots, skills and goal templates. */
  contents: { bots: string[]; skills: string[]; goalTemplates: string[]; settings: boolean };
}

/** A configured registry (team settings). */
export interface RegistrySource {
  id: string;
  name: string;
  /** `index`: an AgentRoom-format index.json; `skills-sh`: the skills.sh directory (skills live in GitHub repos). */
  kind: 'index' | 'skills-sh';
  url: string;
  enabled: boolean;
}

/** One search hit. `ref` is what install/preview takes. */
export interface RegistrySkill {
  ref: string;
  registry: string;
  name: string;
  description: string;
  version?: string;
  author?: string;
  installs?: number;
  /** Where the files come from (repo or tarball URL). */
  origin: string;
  /** Already in this project's library (and from where). */
  installed?: { version?: string; source?: string };
}

export interface RegistrySearch {
  results: RegistrySkill[];
  /** Registries that failed, with the reason (shown quietly). */
  errors: { registry: string; error: string }[];
}

export interface SkillPreviewFile {
  path: string;
  size: number;
  /** Text files are shown in full; binary ones by name only. */
  text?: string;
  /** Looks like something that would run (scripts, shebang, executable extensions). Never run on install. */
  executable: boolean;
}

/** Everything the human reviews before installing a skill. */
export interface SkillPreview {
  id: string;
  name: string;
  description: string;
  version: string;
  source: string;
  /** sha256 of the bundle; for index registries it was checked against the index. */
  sha256: string;
  verified: boolean;
  skillMd: string;
  files: SkillPreviewFile[];
  /** Prompt-injection and other warnings found in the text. */
  warnings: { label: string; excerpt: string }[];
  /** A skill with this name already exists in the library. */
  exists: { source?: string; version?: string; modified: boolean } | null;
}

export interface InstalledSkillInfo {
  name: string;
  source: string;
  version?: string;
  sha256?: string;
  /** Files changed since install. */
  modified: boolean;
}
