import { registerAfterSheetCopied } from '../../services/hooks';
import { readSettings, remapIds, writeSettingsKey } from '../../services/sheetSettings';
import router from './routes';

/** QR / barcode / RFID text → columns, by formats the manager defines per sheet. Pure parsing lives in parse.ts. */
registerAfterSheetCopied(async ({ tx, newSheetId, columnMap }) => {
  const s = await readSettings(newSheetId, tx);
  if (!s.scanProfiles) return;
  await writeSettingsKey(newSheetId, 'scanProfiles', remapIds(s.scanProfiles, new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]))), tx);
});

export default { router };
