import router from './routes';

export { startPlanFolderWatcher } from './watcher';

/**
 * InkCode: import of the daily production plan (Excel) — into one worksheet, or automatically into the day files of PF1 / PF2 —
 * and the drop folder that does it by itself. The sheets themselves are plain DocHUB sheets (see model.ts).
 */
export default { router };
