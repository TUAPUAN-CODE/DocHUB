import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { UploadCloud } from 'lucide-react';
import { apiError } from '@/api/client';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { AutoResult, inkcodeAutoApi } from './api';

/** Shown in the plan folders (InkCode - ใบออกโค้ด / แผนผลิต / ปี / เดือน): drop the plan .xlsx here and it is imported by itself */
export function PlanDropZone({ folderId, onDone }: { folderId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; r: AutoResult } | null>(null);

  const send = async (files: FileList | File[] | null | undefined) => {
    const list = Array.from(files ?? []).filter((f) => /\.xlsx?$/i.test(f.name));
    if (!list.length) return void toast.error('ต้องเป็นไฟล์ Excel (.xlsx)');
    setBusy(true);
    for (const f of list) {
      try { const r = await inkcodeAutoApi.drop(f, folderId); setDone({ name: f.name, r }); toast.success(`นำเข้าแผนวันที่ ${r.date} แล้ว`, f.name); }
      catch (e) { toast.error(apiError(e).message, `นำเข้า ${f.name} ไม่สำเร็จ`); }
    }
    setBusy(false); onDone();
  };
  const created = done?.r.targets.reduce((s, t) => s + t.result.created, 0) ?? 0;
  const skipped = done ? (done.r.items ?? []).filter((i) => i.status.startsWith('ข้าม')).length : 0;

  return (
    <div className="mb-4">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); void send(e.dataTransfer.files); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        className={cn('flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-line px-5 py-5 text-sm text-muted hover:border-primary/50', drag && 'border-primary bg-primary/5')}>
        <UploadCloud className="h-8 w-8 shrink-0 text-primary" />
        <div>
          <p className="text-base font-medium text-ink">{busy ? 'กำลังนำเข้าแผน…' : 'วางไฟล์แผนผลิต (.xlsx) ที่นี่ หรือคลิกเลือกไฟล์'}</p>
          <p>ระบบดูวันที่ผลิต โรงงาน (PF1/PF2) พื้นที่ (Pouch/Can/Cup) และกะ (DS/NS จากเวลาผลิต) แล้วสร้างไฟล์รายวันและโค้ด 40 ตัว 4 แถวให้อัตโนมัติ</p>
        </div>
        <input ref={input} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(e) => { void send(e.target.files); e.target.value = ''; }} />
      </div>
      {done && (
        <div className="mt-2 rounded-xl border border-line p-3 text-sm">
          <p className="font-medium text-emerald-600">{done.name} → วันที่ {done.r.date}: เพิ่ม {created} แถว{skipped ? ` · ข้าม ${skipped} (ไม่ทราบโรงงาน/ไม่พบในฐานข้อมูล)` : ''}</p>
          <ul className="mt-1 space-y-0.5 text-muted">
            {done.r.targets.map((t) => <li key={`${t.plant}${t.area}`}>{t.plant} › {t.area}: เพิ่ม {t.result.created} · มีอยู่แล้ว {t.result.duplicate}{t.fileId && <> · <Link className="text-primary hover:underline" to={`/files/${t.fileId}`}>เปิดไฟล์ {t.fileName}</Link></>}</li>)}
          </ul>
          {done.r.recordFileId && <p className="mt-1 text-muted">บันทึกผลทุกแถว: <Link className="text-primary hover:underline" to={`/files/${done.r.recordFileId}`}>เปิดไฟล์บันทึก</Link> (ในโฟลเดอร์นี้) · ถ้ามีแถวที่ถูกข้ามเพราะไม่ทราบโรงงาน ใช้เมนู <Link className="text-primary hover:underline" to="/inkcode/plan">นำเข้าแผนผลิต</Link> เพื่อเลือกเอง</p>}
        </div>
      )}
    </div>
  );
}
