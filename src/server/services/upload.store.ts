import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ATTACHMENT_IMAGE_MAX_BYTES, ATTACHMENT_MAX_BYTES, ATTACHMENTS_PER_MESSAGE } from '../../shared/constants.js';
import { AttachmentKind } from '../../shared/enums.js';
import type { Attachment } from '../../shared/types/index.js';
import { readJson, writeJson } from '../../core/fs/json.js';
import { detect } from './upload-detect.js';

/** Uploads older than this are deleted on startup. */
export const UPLOAD_RETENTION_DAYS = 30;
const NAME_MAX = 120;
const ID_PATTERN = /^[A-Za-z0-9_-]{16,40}$/;
const META_FILE = 'meta.json';

/** An attachment plus where its bytes are on disk. */
export interface ResolvedAttachment extends Attachment {
  /** Absolute path of the stored file. */
  path: string;
  /** Path relative to the project root, for bot prompts. */
  relPath: string;
}

export const isUploadId = (id: string) => ID_PATTERN.test(id);

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** A display- and filesystem-safe file name: no directories, no control chars, bounded length. */
export function safeName(name: string): string {
  const base = path.basename(String(name || '').replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  const clean = base.replace(/^\.+/, '') || 'file';
  if (clean.length <= NAME_MAX) return clean;
  const ext = path.extname(clean).slice(0, 16);
  return clean.slice(0, NAME_MAX - ext.length) + ext;
}

/**
 * Files the human attached to messages: `.agentroom/runs/uploads/<id>/<name>` plus `meta.json`.
 * Local only (runs/ is gitignored).
 */
export class UploadStore {
  constructor(private readonly dir: string, private readonly projectRoot: string) {}

  /** Validate and store one file. Throws a readable Error when it can't be attached. */
  save(input: { name: string; mime: string; bytes: Buffer }): Attachment {
    const { bytes } = input;
    if (!bytes.length) throw new Error('The file is empty.');
    if (bytes.length > ATTACHMENT_MAX_BYTES) throw new Error(`File is ${mb(bytes.length)}; attachments can be up to ${mb(ATTACHMENT_MAX_BYTES)}.`);
    const name = safeName(input.name);
    const found = detect(bytes, input.mime, name);
    if (found.kind === AttachmentKind.Image && bytes.length > ATTACHMENT_IMAGE_MAX_BYTES) {
      throw new Error(`Image is ${mb(bytes.length)}; the model accepts up to ${mb(ATTACHMENT_IMAGE_MAX_BYTES)} — crop or compress it.`);
    }
    const id = randomBytes(15).toString('base64url');
    const attachment: Attachment = {
      id,
      name,
      mime: found.mime,
      size: bytes.length,
      kind: found.kind,
      ...(found.width && found.height ? { width: found.width, height: found.height } : {}),
    };
    const folder = path.join(this.dir, id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, name), bytes);
    writeJson(path.join(folder, META_FILE), { ...attachment, createdAt: new Date().toISOString() });
    return attachment;
  }

  get(id: string): ResolvedAttachment | undefined {
    if (!isUploadId(id)) return undefined;
    const meta = readJson<Attachment | null>(path.join(this.dir, id, META_FILE), null);
    if (!meta || meta.id !== id) return undefined;
    const file = path.join(this.dir, id, safeName(meta.name));
    if (!fs.existsSync(file)) return undefined;
    const { id: _id, name, mime, size, kind, width, height } = meta;
    return {
      id,
      name,
      mime,
      size,
      kind,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      path: file,
      relPath: path.relative(this.projectRoot, file),
    };
  }

  /** Resolve upload ids for a message. Throws on unknown ids or too many. */
  resolve(ids: readonly string[] | undefined): ResolvedAttachment[] {
    const unique = [...new Set(ids ?? [])];
    if (unique.length > ATTACHMENTS_PER_MESSAGE) throw new Error(`Up to ${ATTACHMENTS_PER_MESSAGE} attachments per message.`);
    return unique.map((id) => {
      const a = this.get(id);
      if (!a) throw new Error(`Attachment ${id} not found — upload it again.`);
      return a;
    });
  }

  /** Delete uploads older than the retention period. Returns how many were removed. */
  prune(days = UPLOAD_RETENTION_DAYS, now = Date.now()): number {
    if (!fs.existsSync(this.dir)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isUploadId(entry.name)) continue;
      const folder = path.join(this.dir, entry.name);
      const created = Date.parse(readJson<{ createdAt?: string }>(path.join(folder, META_FILE), {}).createdAt ?? '') || fs.statSync(folder).mtimeMs;
      if (now - created > days * 86_400_000) {
        fs.rmSync(folder, { recursive: true, force: true });
        removed++;
      }
    }
    return removed;
  }
}

/** Strip the on-disk path before sending attachment metadata to the UI / events. */
export function toAttachment(a: ResolvedAttachment): Attachment {
  const { path: _p, relPath: _r, ...meta } = a;
  return meta;
}

const KIND_LABEL: Record<AttachmentKind, string> = {
  [AttachmentKind.Image]: 'image',
  [AttachmentKind.Pdf]: 'PDF',
  [AttachmentKind.Text]: 'text file',
  [AttachmentKind.File]: 'file',
};

/** "Attached: shot.png (image) — saved at .agentroom/runs/uploads/<id>/shot.png" lines, for bot prompts. */
export function attachmentLines(attachments: readonly ResolvedAttachment[]): string {
  return attachments
    .map((a) => {
      const dims = a.width && a.height ? `, ${a.width}×${a.height} px` : '';
      return `Attached: ${a.name} (${KIND_LABEL[a.kind]}${dims}) — saved at ${a.relPath}`;
    })
    .join('\n');
}
