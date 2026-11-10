import { useCallback, useEffect, useState } from 'react';
import { History, Tag } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/store/ui';
import type { Column } from '@/types';
import { RevDiff, revisionsApi, RevList, RevMeta } from './api';
import { RevDiffView } from './RevDiffView';

type Pick = 'pending' | number;

/**
 * Revisions of a sheet ("ออก Rev"): what changed since the latest Rev, issuing the next one with a note,
 * and every earlier Rev with its changes compared with the Rev before it.
 */
export function RevisionsDialog({ open, onClose, sheetId, sheetName, columns, canManage, onIssued }: {
  open: boolean; onClose: () => void; sheetId: string; sheetName: string; columns: Column[]; canManage: boolean; onIssued?: () => void;
}) {
  const [list, setList] = useState<RevList | null>(null);
  const [pick, setPick] = useState<Pick>('pending');
  const [detail, setDetail] = useState<{ meta?: RevMeta; diff: RevDiff | null; prevRevNo?: number | null; base?: RevMeta | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const [firstNo, setFirstNo] = useState('1');
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    try { setList(await revisionsApi.list(sheetId)); } catch (e) { toast.error(e); }
  }, [sheetId]);
  useEffect(() => { if (open) { setPick('pending'); setNote(''); void loadList(); } }, [open, loadList]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setDetail(null);
    (pick === 'pending' ? revisionsApi.pending(sheetId).then((r) => ({ diff: r.diff, base: r.base })) : revisionsApi.get(sheetId, pick))
      .then((r) => live && setDetail(r))
      .catch((e) => live && toast.error(e))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [open, pick, sheetId, list?.revisions[0]?.revNo]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = list?.revisions[0] ?? null;
  const nextNo = latest ? latest.revNo + 1 : Math.max(0, Number(firstNo) || 1);
  const pendingTotal = detail && pick === 'pending' && detail.diff ? detail.diff.added.length + detail.diff.changed.length + detail.diff.removed.length : 0;
  const issue = async () => {
    setBusy(true);
    try {
      const r = await revisionsApi.create(sheetId, { note: note.trim() || null, firstRevNo: latest ? null : nextNo });
      toast.success(`ออก Rev.${r.revNo} แล้ว`, r.diff ? `แก้ไข ${r.diff.changed.length} · เพิ่ม ${r.diff.added.length} · ลบ ${r.diff.removed.length}` : `บันทึกข้อมูลทั้งหมด ${r.rowCount} แถว`);
      setNote('');
      await loadList();
      setPick(r.revNo);
      onIssued?.();
    } catch (e) { toast.error(apiError(e).message, 'ออก Rev ไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const keyIds = list?.keyColumnIds ?? [];
  const saveKeys = async (ids: string[]) => {
    try { await revisionsApi.settings(sheetId, ids); await loadList(); toast.success('บันทึกแล้ว', 'รายการเปลี่ยนแปลงจะเรียกชื่อแถวตามคอลัมน์ที่เลือก'); } catch (e) { toast.error(e); }
  };

  const items: { key: Pick; title: string; sub: string; badge?: string }[] = [
    { key: 'pending', title: latest ? 'ยังไม่ออก Rev' : 'ออก Rev แรก', sub: latest ? `แก้ไขหลัง Rev.${latest.revNo}` : 'บันทึกข้อมูลปัจจุบันเป็น Rev แรก',
      badge: list?.pending && list.pending.added + list.pending.changed + list.pending.removed ? String(list.pending.added + list.pending.changed + list.pending.removed) : undefined },
    ...(list?.revisions ?? []).map((r) => ({ key: r.revNo as Pick, title: `Rev.${r.revNo}`, sub: `${fmtDateTime(r.createdAt)}${r.createdByName ? ` · ${r.createdByName}` : ''}` })),
  ];

  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<History className="h-5 w-5" />} title={`Rev ของชีต “${sheetName}”`}
      description="ออก Rev เมื่อแก้ไขข้อมูลเสร็จ ระบบจะเก็บสำเนาไว้และบอกว่าต่างจาก Rev ก่อนหน้าอย่างไร" bodyClassName="!px-0 !py-0">
      <div className="flex max-h-[72vh] min-h-[50vh] flex-col md:flex-row">
        {/* phones: a dropdown; larger screens: a list */}
        <div className="border-b border-line p-3 md:hidden">
          <Select value={String(pick)} onChange={(e) => setPick(e.target.value === 'pending' ? 'pending' : Number(e.target.value))}>
            {items.map((i) => <option key={String(i.key)} value={String(i.key)}>{i.title} — {i.sub}</option>)}
          </Select>
        </div>
        <nav className="hidden w-60 shrink-0 overflow-y-auto border-r border-line p-2 md:block">
          {items.map((i) => (
            <button key={String(i.key)} onClick={() => setPick(i.key)}
              className={cn('mb-1 flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left', pick === i.key ? 'bg-primary/10 text-primary' : 'hover:bg-ink/5')}>
              <Tag className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{i.title}</span><span className="block truncate text-xs text-muted">{i.sub}</span></span>
              {i.badge && <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{i.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading || !detail ? <div className="space-y-3"><Skeleton className="h-6 w-56" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : pick === 'pending' ? (
            <div className="space-y-4">
              {list?.canIssue && (
                <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/[.04] p-3">
                  {!latest && <Field label="เริ่มที่ Rev" hint="ไฟล์ Excel เดิมเป็น REV.8 → ใส่ 8"><TextInput inputMode="numeric" value={firstNo} onChange={(e) => setFirstNo(e.target.value.replace(/\D/g, ''))} className="!h-9 !w-28" /></Field>}
                  <TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="หมายเหตุของ Rev นี้ (ไม่บังคับ) เช่น เพิ่ม Note จากปัญหาที่พบในไลน์" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-muted">{latest ? (pendingTotal ? `จะบันทึกการเปลี่ยนแปลง ${pendingTotal} แถวด้านล่างเป็น Rev.${nextNo}` : `ยังไม่มีการเปลี่ยนแปลงจาก Rev.${latest.revNo}`) : 'บันทึกข้อมูลทั้งหมดตอนนี้เป็น Rev แรก'}</p>
                    <Button icon={<Tag className="h-4 w-4" />} loading={busy} disabled={!!latest && !pendingTotal && !detail.diff?.columns.added.length && !detail.diff?.columns.removed.length && !detail.diff?.columns.renamed.length} onClick={() => void issue()}>ออก Rev.{nextNo}</Button>
                  </div>
                </div>
              )}
              {detail.diff ? <RevDiffView diff={detail.diff} /> : <p className="py-6 text-center text-sm text-muted">ยังไม่เคยออก Rev — ออก Rev แรกเพื่อเริ่มติดตามการเปลี่ยนแปลง</p>}
            </div>
          ) : detail.meta && (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-semibold">Rev.{detail.meta.revNo} <span className="text-sm font-normal text-muted">{fmtDateTime(detail.meta.createdAt)}{detail.meta.createdByName ? ` · ${detail.meta.createdByName}` : ''} · {detail.meta.rowCount.toLocaleString()} แถว</span></p>
                {detail.meta.note && <p className="mt-1 whitespace-pre-wrap rounded-xl bg-ink/5 px-3 py-2 text-sm">{detail.meta.note}</p>}
                <p className="mt-2 text-xs text-muted">{detail.prevRevNo !== null && detail.prevRevNo !== undefined ? `เทียบกับ Rev.${detail.prevRevNo}` : 'Rev แรก: บันทึกข้อมูลทั้งหมด ไม่มี Rev ก่อนหน้าให้เทียบ'}</p>
              </div>
              {detail.diff && <RevDiffView diff={detail.diff} />}
            </div>
          )}
          {canManage && columns.length > 0 && (
            <div className="mt-6 border-t border-line pt-3">
              <Field label="เรียกชื่อแถวในรายการเปลี่ยนแปลงด้วย" hint="เช่น Sub Doc No. + Short Code (ค่าเริ่มต้น: คอลัมน์แรก)">
                <div className="flex flex-wrap gap-2">
                  {[0, 1].map((i) => (
                    <Select key={i} value={keyIds[i] ?? ''} className="w-48" onChange={(e) => { const ids = [...keyIds]; ids[i] = e.target.value; void saveKeys(ids.filter(Boolean).slice(0, 2)); }}>
                      <option value="">{i === 0 ? '— คอลัมน์แรก —' : '— ไม่ใช้ —'}</option>
                      {columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                  ))}
                </div>
              </Field>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
