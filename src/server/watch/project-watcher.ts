import { watch } from 'chokidar';
import { StateType } from '../../shared/enums.js';
import type { Project } from '../../core/project.js';
import { WATCH_DEBOUNCE_MS } from '../config/constants.js';
import type { Hub } from '../realtime/hub.js';

/** Push full project state (bots incl. their skills, library, tasks, config) to the UI. */
export function pushProjectState(project: Project, hub: Hub) {
  try {
    hub.state({ type: StateType.Bots, bots: project.bots.list() });
    hub.state({ type: StateType.Skills, skills: project.library.list() });
    pushBoard(project, hub);
    hub.state({ type: StateType.Config, config: project.config.get() });
    hub.state({ type: StateType.Settings, settings: project.settings.get() });
  } catch (err) {
    console.warn('[agentroom] reload failed:', (err as Error).message);
  }
}

/** Push goals + tasks (board.json). Called by the watcher and right after engine writes. */
export function pushBoard(project: Project, hub: Hub) {
  hub.state({ type: StateType.Goals, goals: project.goals.list() });
  hub.state({ type: StateType.Tasks, tasks: project.tasks.list() });
}

/** Re-push state whenever anything under `.agentroom/` (except runs/) changes: UI edits, hand edits, git checkouts. */
export function watchProject(project: Project, hub: Hub, onMcpChange?: () => void): () => Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const runs = project.paths.runs;
  let mcpTimer: NodeJS.Timeout | undefined;
  const watcher = watch(project.paths.dir, { ignoreInitial: true, ignored: (p) => p.startsWith(runs) }).on('all', (_event, file) => {
    if (onMcpChange && file === project.paths.mcpFile) {
      clearTimeout(mcpTimer);
      mcpTimer = setTimeout(onMcpChange, WATCH_DEBOUNCE_MS);
    }
    clearTimeout(timer);
    timer = setTimeout(() => pushProjectState(project, hub), WATCH_DEBOUNCE_MS);
  });
  return async () => {
    clearTimeout(timer);
    await watcher.close();
  };
}
