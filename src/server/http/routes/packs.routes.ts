import type { Hono } from 'hono';
import type { Project } from '../../../core/project.js';
import { PackManager, findPack } from '../../../core/packs/packs.js';
import { AuditKind } from '../../../shared/enums.js';
import type { PackResult } from '../../../shared/types/index.js';
import type { RegistryService } from '../../registry/registry.service.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { body, respond } from '../respond.js';

const MAX_UPLOAD_BYTES = 6_000_000;

function summary(r: PackResult): string {
  const n = (a: string) => r.changes.filter((c) => c.action === a).length;
  return `${n('created')} added, ${n('updated') + n('merged')} updated, ${r.conflicts.length} to merge`;
}

/** Team packs (Settings → Packs) and the skill registry (Skills → Browse). */
export function packRoutes(app: Hono, project: Project, registry: RegistryService, audit: HumanAudit) {
  const packs = new PackManager(project);

  app.get('/packs', (c) => respond(c, () => packs.list()));
  app.post('/packs/:name/install', (c) =>
    respond(c, () => {
      const r = packs.apply(findPack(c.req.param('name'), project.root));
      audit(AuditKind.Settings, `Installed pack ${r.name} ${r.version}: ${summary(r)}`);
      return r;
    }),
  );
  app.post('/packs/:name/update', (c) =>
    respond(c, () => {
      const r = packs.update(c.req.param('name'));
      audit(AuditKind.Settings, `Updated pack ${r.name} to ${r.version}: ${summary(r)}`);
      return r;
    }),
  );
  app.delete('/packs/:name', (c) =>
    respond(c, () => {
      const r = packs.remove(c.req.param('name'));
      audit(AuditKind.Settings, `Removed pack ${r.name}`);
      return r;
    }),
  );

  app.get('/registry/sources', (c) => c.json(registry.sources()));
  app.get('/registry/installed', (c) => respond(c, () => registry.installed()));
  app.get('/registry/search', (c) => respond(c, () => registry.search(c.req.query('q') ?? '')));
  app.post('/registry/preview', async (c) => {
    const { ref } = await body<{ ref?: string }>(c);
    return respond(c, () => {
      if (!ref) throw new Error('ref is required');
      return registry.preview(ref);
    });
  });
  app.post('/registry/upload', async (c) => {
    const { name, data } = await body<{ name?: string; data?: string }>(c);
    return respond(c, () => {
      if (!name || !data) throw new Error('name and data (base64) are required');
      const buf = Buffer.from(data, 'base64');
      if (buf.length > MAX_UPLOAD_BYTES) throw new Error('file is larger than 6 MB');
      return registry.previewUpload(name, buf);
    });
  });
  app.post('/registry/install', async (c) => {
    const { id, overwrite } = await body<{ id?: string; overwrite?: boolean }>(c);
    return respond(c, () => {
      if (!id) throw new Error('id is required');
      const r = registry.install(id, { overwrite: !!overwrite });
      audit(AuditKind.Settings, `Installed skill ${r.name} from ${r.source}`, { detail: { sha256: r.sha256, version: r.version } });
      return r;
    });
  });
  app.post('/registry/skills/:name/check', (c) => respond(c, () => registry.checkUpdate(c.req.param('name'))));
}
