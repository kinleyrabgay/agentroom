import fs from 'node:fs';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ATTACHMENT_MAX_BYTES } from '../../../shared/constants.js';
import { isUploadId, toAttachment, type UploadStore } from '../../services/upload.store.js';
import { respond } from '../respond.js';

/** Multipart overhead allowed on top of the file itself. */
const MULTIPART_SLACK = 64 * 1024;

/** Chat attachments: upload one file, then fetch it (images in the transcript) or its metadata. */
export function uploadRoutes(app: Hono, uploads: UploadStore) {
  app.post(
    '/uploads',
    bodyLimit({
      maxSize: ATTACHMENT_MAX_BYTES + MULTIPART_SLACK,
      onError: (c) => c.json({ error: `Attachments can be up to ${ATTACHMENT_MAX_BYTES / 1024 / 1024} MB.` }, 413),
    }),
    async (c) => {
      let file: unknown;
      try {
        file = (await c.req.parseBody())['file'];
      } catch {
        return c.json({ error: 'Send the file as multipart/form-data in a "file" field.' }, 400);
      }
      if (!(file instanceof File)) return c.json({ error: 'Send the file as multipart/form-data in a "file" field.' }, 400);
      const bytes = Buffer.from(await file.arrayBuffer());
      return respond(c, () => uploads.save({ name: file.name, mime: file.type, bytes }));
    },
  );

  app.get('/uploads/:id/meta', (c) => {
    const a = uploads.get(c.req.param('id'));
    return a ? c.json(toAttachment(a)) : c.json({ error: 'not found' }, 404);
  });

  app.get('/uploads/:id', (c) => {
    const id = c.req.param('id');
    const a = isUploadId(id) ? uploads.get(id) : undefined;
    if (!a) return c.json({ error: 'not found' }, 404);
    const disposition = `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`;
    return new Response(fs.readFileSync(a.path), {
      headers: {
        'content-type': a.mime,
        'content-length': String(a.size),
        'content-disposition': disposition,
        'cache-control': 'private, max-age=86400',
        'x-content-type-options': 'nosniff',
        // Never let an uploaded HTML/SVG run as a page in AgentRoom's origin.
        'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      },
    });
  });
}
