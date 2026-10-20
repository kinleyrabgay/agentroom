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
  const withOverrides = () => ({ ...project.settings.get(), overrides: project.settings.overrides() });
  app.get('/settings', (c) => respond(c, withOverrides));
  // ?scope=team (default, committed) or personal (runs/settings.local.json, only you).
  app.patch('/settings', async (c) => {
    const patch = await body<SettingsPatch>(c);
    const scope = c.req.query('scope') === 'personal' ? 'personal' : 'team';
    return respond(c, () => {
      const before = project.settings.get();
      const next = project.settings.update(patch, scope);
      const changed = changedKeys(before, next);
      if (changed.length) {
        audit(AuditKind.Settings, `${scope === 'personal' ? 'Personal settings' : 'Settings'} changed: ${changed.join(', ')}`, { detail: { changed, scope } });
      }
      const out = withOverrides();
      hub.state({ type: StateType.Settings, settings: out });
      return out;
    });
  });
  // Drop a personal override so the team value applies again.
  app.delete('/settings/personal', (c) =>
    respond(c, () => {
      const key = c.req.query('key') ?? '';
      if (!key) throw new Error('key is required');
      project.settings.resetPersonal(key);
      audit(AuditKind.Settings, `Personal setting reset: ${key}`, { detail: { key } });
      const out = withOverrides();
      hub.state({ type: StateType.Settings, settings: out });
      return out;
    }),
  );

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
