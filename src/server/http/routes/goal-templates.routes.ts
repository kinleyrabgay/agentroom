import type { Hono } from 'hono';
import { AuditKind } from '../../../shared/enums.js';
import type { Project } from '../../../core/project.js';
import type { HumanAudit } from '../../services/audit.service.js';
import { respond } from '../respond.js';

/** Goal templates: list them, and copy the built-in set into the repo so the team can edit it. */
export function goalTemplateRoutes(app: Hono, project: Project, audit: HumanAudit) {
  app.get('/goal-templates', (c) => respond(c, () => project.goalTemplates.list()));
  app.post('/goal-templates/save-defaults', (c) =>
    respond(c, () => {
      const created = project.goalTemplates.saveDefaults();
      audit(AuditKind.Settings, `Saved ${created.length} goal templates to the repo`);
      return project.goalTemplates.list();
    }),
  );
}
