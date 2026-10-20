/** Repo context graph: deterministic facts (files, symbols, imports, modules) plus LLM-written module cards. */

export type Lang =
  | 'ts'
  | 'js'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'dart'
  | 'ruby'
  | 'php'
  | 'swift'
  | 'csharp'
  | 'other';

export type SymbolKind = 'function' | 'class' | 'type' | 'interface' | 'enum' | 'const' | 'component' | 'method' | 'route';

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based. */
  line: number;
  /** The declaration's first line, trimmed and capped. */
  signature: string;
  exported: boolean;
}

/** One import statement as written, before resolution. */
export interface RawImport {
  spec: string;
  /** Names it pulls in: `default`, `*`, or identifiers. Empty for side-effect imports. */
  names: string[];
}

export interface FileNode {
  path: string;
  lang: Lang;
  /** sha1 of the content. */
  hash: string;
  lines: number;
  size: number;
  raw: RawImport[];
  /** Repo-relative files this one imports (resolved). */
  imports: string[];
  /** Imported names per resolved target, used for module surfaces. */
  importNames: Record<string, string[]>;
  /** Packages and modules outside the repo (`zod`, `node:fs`, `fmt`). */
  external: string[];
  symbols: CodeSymbol[];
  /** Namespace/package declared by the file (C#, PHP, Java, Kotlin), for `using`/`import` resolution. */
  namespace?: string;
  isTest: boolean;
  /** For tests: the source files they cover. */
  testsFor: string[];
}

export interface ModuleNode {
  /** Stable path slug, e.g. `src-server-automation`; `root` for the repo root. */
  id: string;
  /** Directory, repo-relative, `''` for the root. */
  dir: string;
  files: string[];
  /** Test files covering this module (inside it or elsewhere). */
  tests: string[];
  /** `file#name` imported from outside the module (`file` alone for side-effect imports). */
  surface: string[];
  surfaceHash: string;
  contentHash: string;
  /** Outgoing module dependencies, weighted by import count. */
  deps: Record<string, number>;
  /** Incoming: modules that import this one. */
  dependents: Record<string, number>;
}

export interface ModuleEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ContextGraph {
  version: 1;
  /** git HEAD at index time, null outside git. */
  indexedSha: string | null;
  indexedAt: string;
  /** Files that differed from `indexedSha` at index time, re-checked on the next update. */
  dirty: string[];
  files: Record<string, FileNode>;
  modules: Record<string, ModuleNode>;
  fileModule: Record<string, string>;
  edges: ModuleEdge[];
  /** Directories with a package manifest (package.json, go.mod, …). */
  packages: string[];
}

/** A claim in a card, always backed by `path:line` or `path#symbol` citations. */
export interface Claim {
  text: string;
  cite: string[];
}

export interface CardDraft {
  purpose: string;
  entryPoints: Claim[];
  invariants: Claim[];
  gotchas: Claim[];
  howToChange: Claim[];
}

export interface ModuleCard extends CardDraft {
  id: string;
  /** Module files and their hashes when the card was last generated or checked. */
  sources: Record<string, string>;
  surfaceHash: string;
  generatedAt: string;
  generatedAtSha: string | null;
  /** When hashes were last refreshed after small internal edits (no regeneration). */
  refreshedAt?: string;
  /** `YYYY-MM-DD · text`, appended over time, never regenerated away. */
  decisions: string[];
  /** Written by humans, kept verbatim, highest priority. */
  humanNotes: string;
  /** Claims a human marked wrong (`claim — reason`); fed to the writer so it won't repeat them. */
  rejected: string[];
}

export interface Staleness {
  stale: boolean;
  changedFiles: string[];
  surfaceChanged: boolean;
  /** Citations whose file or symbol no longer exists. */
  brokenCites: string[];
}

export interface CardGenerator {
  generate(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
}
