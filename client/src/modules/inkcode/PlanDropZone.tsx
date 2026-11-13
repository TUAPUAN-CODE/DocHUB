import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, LogIn, UploadCloud } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { connectorsApi } from '@/modules/connectors/api';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { AutoResult, inkcodeAutoApi } from './api';

const urlOf = (dt: DataTransfer | null): string | null => {
  if (!dt) return null;
  const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/).map((x) => x.trim()).find((x) => /^https:\/\//i.test(x));
  return raw ?? null;
};

/**
 * Shown in the plan folders (InkCode - ใบออกโค้ด / แผนผลิต / ปี / เดือน): the plan .xlsx is imported by itself when it is
 *  - dropped here or chosen from the computer,
 *  - pasted (Ctrl+V of a file or of a link),
 *  - given as a link (OneDrive / SharePoint / Google Drive / Dropbox) — for computers that only have Excel on the web.
 * Dragging a file out of OneDrive on the web gives the browser only a link, not the file: the link is used.
 */
export function PlanDropZone({ folderId, onDone }: { folderId: string; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [needMs, setNeedMs] = useState<{ url: string; connectorId: string; configured: boolean; message: string } | null>(null);
  const [done, setDone] = useState<{ name: string; r: AutoResult } | null>(null);

  const finish = (name: string, r: AutoResult) => { setDone({ name, r }); toast.success(`นำเข้าแผนวันที่ ${r.date} แล้ว`, name); };
  const sendFiles = async (files: FileList | File[] | null | undefined) => {
    const list = Array.from(files ?? []).filter((f) => /\.xlsx?$/i.test(f.name));
    if (!list.length) return void toast.error('ต้องเป็นไฟล์ Excel (.xlsx)', 'ถ้าลากมาจาก OneDrive บนเว็บ ให้คัดลอกลิงก์ของไฟล์แล้ววางในช่อง “วางลิงก์” ด้านล่าง');
    setBusy(true);
    for (const f of list) { try { finish(f.name, await inkcodeAutoApi.drop(f, folderId)); } catch (e) { toast.error(apiError(e).message, `นำเข้า ${f.name} ไม่สำเร็จ`); } }
    setBusy(false); onDone();
  };
  const sendLink = async (url: string) => {
    setBusy(true); setNeedMs(null);
    try {
      const r = await inkcodeAutoApi.dropUrl(url, folderId);
      if ('needsMicrosoft' in r) setNeedMs({ url, ...r.needsMicrosoft });
      else { finish(url.length > 60 ? `${url.slice(0, 57)}…` : url, r); setLink(''); onDone(); }
    } catch (e) { toast.error(apiError(e).message, 'นำเข้าจากลิงก์ไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const handle = (dt: DataTransfer | null) => {
    if (dt?.files?.length) return void sendFiles(dt.files);
    const u = urlOf(dt);
    if (u) return void sendLink(u);
    toast.error('ไม่พบไฟล์หรือลิงก์ในสิ่งที่วาง', 'ใน OneDrive บนเว็บ: คลิกขวาที่ไฟล์ › แชร์/คัดลอกลิงก์ แล้ววางลิงก์ในช่องด้านล่าง');
  };

  // after the Microsoft sign-in popup closes, try the same link again
  useEffect(() => {
    if (!needMs) return;
    const h = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'ms-connector') { if (e.data.ok) { toast.success('เข้าสู่ระบบ Microsoft แล้ว'); void sendLink(needMs.url); } else toast.error('เข้าสู่ระบบ Microsoft ไม่สำเร็จ'); } };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, [needMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const signIn = async () => {
    if (!needMs) return;
    try { const { url } = await connectorsApi.msStart(needMs.connectorId); if (!window.open(url, 'ms-login', 'width=520,height=680')) toast.error('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป — อนุญาตป๊อปอัปแล้วลองใหม่'); }
    catch (e) { toast.error(apiError(e).message); }
  };

  const created = done?.r.targets.reduce((s, t) => s + t.result.created, 0) ?? 0;
  const skipped = done ? (done.r.items ?? []).filter((i) => i.status.startsWith('ข้าม')).length : 0;

  return (
    <div className="mb-4 space-y-2">
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer); }}
        onPaste={(e) => { if (document.activeElement?.tagName === 'INPUT') return; e.preventDefault(); handle(e.clipboardData); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        className={cn('flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-line px-5 py-5 text-sm text-muted hover:border-primary/50', drag && 'border-primary bg-primary/5')}>
        <UploadCloud className="h-8 w-8 shrink-0 text-primary" />
        <div>
          <p className="text-base font-medium text-ink">{busy ? 'กำลังนำเข้าแผน…' : 'วางไฟล์แผนผลิต (.xlsx) ที่นี่ · คลิกเลือกไฟล์ · หรือ Ctrl+V'}</p>
          <p>ระบบดูวันที่ผลิต โรงงาน (PF1/PF2) พื้นที่ (Pouch/Can/Cup) และกะ (DS/NS จากเวลาผลิต) แล้วสร้างไฟล์รายวันและโค้ด 40 ตัว 4 แถวให้อัตโนมัติ</p>
        </div>
        <input ref={input} type="file" multiple accept=".xlsx,.xls" className="hidden" onChange={(e) => { void sendFiles(e.target.files); e.target.value = ''; }} />
      </div>

      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (link.trim()) void sendLink(link.trim()); }}>
        <Link2 className="h-4 w-4 text-muted" />
        <TextInput value={link} onChange={(e) => setLink(e.target.value)} placeholder="หรือวางลิงก์ไฟล์ OneDrive / SharePoint / Google Drive / Dropbox (Excel บนเว็บ) แล้วกด Enter" className="min-w-[16rem] flex-1" />
        <Button type="submit" size="sm" loading={busy} disabled={!link.trim()}>นำเข้าจากลิงก์</Button>
      </form>
      <p className="text-xs text-muted">ลิงก์ที่ตั้งเป็น “ทุกคนที่มีลิงก์” นำเข้าได้ทันที · ลิงก์ที่ต้องล็อกอิน OneDrive/SharePoint ของบริษัท ระบบจะให้เข้าสู่ระบบ Microsoft ครั้งเดียว · การลากไฟล์จาก OneDrive บนเว็บ เบราว์เซอร์จะส่งมาแค่ลิงก์ ระบบรับให้ได้</p>

      {needMs && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-500/10">
          <p className="font-medium">ลิงก์นี้ต้องเข้าสู่ระบบ Microsoft</p>
          <p className="mt-0.5 text-muted">{needMs.configured ? needMs.message : 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Microsoft (MS_CLIENT_ID / MS_CLIENT_SECRET — ดู docs/CONNECTORS.md) — ให้ตั้ง “ทุกคนที่มีลิงก์” หรือดาวน์โหลดไฟล์แล้ววาง'}</p>
          {needMs.configured && <Button className="mt-2" size="sm" icon={<LogIn className="h-4 w-4" />} onClick={() => void signIn()}>เข้าสู่ระบบด้วย Microsoft</Button>}
        </div>
      )}
      {done && (
        <div className="rounded-xl border border-line p-3 text-sm">
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
