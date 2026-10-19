import type { Hono } from 'hono';
import { AuditKind, StateType } from '../../../shared/enums.js';
import type { SettingsPatch } from '../../../shared/types/index.js';
import type { Project } from '../../../core/project.js';
import { changedKeys } from '../../../core/fs/deep-merge.js';
import type { Hub } from '../../realtime/hub.js';
import type { HumanAudit } from '../../services/audit.service.js';
import type { SecretsStore } from '../../services/secrets.store.js';
import { body, respond } from '../respond.js';

/** Team settings (committed) and local integration secrets (write-only). */
export function settingsRoutes(app: Hono, project: Project, secrets: SecretsStore, hub: Hub, audit: HumanAudit) {
  app.get('/settings', (c) => respond(c, () => project.settings.get()));
  app.patch('/settings', async (c) => {
    const patch = await body<SettingsPatch>(c);
    return respond(c, () => {
      const before = project.settings.get();
      const next = project.settings.update(patch);
      const changed = changedKeys(before, next);
      if (changed.length) {
        audit(AuditKind.Settings, `Settings changed: ${changed.join(', ')}`, { detail: { changed } });
        hub.state({ type: StateType.Settings, settings: next });
      }
      return next;
    });
  });

  app.get('/integrations', (c) => c.json(secrets.status()));
  app.put('/integrations', async (c) => {
    const patch = await body<Record<string, unknown>>(c);
    return respond(c, () => {
      const status = secrets.update(patch);
      // Never log secret values — only which integrations were touched.
      audit(AuditKind.Settings, `Integrations updated: ${Object.keys(patch).join(', ') || 'none'}`, { detail: { status } });
      return status;
    });
  });
}
