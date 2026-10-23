import fs from 'node:fs';
import { AttachmentKind } from '../../../shared/enums.js';
import { attachmentLines, type ResolvedAttachment } from '../../services/upload.store.js';

/** The Messages API content blocks AgentRoom sends for a human message with attachments. */
export type UserContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string }; title?: string };

export type ReadFile = (path: string) => Buffer;

/**
 * Build the user message content: the text (plus where each file is saved), then images as image
 * blocks, PDFs as document blocks and small text files inlined. Other files are only referenced by
 * path, so the bot reads them with its tools.
 */
export function buildUserContent(text: string, attachments: readonly ResolvedAttachment[], read: ReadFile = fs.readFileSync): UserContentBlock[] {
  const intro = [text.trim(), attachmentLines(attachments)].filter(Boolean).join('\n\n');
  const blocks: UserContentBlock[] = [{ type: 'text', text: intro || '(see attachments)' }];
  for (const a of attachments) {
    switch (a.kind) {
      case AttachmentKind.Image:
        blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: read(a.path).toString('base64') } });
        break;
      case AttachmentKind.Pdf:
        blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: read(a.path).toString('base64') }, title: a.name });
        break;
      case AttachmentKind.Text:
        blocks.push({ type: 'text', text: `--- ${a.name} ---\n${read(a.path).toString('utf8')}` });
        break;
      case AttachmentKind.File:
        // Referenced by path in the intro only.
        break;
    }
  }
  return blocks;
}
