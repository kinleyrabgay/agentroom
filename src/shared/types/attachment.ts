import type { AttachmentKind } from '../enums.js';

/** A file the human attached to a message (pasted screenshot, dropped PDF, …). Stored locally in `.agentroom/runs/uploads/`. */
export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: AttachmentKind;
  /** Pixel size, for images. */
  width?: number;
  height?: number;
}
