/** One file a chat run wrote: its diff from before the run's first write to after its last. */
export interface TurnFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  /** Unified diff (headers omitted); empty when too large or binary. */
  patch: string;
  /** Why `patch` is empty. */
  note?: string;
}

/** What a run changed, as tracked from its own write tools (never from git status). */
export interface TurnChanges {
  files: TurnFileChange[];
  /** Files written but left out: changed by something else between this run's writes, or over the limits. */
  skipped: { path: string; reason: string }[];
}
