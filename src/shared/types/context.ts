/** Repo context (the map bots read): what the API and the Context page exchange. */

export type ContextCardStatus = 'fresh' | 'stale' | 'missing';

export interface ContextProgress {
  phase: 'graph' | 'cards' | 'index' | 'done';
  message: string;
  done?: number;
  total?: number;
  moduleId?: string;
}

/** Outcome of the last sync, for the status line. */
export interface ContextSyncResult {
  at: string;
  ok: boolean;
  error?: string;
  cardsRegenerated: number;
  cardsFailed: number;
  modulesChanged: number;
  durationMs: number;
  costUsd: number;
}

export interface ContextStatus {
  enabled: boolean;
  /** A fact graph exists. */
  built: boolean;
  indexedSha: string | null;
  indexedAt: string | null;
  files: number;
  modules: number;
  cards: Record<ContextCardStatus, number>;
  /** Estimated size of INDEX.md, which every bot gets. */
  tokensIndex: number;
  syncing: boolean;
  progress: ContextProgress | null;
  last: ContextSyncResult | null;
  /** Rough cost of writing every missing card (USD). */
  estimateUsd: number;
}

export interface ContextModuleSummary {
  id: string;
  dir: string;
  files: number;
  tests: number;
  purpose: string;
  status: ContextCardStatus;
}

export interface ContextGraphView {
  modules: ContextModuleSummary[];
  edges: { from: string; to: string; weight: number }[];
}

export interface ContextCite {
  /** As stored (`path#symbol` or `path:line`). */
  raw: string;
  file: string;
  /** Current line (symbols resolved), when known. */
  line?: number;
  /** False when the file or symbol no longer exists. */
  ok: boolean;
}

export interface ContextClaim {
  text: string;
  cite: ContextCite[];
}

export type ContextClaimSection = 'entryPoints' | 'invariants' | 'gotchas' | 'howToChange';

export interface ContextSymbol {
  name: string;
  kind: string;
  line: number;
  signature: string;
  exported: boolean;
}

export interface ContextFileFacts {
  path: string;
  lines: number;
  isTest: boolean;
  symbols: ContextSymbol[];
}

export interface ContextModuleDetail extends ContextModuleSummary {
  generatedAt: string | null;
  generatedAtSha: string | null;
  sections: Record<ContextClaimSection, ContextClaim[]>;
  decisions: string[];
  rejected: string[];
  humanNotes: string;
  staleness: { changedFiles: string[]; surfaceChanged: boolean; brokenCites: string[] } | null;
  fileFacts: ContextFileFacts[];
  testFiles: string[];
  uses: { id: string; weight: number }[];
  usedBy: { id: string; weight: number }[];
}

export interface ContextFilePeek {
  path: string;
  moduleId: string | null;
  /** 1-based, inclusive. */
  start: number;
  end: number;
  total: number;
  lines: string[];
  focus?: number;
}

export interface ContextHit {
  kind: 'symbol' | 'file' | 'module';
  path: string;
  line?: number;
  name?: string;
  moduleId: string;
  detail: string;
  score: number;
}

export interface ContextImpact {
  files: string[];
  modules: string[];
  tests: string[];
}

export interface ContextIndexView {
  text: string;
  tokens: number;
}
