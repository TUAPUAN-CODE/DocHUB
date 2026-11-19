import { useEffect, useMemo, useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/ui';
import { loadFontB64 } from '@/lib/pdf/fonts';
import { DelayLine, sortLines } from './lines';

const p2 = (n: number) => String(n).padStart(2, '0');
const thaiDate = (ymd: string) => { if (!ymd) return ''; const [y, m, d] = ymd.split('-'); return `${d}/${m}/${Number(y) + 543}`; };

/**
 * Export of the Delay report like DelayHUB's "ดำเนินการเสร็จสิ้น" page: PDF F3PFPF67 or Excel F3PFPV04 of the rows the sheet shows now
 * (its filters / search; the selected rows only when some are selected). `loadLines` reads them when the dialog is confirmed.
 */
export function DelayExportDialog({ open, kind, user, loadLines, onClose }: {
  open: boolean; kind: 'pdf' | 'excel'; user: string; loadLines: () => Promise<DelayLine[]>; onClose: () => void;
}) {
  const [lines, setLines] = useState<DelayLine[] | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLines(null);
    void loadLines().then((ls) => {
      setLines(ls);
      // Date = the day every row was packed on (the factory day of the sheet), else today
      const days = [...new Set(ls.map((l) => l.work_day).filter(Boolean))];
      const d = new Date();
      setF({ date: days.length === 1 ? String(days[0]).slice(0, 10) : `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, shift: '', sortBy: 'time', line: '', plant: '', recordedBy: user, reviewedBy: '', qcManager: '' });
    }).catch((e) => { toast.error(e); onClose(); });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineNames = useMemo(() => [...new Set((lines ?? []).map((l) => l.line).filter(Boolean) as string[])].sort(), [lines]);
  const chosen = useMemo(() => sortLines((lines ?? []).filter((l) => (!f.line || l.line === f.line) && (!f.shift || !l.shift || l.shift === f.shift)), f.sortBy === 'code' ? 'code' : 'time'), [lines, f.line, f.shift, f.sortBy]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((v) => ({ ...v, [k]: e.target.value }));

  const run = async () => {
    if (!chosen.length) { toast.error('ไม่มีแถวที่จะออกรายงาน'); return; }
    const meta = { exportDate: thaiDate(f.date), exportShift: f.shift, exportLine: f.line || lineNames.join(', '), exportPlant: f.plant };
    const sig = { recordedBy: f.recordedBy, reviewedBy: f.reviewedBy, qcManager: f.qcManager };
    setBusy(true);
    try {
      if (kind === 'excel') {
        const { exportDelayReportExcel } = await import('./excel');
        await exportDelayReportExcel(chosen, { ...meta, ...sig });
        toast.success(`ส่งออก Excel ${chosen.length.toLocaleString()} แถว`);
      } else {
        const [{ buildDelayReportPdf }, regular, bold] = await Promise.all([import('./pdf'), loadFontB64('Sarabun-Regular.ttf'), loadFontB64('Sarabun-Bold.ttf')]);
        const doc = buildDelayReportPdf(chosen, sig, meta, { regular, bold });
        doc.save(`F3PFPF67_${f.date || new Date().toISOString().slice(0, 10)}.pdf`);
        toast.success(`ส่งออก PDF ${chosen.length.toLocaleString()} แถว`);
      }
      onClose();
    } catch (e) {
      console.error('Delay report export error:', e);
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const excel = kind === 'excel';
  return (
    <Modal open={open} onClose={onClose} size="md" icon={excel ? <FileSpreadsheet className="h-5 w-5" /> : <FileDown className="h-5 w-5" />}
      title={excel ? 'Export รายงาน Delay (Excel F3PFPV04)' : 'Export รายงาน Delay (PDF F3PFPF67)'}
      description="แบบเดียวกับหน้าดำเนินการเสร็จสิ้นของ DelayHUB — ใช้แถวที่ตารางแสดงอยู่ (ตามตัวกรอง / แถวที่เลือก)"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>ปิด</Button>
        <Button icon={excel ? <FileSpreadsheet className="h-4 w-4" /> : <FileDown className="h-4 w-4" />} onClick={() => void run()} loading={busy} disabled={!lines}>{excel ? 'ดาวน์โหลด Excel' : 'ดาวน์โหลด PDF'}</Button></>}>
      {!lines ? <p className="py-6 text-center text-sm text-muted">กำลังอ่านแถว…</p> : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date"><TextInput type="date" value={f.date ?? ''} onChange={set('date')} /></Field>
            <Field label="Shift (กรองแถวตามกะ)"><Select value={f.shift ?? ''} onChange={set('shift')}>{['', 'DS', 'NS'].map((s) => <option key={s} value={s}>{s || 'ทุกกะ'}</option>)}</Select></Field>
            <Field label="Line (กรองแถวตามไลน์)"><Select value={f.line ?? ''} onChange={set('line')}><option value="">ทุกไลน์</option>{lineNames.map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
            <Field label="Plant"><TextInput value={f.plant ?? ''} onChange={set('plant')} /></Field>
            <Field label="เรียงตาม"><Select value={f.sortBy ?? 'time'} onChange={set('sortBy')}><option value="time">เวลาบรรจุเสร็จ</option><option value="code">Code</option></Select></Field>
            <Field label="Recorded by"><TextInput value={f.recordedBy ?? ''} onChange={set('recordedBy')} /></Field>
            <Field label="Reviewed by"><TextInput value={f.reviewedBy ?? ''} onChange={set('reviewedBy')} /></Field>
            <Field label="QC Section manager"><TextInput value={f.qcManager ?? ''} onChange={set('qcManager')} /></Field>
          </div>
          <p className="text-sm text-muted">
            จะออกรายงาน {chosen.length.toLocaleString()} แถว{f.line ? ` ไลน์ ${f.line}` : ''}{f.shift ? ` กะ ${f.shift}` : ''} เรียงตาม{f.sortBy === 'code' ? ' Code' : 'เวลาบรรจุเสร็จ'} · 17 แถวต่อหน้า{excel ? ' เกินแล้วขึ้นชีตใหม่' : ''}
          </p>
        </div>
      )}
    </Modal>
  );
}
