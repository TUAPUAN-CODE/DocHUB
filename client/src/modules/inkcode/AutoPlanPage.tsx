import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Checkbox, Select, TextInput } from '@/components/ui/Inputs';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { AutoPreview, AutoResult, inkcodeAutoApi } from './api';

/**
 * Drop the daily production plan (Excel): the production date picks the day file, the plant of each line picks PF1 / PF2 and the area
 * of the line picks the sheet (Pouch / Can / Cup). The code lines (40 characters × 4) fill in by themselves.
 */
export default function AutoPlanPage() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pv, setPv] = useState<AutoPreview | null>(null);
  const [date, setDate] = useState('');
  const [onlyMatched, setOnlyMatched] = useState(true);
  const [lineMap, setLineMap] = useState<Record<string, string>>({});
  const [plantMap, setPlantMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<AutoResult | null>(null);

  const reset = () => { setFile(null); setPv(null); setResult(null); setLineMap({}); setPlantMap({}); setDate(''); };

  const run = async (f: File, d: string | undefined, lm: Record<string, string>, pm: Record<string, string>) => {
    setBusy(true);
    try { const r = await inkcodeAutoApi.preview(f, { date: d, lineMap: lm, plantMap: pm }); setFile(f); setPv(r); setDate(r.date); setResult(null); }
    catch (e) { toast.error(apiError(e).message, 'อ่านแผนไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const load = (f?: File) => {
    if (!f) return;
    if (!/\.xlsx?$/i.test(f.name)) return void toast.error('ต้องเป็นไฟล์ Excel (.xlsx)');
    setLineMap({}); setPlantMap({});
    void run(f, undefined, {}, {});
  };
  // a mapping the user picked is applied by reading the plan again (the server recomputes plant / area / database match)
  const remap = (lm: Record<string, string>, pm: Record<string, string>) => { setLineMap(lm); setPlantMap(pm); if (file) void run(file, date || undefined, lm, pm); };

  const unknownLines = useMemo(() => (pv ? [...new Set(pv.items.filter((i) => pv.knownLines.length && !pv.knownLines.includes(i.line)).map((i) => i.line))] : []), [pv]);
  const noPlant = useMemo(() => (pv ? [...new Set(pv.items.filter((i) => !i.plant).map((i) => i.lineRaw))] : []), [pv]);
  const willImport = pv ? pv.items.filter((i) => i.plant && !(onlyMatched && i.inDb === false)).length : 0;
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    pv?.items.forEach((i) => { if (i.plant && !(onlyMatched && i.inDb === false)) m.set(`${i.plant} › ${i.sheet}`, (m.get(`${i.plant} › ${i.sheet}`) ?? 0) + 1); });
    return [...m.entries()].sort();
  }, [pv, onlyMatched]);

  const doImport = async () => {
    if (!file || !pv) return;
    setBusy(true);
    try { setResult(await inkcodeAutoApi.import(file, { date: date || undefined, onlyMatched, lineMap, plantMap })); }
    catch (e) { toast.error(apiError(e).message, 'นำเข้าไม่สำเร็จ'); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-6xl px-3 pb-10 sm:px-6">
      <PageHeader icon={<FileSpreadsheet className="h-6 w-6" />} title="นำเข้าแผนผลิต (อัตโนมัติ)" subtitle="วางไฟล์แผนผลิตประจำวัน — ระบบดูวันที่ โรงงาน (PF1/PF2) และพื้นที่ (Pouch/Can/Cup) และกะ (DS/NS จากเวลาผลิต) แล้วสร้างไฟล์รายวันและใส่ข้อมูลให้เอง โค้ด 40 ตัว 4 แถวสร้างให้อัตโนมัติ" />
      {!pv && (
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files?.[0]); }}
          className={cn('ds-card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed px-6 py-16 text-center text-sm text-muted hover:border-primary/50', drag && 'border-primary bg-primary/5')} onClick={() => input.current?.click()} role="button" tabIndex={0}>
          <UploadCloud className="h-10 w-10" />
          <p className="text-base font-medium text-ink">{busy ? 'กำลังอ่านไฟล์…' : 'ลากไฟล์แผนผลิตมาวางที่นี่ หรือคลิกเลือกไฟล์'}</p>
          <p>ไฟล์ Excel (.xlsx) ที่มีข้อความ “แผนผลิต … ประจำวันที่ …” และหัวคอลัมน์ Time · Product · Line · Country · Doc.No</p>
          <input ref={input} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      )}
      {pv && !result && (
        <div className="ds-card space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div><p className="mb-1 text-xs text-muted">วันที่ผลิต (จากแผน)</p><TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => file && date && date !== pv.date && void run(file, date, lineMap, plantMap)} className="!h-9" /></div>
            <p className="pb-2 text-muted">ไฟล์ {file?.name} · พบ <b className="text-ink">{pv.items.length}</b> รายการ · จะนำเข้า <b className="text-ink">{willImport}</b></p>
            <div className="ml-auto pb-2"><Checkbox checked={onlyMatched} onChange={setOnlyMatched} label="นำเข้าเฉพาะที่พบรหัสเอกสาร + ประเทศ ในฐานข้อมูล" /></div>
          </div>
          <div className="rounded-xl border border-line p-3 text-sm">
            <p className="mb-1.5 font-medium">ปลายทาง (วันที่ {pv.date})</p>
            <ul className="space-y-0.5 text-muted">
              {pv.files.map((f) => <li key={f.plant}><b className="text-ink">{f.plant}</b> · {f.folderPath} / <b className="text-ink">{f.fileName}</b> {f.exists ? '(มีไฟล์แล้ว — เพิ่มแถวต่อ)' : '(ยังไม่มี — สร้างให้ใหม่)'}</li>)}
              {groups.map(([k, n]) => <li key={k}>↳ {k}: {n} แถว</li>)}
            </ul>
          </div>
          {!!(unknownLines.length || noPlant.length) && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
              {!!unknownLines.length && <>
                <p className="mb-2 font-medium">ไลน์ที่ไม่อยู่ในตารางรหัสอ้างอิง — เลือกว่าตรงกับไลน์ไหน</p>
                <div className="mb-3 grid gap-2 md:grid-cols-2">{unknownLines.map((u) => (
                  <div key={u} className="flex items-center gap-2"><span className="w-1/2 truncate" title={u}>{u}</span>
                    <Select value={lineMap[u] ?? ''} onChange={(e) => remap({ ...lineMap, [u]: e.target.value }, plantMap)}><option value="">— เลือกไลน์ —</option>{pv.knownLines.map((l) => <option key={l} value={l}>{l}</option>)}</Select></div>))}</div>
              </>}
              {!!noPlant.length && <>
                <p className="mb-2 font-medium">ไลน์ที่ไม่ทราบโรงงาน — เลือก PF1 / PF2 (ถ้าไม่เลือก แถวนั้นจะไม่ถูกนำเข้า)</p>
                <div className="grid gap-2 md:grid-cols-2">{noPlant.map((u) => (
                  <div key={u} className="flex items-center gap-2"><span className="w-1/2 truncate" title={u}>{u}</span>
                    <Select value={plantMap[u] ?? ''} onChange={(e) => remap(lineMap, { ...plantMap, [u]: e.target.value })}><option value="">— เลือกโรงงาน —</option>{pv.plants.map((p) => <option key={p} value={p}>{p}</option>)}</Select></div>))}</div>
              </>}
            </div>
          )}
          <div className="max-h-[44vh] overflow-auto rounded-xl border border-line text-xs">
            <table className="w-full"><thead className="sticky top-0 bg-surface"><tr className="text-left">{['เวลา', 'กะ', 'ไลน์', 'โรงงาน', 'ชีต', 'Doc.No', 'ประเทศ', 'ยอด', 'ฐานข้อมูล'].map((h) => <th key={h} className="px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{pv.items.map((i, k) => (
                <tr key={k} className="border-t border-line"><td className="px-2 py-1">{i.time}</td><td className="px-2 py-1">{i.shift}</td><td className="px-2 py-1">{i.line}</td>
                  <td className={cn('px-2 py-1', !i.plant && 'text-danger')}>{i.plant ?? 'ไม่ทราบ'}</td><td className="px-2 py-1">{i.sheet}</td><td className="px-2 py-1 font-mono">{i.doc}</td><td className="px-2 py-1">{i.country}</td><td className="px-2 py-1 text-right">{i.qty?.toLocaleString() ?? ''}</td>
                  <td className={cn('px-2 py-1', i.inDb === false ? 'text-danger' : 'text-emerald-600')}>{i.inDb === null ? '—' : i.inDb ? '✓ พบ' : i.docInDb ? `ไม่พบประเทศนี้ (มี: ${i.dbMarkets.join(', ')})` : 'ไม่พบรหัสเอกสาร'}</td></tr>
              ))}</tbody></table>
          </div>
          {!!pv.warnings.length && <details className="text-xs text-muted"><summary className="cursor-pointer">คำเตือนจากการอ่านแผน ({pv.warnings.length})</summary><ul className="mt-1 list-disc pl-5">{pv.warnings.slice(0, 40).map((w) => <li key={w}>{w}</li>)}</ul></details>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={reset}>เลือกไฟล์ใหม่</Button><Button onClick={() => void doImport()} loading={busy} disabled={!willImport}>นำเข้า {willImport} แถว</Button></div>
        </div>
      )}
      {result && (
        <div className="ds-card space-y-3 p-4 text-sm">
          <p className="text-base font-semibold text-emerald-600">นำเข้าแล้ว — วันที่ {result.date}</p>
          <ul className="space-y-1.5">
            {result.targets.map((t) => (
              <li key={`${t.plant}${t.area}`} className="rounded-lg border border-line px-3 py-2">
                <b>{t.plant} › {t.area}</b>: เพิ่ม {t.result.created} · มีอยู่แล้ว {t.result.duplicate} · ไม่พบในฐานข้อมูล {t.result.skippedNotInDb}
                {t.fileId && <> · <Link className="text-primary hover:underline" to={`/files/${t.fileId}`}>เปิดไฟล์ {t.fileName}</Link>{t.fileCreated ? ' (สร้างใหม่)' : ''}</>}
                {!!t.result.failed.length && <p className="text-danger">ผิดพลาด {t.result.failed.length}: {t.result.failed.slice(0, 4).map((f) => `${f.doc} (${f.line}) ${f.reason}`).join(' · ')}</p>}
              </li>
            ))}
          </ul>
          {!!result.skippedNoPlant && <p className="text-amber-600">ข้าม {result.skippedNoPlant} แถว เพราะไม่ทราบโรงงาน</p>}
          <Button onClick={reset}>นำเข้าไฟล์อื่น</Button>
        </div>
      )}
    </div>
  );
}
