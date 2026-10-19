import { PROJECT_DIR } from '../shared/constants.js';
import { Project } from '../core/project.js';

export const currentProject = () => new Project(process.cwd());

/** Scaffold `.agentroom/` on first use so every command just works. */
export function ensureInitialized(project: Project) {
  if (project.exists()) return;
  const created = project.init();
  console.log(`✔ Created ${PROJECT_DIR}/ (${created.length} files)`);
}
