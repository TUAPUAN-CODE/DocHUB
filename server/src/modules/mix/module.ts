import { registerAfterSheetCopied } from '../../services/hooks';
import { readSettings, remapIds, writeSettingsKey } from '../../services/sheetSettings';
import router from './routes';

/** Mixing rows into a new lot with weight cut from a column the manager chooses; links kept in RowLinks. */
registerAfterSheetCopied(async ({ tx, newSheetId, columnMap }) => {
  const s = await readSettings(newSheetId, tx);
  if (!s.mix) return;
  await writeSettingsKey(newSheetId, 'mix', remapIds(s.mix, new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]))), tx);
});

export default { router };
