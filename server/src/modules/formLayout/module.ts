import { Router } from 'express';
import { z } from 'zod';
import { loadColumns } from '../../services/cellWriter';
import { registerAfterSheetCopied } from '../../services/hooks';
import { readSettings, remapIds, writeSettingsKey } from '../../services/sheetSettings';
import { ah, badRequest, ok, parse, pid, zId } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';

/**
 * Design of the "add row" form: how many inputs per line, the order of the fields, the width of each field and which are hidden.
 * Stored in the sheet settings (same for everybody who opens the sheet); the form falls back to "all columns, 2 per line".
 */
const router = Router();

const layoutSchema = z.object({
  perRow: z.number().int().min(1).max(4),
  fields: z.array(z.object({ columnId: zId, span: z.number().int().min(1).max(4).optional(), hidden: z.boolean().optional() })).max(300),
});

router.put('/sheets/:id/form-layout', ah(async (req, res) => {
  const sheetId = pid(req);
  await requireSheet(req.user!, sheetId, LV.manage);
  const { layout } = parse(z.object({ layout: layoutSchema.nullable() }), req.body);
  if (layout) {
    const cols = new Map((await loadColumns(sheetId)).map((c) => [c.column_id, c]));
    for (const f of layout.fields) if (!cols.has(f.columnId)) throw badRequest('ไม่พบคอลัมน์ที่เลือก (อาจถูกลบแล้ว)');
    // a required column left out of the form would make every new row fail
    const hidden = new Set(layout.fields.filter((f) => f.hidden).map((f) => f.columnId));
    for (const c of cols.values()) if (c.is_required && c.data_type !== 'doc_number' && hidden.has(c.column_id)) throw badRequest(`ซ่อนคอลัมน์ “${c.column_name}” ไม่ได้ เพราะเป็นคอลัมน์ที่บังคับกรอก`);
  }
  await writeSettingsKey(sheetId, 'formLayout', layout);
  ok(res, { saved: true });
}));

registerAfterSheetCopied(async ({ tx, newSheetId, columnMap }) => {
  const s = await readSettings(newSheetId, tx);
  if (!s.formLayout) return;
  await writeSettingsKey(newSheetId, 'formLayout', remapIds(s.formLayout, new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]))), tx);
});

export default { router };
