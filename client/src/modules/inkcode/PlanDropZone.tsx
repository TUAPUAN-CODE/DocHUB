import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, LogIn, UploadCloud } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { connectorsApi } from '@/modules/connectors/api';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { AutoResult, inkcodeAutoApi, PlanAlert } from './api';

const urlOf = (dt: DataTransfer | null): string | null => {
  if (!dt) return null;
  const raw = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').split(/\r?\n/).map((x) => x.trim()).find((x) => /^https:\/\//i.test(x));
  return raw ?? null;
};

/**
 * Shown in the plan folders (แผนผลิต / ปี / เดือน, anywhere under InkCode): the plan .xlsx is imported by itself when it is
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
          {done.r.recordFileId && <p className="mt-1 text-muted">บันทึกผลทุกแถว: <Link className="text-primary hover:underline" to={`/files/${done.r.recordFileId}`}>เปิดไฟล์บันทึก</Link> (ในโฟลเดอร์นี้) · ถ้ามีแถวที่ถูกข้ามเพราะไม่ทราบโรงงาน ใช้แอป <Link className="text-primary hover:underline" to="/inkcode/plan">แผนผลิต</Link> (หน้า Application) เพื่อเลือกเอง</p>}
          {done.r.qhMail && <QhMailLine r={done.r.qhMail} />}
          {done.r.newsPostId && <p className="mt-1 font-medium text-primary">โพสต์ข่าว New Code ตรวจ 100% แล้ว: <Link className="hover:underline" to={`/news?post=${done.r.newsPostId}`}>เปิดข่าว</Link></p>}
          {!!done.r.alerts?.length && <AlertList alerts={done.r.alerts} />}
        </div>
      )}
    </div>
  );
}

/** Copies a table so it pastes into Outlook as a table (rich), with a plain-text fallback. `navigator.clipboard` needs https, so the old way is the fallback. */
async function copyRich(html: string, text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return true;
    }
  } catch { /* fall through to the old way */ }
  const box = document.createElement('div');
  box.contentEditable = 'true'; box.innerHTML = html; box.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
  document.body.appendChild(box);
  const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(box); sel?.removeAllRanges(); sel?.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel?.removeAllRanges(); document.body.removeChild(box);
  return ok;
}

/**
 * An unsent message (.eml, header X-Unsent: 1): double-click it and Outlook for Windows opens the compose window with To / CC / subject and the
 * whole HTML table filled in — no copy and paste, and no length limit like a mailto link has.
 */
