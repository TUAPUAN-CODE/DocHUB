import { useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Checkbox, Select, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { inkcodeApi, PlanImportResult, PlanPreview } from './api';

/** Drop the daily production plan (Excel) → preview → rows are added to the worksheet; the 4 code lines then fill in by themselves */
export function PlanImportDialog({ open, onClose, sheetId, onDone }: { open: boolean; onClose: () => void; sheetId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<PlanPreview | null>(null);
  const [date, setDate] = useState('');
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<PlanImportResult | null>(null);

  const reset = () => { setFile(null); setPv(null); setResult(null); setLineMap({}); setDate(''); };
  const close = () => { reset(); onClose(); };

  const load = async (f?: File) => {
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) return toast.error('ต้องเป็นไฟล์ Excel (.xlsx)');
    setBusy(true); setResult(null);
    try { const r = await inkcodeApi.previewPlan(f, sheetId); setFile(f); setPv(r); setDate(r.date ?? ''); setLineMap({}); }
    catch (e) { toast.error(apiError(e).message, 'อ่านแผนไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const unknownLines = useMemo(() => (pv ? [...new Set(pv.items.filter((i) => pv.knownLines.length && !pv.knownLines.includes(lineMap[i.line] ?? i.line)).map((i) => i.line))] : []), [pv, lineMap]);
  const items = useMemo(() => (pv ? pv.items.map((i) => ({ ...i, line: lineMap[i.line] ?? i.line })) : []), [pv, lineMap]);
  const matched = items.filter((i) => i.inDb !== false).length;

  const run = async () => {
    if (!file || !pv) return;
    if (!date) return toast.error('ระบุวันที่ผลิต');
    setBusy(true);
    try { const r = await inkcodeApi.importPlan(file, sheetId, { date, onlyMatched, lineMap }); setResult(r); onDone(); }
    catch (e) { toast.error(apiError(e).message, 'นำเข้าไม่สำเร็จ'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={close} size="xl" icon={<FileSpreadsheet className="h-5 w-5" />} title="นำเข้าแผนผลิตประจำวัน (Excel)" description="ระบบอ่านไลน์ / ประเทศ / Doc.No / เวลา จากแผน แล้วเพิ่มแถวใน Worksheet — โค้ด 4 แถวและรายละเอียดคำนวณให้เอง"
      footer={result ? <Button onClick={close}>เสร็จสิ้น</Button> : <><Button variant="secondary" onClick={close}>ยกเลิก</Button><Button onClick={() => void run()} loading={busy} disabled={!pv || !items.length}>นำเข้า {pv ? `(${onlyMatched ? matched : items.length} แถว)` : ''}</Button></>}>
      {!pv && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void load(e.dataTransfer.files?.[0]); }}
          className={cn('flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-6 py-14 text-center text-sm text-muted hover:border-primary/50', drag && 'border-primary bg-primary/5')} onClick={() => input.current?.click()} role="button" tabIndex={0}>
          <UploadCloud className="h-9 w-9" />
          <p className="text-base font-medium text-ink">{busy ? 'กำลังอ่านไฟล์…' : 'ลากไฟล์แผนผลิตมาวางที่นี่ หรือคลิกเลือกไฟล์'}</p>
          <p>ไฟล์ Excel ที่มีหัวคอลัมน์ Time · Product · Line · Country · Doc.No และมีข้อความ “แผนผลิต … ประจำวันที่ …”</p>
          <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
      {pv && !result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div><p className="mb-1 text-xs text-muted">วันที่ผลิต (จากแผน)</p><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} className="!h-9" /></div>
            <p className="pb-2 text-muted">ไฟล์ {file?.name} · ชีต {pv.sheetName} · พบ <b className="text-ink">{items.length}</b> รายการ · ตรงฐานข้อมูล <b className="text-ink">{matched}</b></p>
            <div className="ml-auto pb-2"><Checkbox checked={onlyMatched} onChange={setOnlyMatched} label="นำเข้าเฉพาะที่พบรหัสเอกสาร + ประเทศ ในฐานข้อมูล" /></div>
          </div>
          {!!unknownLines.length && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
              <p className="mb-2 font-medium">ไลน์ที่ไม่อยู่ในตารางรหัสอ้างอิง — เลือกว่าตรงกับไลน์ไหน (ถ้าไม่เลือก แถวนั้นจะนำเข้าไม่ได้)</p>
              <div className="grid gap-2 md:grid-cols-2">
                {unknownLines.map((u) => (
                  <div key={u} className="flex items-center gap-2"><span className="w-1/2 truncate" title={u}>{u}</span>
                    <Select value={lineMap[u] ?? ''} onChange={(e) => setLineMap((m) => ({ ...m, [u]: e.target.value }))}><option value="">— เลือกไลน์ —</option>{pv.knownLines.map((l) => <option key={l} value={l}>{l}</option>)}</Select></div>
                ))}
              </div>
            </div>
          )}
          <div className="max-h-[46vh] overflow-auto rounded-xl border border-line text-xs">
            <table className="w-full"><thead className="sticky top-0 bg-surface"><tr className="text-left">{['เวลา', 'กะ', 'ไลน์', 'Doc.No', 'ประเทศ', 'ลูกค้า', 'ยอด', 'ฐานข้อมูล'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{items.map((i, k) => (
                <tr key={k} className="border-t border-line"><td className="px-2 py-1">{i.time}</td><td className="px-2 py-1">{i.shift}</td><td className="px-2 py-1">{i.line}</td><td className="px-2 py-1 font-mono">{i.doc}</td><td className="px-2 py-1">{i.country}</td><td className="max-w-[10rem] truncate px-2 py-1">{i.customer}</td><td className="px-2 py-1 text-right">{i.qty?.toLocaleString() ?? ''}</td>
                  <td className={cn('px-2 py-1', i.inDb === false ? 'text-danger' : 'text-emerald-600')}>{i.inDb === null ? '—' : i.inDb ? '✓ พบ' : i.docInDb ? `ไม่พบประเทศนี้ (มี: ${i.dbMarkets.join(', ')})` : 'ไม่พบรหัสเอกสาร'}</td></tr>
              ))}</tbody></table>
          </div>
          {!!pv.warnings.length && <details className="text-xs text-muted"><summary className="cursor-pointer">คำเตือนจากการอ่านแผน ({pv.warnings.length})</summary><ul className="mt-1 list-disc pl-5">{pv.warnings.slice(0, 40).map((w) => <li key={w}>{w}</li>)}</ul></details>}
          <p className="text-xs text-muted">กะคำนวณจากเวลาเริ่ม (06:00–18:59 = DS ที่เหลือ = NS) แก้ได้ใน Worksheet · แถวที่มีอยู่แล้ว (วันที่ ไลน์ เอกสาร ประเทศ เวลาเดียวกัน) จะไม่เพิ่มซ้ำ</p>
        </div>
      )}
      {result && (
        <div className="space-y-2 text-sm">
          <p className="text-base font-semibold text-emerald-600">นำเข้าแล้ว {result.created} แถว (วันที่ {result.date})</p>
          <ul className="list-disc pl-5 text-muted"><li>มีอยู่แล้ว ข้าม {result.duplicate} แถว</li><li>ไม่พบในฐานข้อมูล ข้าม {result.skippedNotInDb} แถว</li>{!!result.failed.length && <li className="text-danger">นำเข้าไม่ได้ {result.failed.length} แถว: {result.failed.slice(0, 5).map((f) => `${f.doc} (${f.line}): ${f.reason}`).join(' · ')}</li>}</ul>
        </div>
      )}
    </Modal>
  );
}
