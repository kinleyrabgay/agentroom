import type { SecurityReviewMode } from '../enums.js';

// ---------- goal templates ----------

export interface GoalTemplateField {
  id: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  required?: boolean;
  /** An image upload (the value is the upload id; the image is attached to the goal). */
  image?: boolean;
}

/** `.agentroom/goal-templates/<id>.md`: frontmatter describes the form, the body guides the Planner. */
export interface GoalTemplate {
  id: string;
  name: string;
  description: string;
  icon?: string;
  order: number;
  fields: GoalTemplateField[];
  securityReview?: SecurityReviewMode;
  budgetUsd?: number;
  /** Fields `figma`, `page`, `size` and `image` describe a design the Verify step compares against. */
  design?: boolean;
  /** Planner guidance (the markdown body). */
  guidance: string;
}

export interface GoalTemplateList {
  templates: GoalTemplate[];
  /** True when the project has no goal-templates folder and these are AgentRoom's built-in defaults. */
  builtIn: boolean;
}

// ---------- bot memory ----------

/** One line of `bots/<dir>/memory.md`. Pinned notes start with "📌". */
export interface MemoryNote {
  text: string;
  pinned: boolean;
}

/** A note a bot proposed with `memory_note`; the human keeps or ignores it. */
export interface MemorySuggestion {
  id: string;
  botId: string;
  note: string;
  reason?: string;
  ts: string;
}

export interface BotMemory {
  notes: MemoryNote[];
  suggestions: MemorySuggestion[];
}

// ---------- remote (phone) approvals ----------

export type RemoteState = 'off' | 'starting' | 'on' | 'error';

export interface RemoteStatus {
  state: RemoteState;
  /** Public tunnel URL while on. */
  url?: string;
  /** Link to open on the phone (contains the remote token). Only returned to the local UI. */
  link?: string;
  expiresAt?: string;
  error?: string;
  /** cloudflared is not installed. */
  missingBinary?: boolean;
}

/** What the phone page may see: only things waiting on the human. */
export interface RemotePending {
  approvals: { requestId: string; botName: string; tool: string; summary: string; reason: string; ts: number }[];
  questions: { id: string; botName: string; question: string; options: string[]; ts: number }[];
  plans: { goalId: string; title: string; tasks: number }[];
}
