import type { z } from 'zod';
import type { GoalAutopilotSchema, GoalDesignSchema } from '../schemas.js';

/** Incident autopilot state on a goal started from a Sentry issue (reproduce → failing test → fix → verify). */
export type GoalAutopilot = z.infer<typeof GoalAutopilotSchema>;
export type AutopilotStatus = GoalAutopilot['status'];
export type AutopilotConfidence = NonNullable<GoalAutopilot['confidence']>;
export type AutopilotFactor = AutopilotConfidence['factors'][number];

/** "Implement design" goals: the reference the Verify step compares the page against. */
export type GoalDesign = z.infer<typeof GoalDesignSchema>;

/** Result of comparing the implemented page with the design reference (Verify phase). */
export interface DesignMatch {
  /** Files in the goal's proof folder. */
  reference: string;
  shot: string;
  diff?: string;
  /** 0–100: weighted structure, pixel match and proportions. */
  score: number;
  /** Share of pixels that match (0–100) after scaling both to the same width. */
  pixelMatch: number;
  /** Structural similarity of the luminance (0–100), robust to small shifts and anti-aliasing. */
  structure: number;
  /** How close the page's proportions are to the frame's (0–100). */
  proportions: number;
  /** Size the page was rendered at (the frame's size). */
  width: number;
  height: number;
  source: GoalDesign['source'];
  path: string;
  /** Why the comparison couldn't run. */
  error?: string;
}

/** Sentry issue page: autopilot runs for an issue. */
export interface AutopilotIssueRun {
  goalId: string;
  title: string;
  status: AutopilotStatus;
  goalStatus: string;
  confidence?: number;
  pr?: string;
  startedAt: string;
}