function downloadEml(draft: NonNullable<NonNullable<AutoResult['qhMail']>['draft']>, name: string) {
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
  const wrap = (s: string) => s.replace(/.{1,76}/g, '$&\r\n');
  const head = [
    'X-Unsent: 1', ...(draft.to.length ? [`To: ${draft.to.join(', ')}`] : []), ...(draft.cc.length ? [`Cc: ${draft.cc.join(', ')}`] : []),
    `Subject: =?UTF-8?B?${b64(draft.subject)}?=`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  const html = `<html><head><meta charset="utf-8"></head><body>${draft.html}</body></html>`;
  const blob = new Blob([`${head}\r\n\r\n${wrap(b64(html))}`], { type: 'message/rfc822' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${name}.eml`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** What happened to the Quality Highlight e-mail of this plan; and the draft to send from your own mail program */
function QhMailLine({ r }: { r: NonNullable<AutoResult['qhMail']> }) {
  const draft = r.draft;
  const copy = async () => { if (draft) { if (await copyRich(draft.html, draft.text)) toast.success('คัดลอกตารางแล้ว', 'วางในอีเมลด้วย Ctrl+V'); else toast.error('คัดลอกไม่สำเร็จ'); } };
  const eml = () => { if (draft) { downloadEml(draft, `Quality-Highlight-${draft.subject.match(/\d{2}\/\d{2}\/\d{4}/)?.[0]?.split('/').reverse().join('-') ?? 'plan'}`); toast.success('ดาวน์โหลดไฟล์อีเมลแล้ว', 'เปิดไฟล์นั้น (ดับเบิลคลิก) Outlook จะขึ้นหน้าเขียนอีเมลพร้อมตาราง กดส่งได้เลย'); } };
  const open = async () => {
    if (!draft) return;
    const q = (s: string) => encodeURIComponent(s);
    const head = `mailto:${draft.to.map(q).join(',')}?subject=${q(draft.subject)}${draft.cc.length ? `&cc=${draft.cc.map(q).join(',')}` : ''}`;
    // a short mail goes in whole; a long one is copied as a table and pasted by the person (a mailto link has a length limit)
    if ((head + `&body=${q(draft.text)}`).length <= 1800) { window.location.href = `${head}&body=${q(draft.text)}`; return; }
    const copied = await copyRich(draft.html, draft.text);
    window.location.href = `${head}&body=${q(`${draft.text.split('\n')[0]}\n\n(กด Ctrl+V เพื่อวางตารางรายละเอียดที่คัดลอกไว้)`)}`;
    if (copied) toast.success('คัดลอกตารางไว้แล้ว', 'ในหน้าเขียนอีเมล กด Ctrl+V เพื่อวางตาราง');
  };
  return (
    <div className="mt-1 space-y-1">
      {r.sent && <p className="font-medium text-primary">ส่งอีเมลแจ้ง Quality Highlight อัตโนมัติแล้ว: {r.matched} Doc No ที่ตรง · ถึง {r.to} คน</p>}
      {r.error && <p className="text-danger">ส่งอีเมลอัตโนมัติไม่สำเร็จ: {r.error}</p>}
      {draft ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
          <p className="text-sm"><b>{r.matched}</b> Doc No ในแผนตรงกับ Quality Highlight</p>
          <Button size="sm" onClick={eml}>เปิดอีเมลใน Outlook</Button>
          <Button size="sm" variant="secondary" onClick={() => void copy()}>คัดลอกเป็นตาราง</Button>
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => void open()} title="เปิดโปรแกรมอีเมลของเครื่องด้วยลิงก์ mailto (ตารางต้องวางเอง ถ้าอีเมลยาว)">แบบ mailto</button>
          {!draft.to.length && <span className="text-xs text-muted">ยังไม่ได้ตั้งผู้รับ — ใส่ที่การ์ด “อีเมลแจ้ง Quality Highlight”</span>}
        </div>
      ) : !r.sent && !r.error && <p className="text-muted">อีเมล Quality Highlight: {r.skipped}</p>}
    </div>
  );
}

/** What the import found that someone should look at: New Code (QC checks 100 %), Rev. changed since the last plan, not in the master … */
const ORDER = ['New Code', 'Rev. เปลี่ยน', 'ไม่พบในฐานข้อมูล', 'ไม่ทราบโรงงาน', 'Remark', 'ตรวจสอบ'];
function AlertList({ alerts }: { alerts: PlanAlert[] }) {
  const kinds = [...new Set(alerts.map((a) => a.kind))].sort((a, b) => (ORDER.indexOf(a) + 99 * +(ORDER.indexOf(a) < 0)) - (ORDER.indexOf(b) + 99 * +(ORDER.indexOf(b) < 0)));
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-amber-50 p-2 dark:bg-amber-500/10">
      <p className="font-medium text-amber-700 dark:text-amber-300">แจ้งเตือน {alerts.length} รายการ (อยู่ในชีต แจ้งเตือน ของไฟล์บันทึกด้วย)</p>
      {kinds.map((k) => {
        const list = alerts.filter((a) => a.kind === k);
        return (
          <details key={k} open={k === 'New Code' || k === 'Rev. เปลี่ยน'}>
            <summary className="cursor-pointer text-xs font-semibold">{k} · {list.length}</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-ink/80">
              {list.slice(0, 40).map((a, i) => <li key={i}>{a.doc ? <b>{[a.time, a.line, a.doc, a.country].filter(Boolean).join(' · ')}</b> : null}{a.doc ? ' — ' : ''}{a.detail}</li>)}
              {list.length > 40 && <li className="text-muted">… อีก {list.length - 40} รายการในไฟล์บันทึก</li>}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
