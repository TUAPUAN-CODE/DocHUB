import { useEffect, useState } from 'react';
import { CornerLeftUp, Search } from 'lucide-react';
import { rowsApi } from '@/api/endpoints';
import { useDebounce } from '@/hooks';
import { loadCols } from '@/lib/dashCols';
import { displayValue } from '@/lib/format';
import { toast } from '@/store/ui';
import type { Column, Row } from '@/types';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { linesApi } from '@/modules/scan/api';

/**
 * A line typed straight into the line sheet (not through the header's "รายการ" window) belongs to no document: pick its header row here.
 * The header rows are listed newest first with their first columns (e.g. เลขที่ใบตรวจ · วันที่ · กะ · เครื่อง).
 */
export function LinkHeaderDialog({ line, header, onClose, onLinked, open, onPick }: {
  line: Row | null; header: { sheetId: string; sheetName: string }; onClose: () => void; onLinked: () => void;
  /** pick mode (the blank row of the line sheet): no line yet — just hand back the chosen document */
  open?: boolean; onPick?: (row: Row, label: string, cols: Column[]) => void;
}) {
  const shown = !!line || !!open;
  const [cols, setCols] = useState<Column[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 300);
  const [busy, setBusy] = useState<string | null>(null);
  const [allCols, setAllCols] = useState<Column[]>([]);
  useEffect(() => { if (shown) void loadCols(header.sheetId).then((c) => { const live = c.filter((x) => !x.isDeleted); setAllCols(live); setCols(live.slice(0, 4)); }).catch(() => setCols([])); }, [shown, header.sheetId]);
  useEffect(() => {
    if (!shown) return;
    let live = true;
    setRows(null);
    const body = { pageSize: 50, search: dq || undefined, sorts: [], filters: [] };
    (async () => {
      const first = await rowsApi.query(header.sheetId, { ...body, page: 1 });
      const last = Math.max(1, Math.ceil(first.total / 50));
      // newest documents first: the last page, read backwards
      const page = last > 1 ? await rowsApi.query(header.sheetId, { ...body, page: last }) : first;
      const prev = last > 1 && page.rows.length < 20 ? await rowsApi.query(header.sheetId, { ...body, page: last - 1 }) : null;
      if (live) setRows([...(prev?.rows ?? []), ...page.rows].reverse());
    })().catch(() => live && setRows([]));
    return () => { live = false; };
  }, [shown, header.sheetId, dq]);
  const pick = async (h: Row) => {
    if (onPick) { onPick(h, cols.slice(0, 1).map((c) => displayValue(c, h.values[c.id] ?? null)).join('') || `แถว ${h.order}`, allCols); onClose(); return; }
    if (!line) return;
    setBusy(h.id);
    try {
      await linesApi.add(header.sheetId, h.id, { lineRowId: line.id });
      toast.success('ผูกรายการกับใบแล้ว');
      onLinked(); onClose();
    } catch (e) { toast.error(e, 'ผูกรายการไม่สำเร็จ'); } finally { setBusy(null); }
  };
  return (
    <Modal open={shown} onClose={onClose} size="md" icon={<CornerLeftUp className="h-5 w-5" />} title={`รายการนี้เป็นของใบไหน (${header.sheetName})`}
      description="เลือกแถวของหัวเอกสาร — รายการจะขึ้นในหน้าต่างรายการของใบนั้นและใน PDF ของใบนั้น"
      footer={<Button variant="secondary" onClick={onClose}>ยกเลิก</Button>}>
      <TextInput icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา เลขที่ใบ / วันที่ / เครื่อง …" autoFocus />
      <div className="mt-3 max-h-[50vh] space-y-1.5 overflow-y-auto">
        {rows === null && <p className="py-6 text-center text-sm text-muted">กำลังโหลด…</p>}
        {rows?.length === 0 && <p className="py-6 text-center text-sm text-muted">ไม่พบหัวเอกสาร</p>}
        {rows?.map((r) => (
          <button key={r.id} disabled={!!busy} onClick={() => void pick(r)}
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50">
            {cols.map((c, i) => <span key={c.id} className={i === 0 ? 'font-semibold text-primary' : 'text-ink/80'}>{displayValue(c, r.values[c.id] ?? null) || '—'}</span>)}
            {busy === r.id && <span className="ml-auto text-xs text-muted">กำลังบันทึก…</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
