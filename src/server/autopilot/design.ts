import fs from 'node:fs';
import path from 'node:path';
import type { GoalDesign, GoalTemplate } from '../../shared/types/index.js';

/** Secret shared by the Figma MCP preset (token variant) and the design reference download. */
export const FIGMA_TOKEN_SECRET = 'FIGMA_ACCESS_TOKEN';

/** `https://www.figma.com/design/<key>/<name>?node-id=12-345` → file key and node id ("12:345"). */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId?: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/(^|\.)figma\.com$/i.test(u.hostname)) return null;
  const m = /^\/(?:design|file|proto|board)\/([A-Za-z0-9]{10,})/.exec(u.pathname);
  if (!m) return null;
  const raw = u.searchParams.get('node-id');
  const nodeId = raw ? raw.replace('-', ':') : undefined;
  return { fileKey: m[1], ...(nodeId && /^\d+:\d+$/.test(nodeId) ? { nodeId } : {}) };
}

/** "1440x900", "1440 × 900", "1440" → size; nonsense → undefined. */
export function parseSize(text: string | undefined): { width?: number; height?: number } {
  const m = /^\s*(\d{2,5})\s*(?:[x×*,]\s*(\d{2,5}))?\s*(?:px)?\s*$/i.exec(text ?? '');
  if (!m) return {};
  const width = Number(m[1]);
  const height = m[2] ? Number(m[2]) : undefined;
  const ok = (n: number | undefined) => n === undefined || (n >= 200 && n <= 4000);
  return ok(width) && ok(height) ? { width, ...(height ? { height } : {}) } : {};
}

/**
 * The design spec of an "Implement design" goal from its template fields: `figma` (frame link),
 * `image` (upload id), `page` and `size`. Throws when neither a link nor an image is given.
 */
export function designFromFields(template: Pick<GoalTemplate, 'design' | 'fields'>, fields: Record<string, string>): GoalDesign | undefined {
  if (!template.design) return undefined;
  const figmaUrl = String(fields.figma ?? '').trim();
  const imageField = template.fields.find((f) => f.image);
  const uploadId = imageField ? String(fields[imageField.id] ?? '').trim() : '';
  const page = String(fields.page ?? '').trim() || '/';
  if (!figmaUrl && !uploadId) throw new Error('Add a Figma frame link or a design image.');
  if (!page.startsWith('/')) throw new Error('The page must be a path on your app, like /pricing.');
  const size = parseSize(fields.size);
  if (figmaUrl) {
    const f = parseFigmaUrl(figmaUrl);
    if (!f) throw new Error("That isn't a Figma file or frame link.");
    if (!f.nodeId && !uploadId) throw new Error('Copy the link of the frame itself (it has a node-id), not the whole file.');
    return { source: 'figma', figmaUrl, fileKey: f.fileKey, ...(f.nodeId ? { nodeId: f.nodeId } : {}), ...(uploadId ? { uploadId } : {}), path: page, ...size };
  }
  return { source: 'upload', uploadId, path: page, ...size };
}

export interface FigmaFrame {
  png: Buffer;
  width?: number;
  height?: number;
}

/** Export a frame as PNG with the Figma REST API (read-only). */
export async function fetchFigmaFrame(token: string, fileKey: string, nodeId: string, fetchImpl: typeof fetch = fetch): Promise<FigmaFrame> {
  const headers = { 'X-Figma-Token': token };
  const ids = encodeURIComponent(nodeId);
  const get = async (url: string) => {
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (res.status === 403 || res.status === 401) throw new Error('Figma refused the token (check FIGMA_ACCESS_TOKEN and that you can open the file).');
    if (res.status === 404) throw new Error('Figma file or frame not found.');
    if (!res.ok) throw new Error(`Figma answered ${res.status}.`);
    return res.json() as Promise<Record<string, unknown>>;
  };
  const images = (await get(`https://api.figma.com/v1/images/${encodeURIComponent(fileKey)}?ids=${ids}&format=png&scale=1`)) as { err?: string | null; images?: Record<string, string | null> };
  if (images.err) throw new Error(`Figma: ${images.err}`);
  const url = images.images?.[nodeId];
  if (!url) throw new Error('Figma returned no image for that frame.');
  const img = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!img.ok) throw new Error(`Couldn't download the frame image (${img.status}).`);
  const png = Buffer.from(await img.arrayBuffer());
  let width: number | undefined;
  let height: number | undefined;
  try {
    const nodes = (await get(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${ids}`)) as {
      nodes?: Record<string, { document?: { absoluteBoundingBox?: { width: number; height: number } } } | null>;
    };
    const box = nodes.nodes?.[nodeId]?.document?.absoluteBoundingBox;
    if (box) {
      width = Math.round(box.width);
      height = Math.round(box.height);
    }
  } catch {
    /* size is optional: the image's own size is used */
  }
  return { png, ...(width ? { width } : {}), ...(height ? { height } : {}) };
}

export interface DesignReferenceDeps {
  /** Absolute path of an upload, or undefined. */
  uploadPath: (id: string) => string | undefined;
  figmaToken: () => string | undefined;
  fetchImpl?: typeof fetch;
}

export interface DesignReference {
  /** Image file (any format the browser can show). */
  file: string;
  width?: number;
  height?: number;
}

/**
 * The design image for a goal, cached as `design-source.*` in its proof folder: the uploaded image,
 * else the Figma frame exported with the REST API (needs FIGMA_ACCESS_TOKEN).
 */
export async function designReference(design: GoalDesign, dir: string, deps: DesignReferenceDeps): Promise<DesignReference> {
  fs.mkdirSync(dir, { recursive: true });
  const cached = fs.readdirSync(dir).find((f) => f.startsWith('design-source.'));
  const size = { ...(design.width ? { width: design.width } : {}), ...(design.height ? { height: design.height } : {}) };
  if (cached) return { file: path.join(dir, cached), ...size };
  if (design.uploadId) {
    const p = deps.uploadPath(design.uploadId);
    if (!p || !fs.existsSync(p)) throw new Error('The design image upload is gone (uploads are kept 30 days). Attach it again.');
    const target = path.join(dir, `design-source${path.extname(p).toLowerCase() || '.png'}`);
    fs.copyFileSync(p, target);
    return { file: target, ...size };
  }
  if (design.source === 'figma' && design.fileKey && design.nodeId) {
    const token = deps.figmaToken();
    if (!token) throw new Error(`Add ${FIGMA_TOKEN_SECRET} (Settings → Integrations → MCP servers → Figma) or attach the design image to compare with Figma.`);
    const frame = await fetchFigmaFrame(token, design.fileKey, design.nodeId, deps.fetchImpl);
    const target = path.join(dir, 'design-source.png');
    fs.writeFileSync(target, frame.png);
    return { file: target, width: design.width ?? frame.width, height: design.height ?? frame.height };
  }
  throw new Error('No design to compare with.');
}
