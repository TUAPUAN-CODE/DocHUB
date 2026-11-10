import { useCallback, useEffect, useRef, useState } from 'react';
import { Boxes, Pencil, Plus, Trash2 } from 'lucide-react';
import { cellsApi, LinesCfg, rowsApi, SheetSettings, sheetsApi } from '@/api/endpoints';
import { confirmDialog } from '@/store/ui';
import type { CellValue, UsersDict } from '@/types';
import { RowFormModal } from '@/components/sheet/SheetModals';
import { loadCols } from '@/lib/dashCols';
import { toast } from '@/store/ui';
import type { Column, Row } from '@/types';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { CellDisplay } from '@/components/sheet/CellView';
import { linesApi } from '../scan/api';
import { beep } from '../scan/beep';
import { CameraBox } from '../scan/CameraScanner';

/**
 * The line items of one row. entry "scan" (materials on a trolley): scan to add, remove, one action on all of them.
 * entry "form" (the lines of a document): + เพิ่มรายการ opens the line sheet's form, starting with the header's values for
 * columns of the same name (machine, date…, so the line's drop-downs can follow them); tap a line to edit it.
 */
export function LinesDialog({ open, onClose, sheetId, headerRow, headerLabel, cfg, canWrite, onDone, headerColumns = [] }: {
  open: boolean; onClose: () => void; sheetId: string; headerRow: Row | null; headerLabel: string; cfg: LinesCfg; canWrite: boolean; onDone: () => void;
  headerColumns?: Column[];
}) {
  const formMode = cfg.entry === 'form';
  const [cols, setCols] = useState<Column[]>([]);
  const [lines, setLines] = useState<Row[]>([]);
  const [users, setUsers] = useState<UsersDict>({});
  const [lineSettings, setLineSettings] = useState<SheetSettings | undefined>();
  const [form, setForm] = useState<{ row: Row | null } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const shown = cols.filter((c) => (cfg.displayColumnIds?.length ? cfg.displayColumnIds.includes(c.id) : true)).slice(0, 12);

  const load = useCallback(async () => {
    if (!headerRow) return;
    try { const r = await linesApi.list(sheetId, headerRow.id); setLines(r.lines); setUsers((r as { users?: UsersDict }).users ?? {}); } catch (e) { setErr(msg(e)); }
  }, [sheetId, headerRow]);
  useEffect(() => {
    if (!open) return;
    setErr(''); setText('');
    void loadCols(cfg.lineSheetId).then((c) => setCols(c.filter((x) => !x.isDeleted)));
    if (formMode) void sheetsApi.get(cfg.lineSheetId).then((d) => setLineSettings(d.settings ?? undefined)).catch(() => setLineSettings(undefined));
    void load();
    requestAnimationFrame(() => input.current?.focus());
  }, [open, load, cfg.lineSheetId, formMode]);

  /** a new line starts with the header's values for the columns that have the same name */
  const initial = (): Record<string, CellValue> => {
    const out: Record<string, CellValue> = {};
    if (!headerRow) return out;
    const byName = new Map(headerColumns.map((c) => [c.name.trim().toLowerCase(), c]));
    for (const c of cols) {
      const h = byName.get(c.name.trim().toLowerCase());
      const v = h ? headerRow.values[h.id] : undefined;
      if (v !== undefined && v !== null && v !== '') out[c.id] = v;
    }
    return out;
  };
  const createLine = async (values: Record<string, CellValue>) => {
    if (!headerRow) return;
    const r = await rowsApi.create(cfg.lineSheetId, values);
    await linesApi.add(sheetId, headerRow.id, { lineRowId: r.row.id });
    await load(); onDone();
  };
  const saveLine = async (row: Row, changes: { columnId: string; value: CellValue }[]) => {
    await cellsApi.bulk(cfg.lineSheetId, changes.map((c) => ({ rowId: row.id, columnId: c.columnId, value: c.value })), true);
    await load(); onDone();
  };
  const deleteLine = async (row: Row) => {
    if (!(await confirmDialog({ title: `ลบรายการ #${row.order}?`, message: 'กู้คืนได้จาก "แถวที่ถูกลบ" ของชีตรายการ', danger: true, confirmText: 'ลบรายการ' }))) return;
    await run(async () => { await linesApi.remove(sheetId, headerRow!.id, row.id); await rowsApi.removeMany(cfg.lineSheetId, [row.id]); }, 'ลบรายการแล้ว');
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setErr('');
    try { await fn(); if (ok) toast.success(ok); beep(true); await load(); onDone(); } catch (e) { beep(false); setErr(msg(e)); } finally { setBusy(false); requestAnimationFrame(() => input.current?.focus()); }
  };
  const add = (fromCamera?: string) => { const t = (fromCamera ?? text).trim(); if (!t || !headerRow || busy) return; setText(''); void run(() => linesApi.add(sheetId, headerRow.id, { text: t })); };

  return (
    <>
    <Modal open={open && !form} onClose={onClose} size="xl" icon={<Boxes className="h-5 w-5" />} title={`รายการใน ${headerLabel || `แถว #${headerRow?.order ?? ''}`}`} description={`${lines.length} รายการ`}>
      <div className="space-y-3">
        {canWrite && formMode && (
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ row: null })} disabled={!cols.length}>เพิ่มรายการ</Button>
        )}
        {canWrite && !formMode && (
          <div className="flex flex-wrap items-center gap-2">
            <TextInput ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} placeholder="สแกน QR ของรายการที่จะเพิ่ม แล้วกด Enter" className="!h-9 min-w-[16rem] flex-1 font-mono" disabled={busy} autoComplete="off" />
            {(cfg.actions ?? []).map((a, i) => (
              <Button key={i} size="sm" variant="secondary" disabled={busy || !lines.length || !a.columnId} onClick={() => void run(async () => { const r = await linesApi.action(sheetId, headerRow!.id, i); toast.success(`${a.label || 'ทำรายการ'}: ${r.count} รายการ`); })}>{a.label || `ปุ่ม ${i + 1}`}</Button>
            ))}
          </div>
        )}
        {canWrite && !formMode && <CameraBox onText={(t) => add(t)} busy={busy} />}
        {err && <p className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-sm text-danger">{err}</p>}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-sm">
            <thead><tr className="bg-ink/5 text-left text-xs text-muted"><th className="px-3 py-1.5">#</th>{shown.map((c) => <th key={c.id} className="px-3 py-1.5">{c.name}</th>)}<th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className={`border-t border-line ${formMode && canWrite ? 'cursor-pointer hover:bg-primary/[.04]' : ''}`} onClick={formMode && canWrite ? () => setForm({ row: l }) : undefined}>
                  <td className="px-3 py-1.5 text-muted">{l.order}</td>
                  {shown.map((c) => <td key={c.id} className="whitespace-nowrap px-3 py-1.5"><CellDisplay col={c} value={l.values[c.id]} /></td>)}
                  <td className="whitespace-nowrap px-2 text-right">
                    {canWrite && formMode && <button type="button" title="แก้ไขรายการ" onClick={(e) => { e.stopPropagation(); setForm({ row: l }); }} className="mr-2 text-muted hover:text-primary"><Pencil className="h-4 w-4" /></button>}
                    {canWrite && <button type="button" title={formMode ? 'ลบรายการ' : 'เอารายการออกจากแถวนี้'} onClick={(e) => { e.stopPropagation(); if (formMode) void deleteLine(l); else void run(() => linesApi.remove(sheetId, headerRow!.id, l.id)); }} className="text-muted hover:text-danger"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
              {!lines.length && <tr><td colSpan={shown.length + 2} className="p-6 text-center text-muted">ยังไม่มีรายการ{canWrite ? (formMode ? ' — กด “เพิ่มรายการ”' : ' — สแกน QR เพื่อเพิ่ม') : ''}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
    {formMode && (
      <RowFormModal open={!!form} onClose={() => setForm(null)} columns={cols} row={form?.row ?? null} users={users} canWrite={canWrite}
        initial={form && !form.row ? initial() : undefined} title={form?.row ? `แก้ไขรายการ #${form.row.order}` : 'เพิ่มรายการ'}
        onCreate={createLine} onSave={(changes) => saveLine(form!.row!, changes)}
        sheetId={cfg.lineSheetId} settings={lineSettings} canManage={false} onLayoutSaved={() => undefined} />
    )}
    </>
  );
}
const msg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } }; message?: string }).response?.data?.error?.message ?? (e as Error).message;
