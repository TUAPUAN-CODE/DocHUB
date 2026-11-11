import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Inbox, Send, Settings2, Tags, Undo2, X } from 'lucide-react';
import { tagsApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextArea } from '@/components/ui/Inputs';
import { Avatar, EmptyState, PageHeader, RoleBadge, Skeleton } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { TagChip } from '@/components/ui/TagChip';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtDateTime, relTime, ROLE_LABEL } from '@/lib/format';
import { TagManager } from '@/pages/users/TagsPage';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import { isAdminRole, isBasicRole } from '@/types';
import { TagRequest, TagRequestStatus, tagRequestsApi } from './api';

const STATUS: Record<TagRequestStatus, { label: string; cls: string }> = {
  pending: { label: 'รออนุมัติ', cls: 'bg-warning/10 text-warning' },
  approved: { label: 'อนุมัติแล้ว', cls: 'bg-success/10 text-success' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'bg-danger/10 text-danger' },
  cancelled: { label: 'ยกเลิกแล้ว', cls: 'bg-ink/5 text-muted' },
};
const StatusChip = ({ s }: { s: TagRequestStatus }) => <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[s].cls)}>{STATUS[s].label}</span>;

/** "ขอ Tag": pick a tag and the admin / master who decides */
function RequestModal({ open, onClose, onSent, mine, pendingTagIds }: { open: boolean; onClose: () => void; onSent: () => void; mine: string[]; pendingTagIds: string[] }) {
  const { data: tags } = useLoad(() => tagsApi.list(), [], { skip: !open });
  const { data: approvers } = useLoad(() => tagRequestsApi.approvers(), [], { skip: !open });
  const [tagId, setTagId] = useState('');
  const [approverId, setApproverId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setTagId(''); setApproverId(''); setNote(''); } }, [open]);
  const choices = (tags ?? []).filter((t) => !t.isSystem && !mine.includes(t.id) && !pendingTagIds.includes(t.id));
  const send = async () => {
    setBusy(true);
    try {
      await tagRequestsApi.create({ tagId, approverId, note: note.trim() || null });
      toast.success('ส่งคำขอแล้ว', 'ผู้อนุมัติจะได้รับแจ้งเตือน');
      onSent();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const tag = choices.find((t) => t.id === tagId);
  return (
    <Modal open={open} onClose={onClose} size="sm" icon={<Send className="h-5 w-5" />} title="ขอ Tag"
      description="เลือก Tag ที่ต้องการ และเลือกว่าจะส่งคำขอไปให้ Admin / Master คนไหนอนุมัติ"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={send} loading={busy} disabled={!tagId || !approverId}>ส่งคำขอ</Button></>}>
      <div className="space-y-4">
        <Field label="Tag ที่ต้องการ" required hint={tag?.description ?? (choices.length ? undefined : 'ไม่มี Tag ให้ขอเพิ่ม (มีครบแล้ว หรือรออนุมัติอยู่)')}>
          <Select value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">— เลือก Tag —</option>
            {choices.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.memberCount} คน)</option>)}
          </Select>
        </Field>
        <Field label="ส่งคำขอถึง" required hint="Admin หรือ Master ที่จะได้รับแจ้งเตือนและอนุมัติคำขอนี้">
          <Select value={approverId} onChange={(e) => setApproverId(e.target.value)}>
            <option value="">— เลือกผู้อนุมัติ —</option>
            {(approvers ?? []).map((a) => <option key={a.id} value={a.id}>{a.displayName} · {ROLE_LABEL[a.role] ?? a.role}</option>)}
          </Select>
        </Field>
        <Field label="เหตุผล / หมายเหตุ"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="เช่น ย้ายมาประจำไลน์ PF1" /></Field>
        {tag && <p className="text-sm text-muted">ขอเข้า <TagChip tag={tag} size="md" /></p>}
      </div>
    </Modal>
  );
}

function MyTags({ ask }: { ask?: boolean } = {}) {
  const mine = useLoad(() => tagsApi.mine(), []);
  const reqs = useLoad(() => tagRequestsApi.mine(), []);
  const [asking, setAsking] = useState(!!ask);
  const cancel = async (r: TagRequest) => {
    if (!(await confirmDialog({ title: `ยกเลิกคำขอ Tag “${r.tag.name}”?`, confirmText: 'ยกเลิกคำขอ' }))) return;
    try { await tagRequestsApi.cancel(r.id); void reqs.reload(true); } catch (e) { toast.error(e); }
  };
  const list = reqs.data ?? [];
  return (
    <div className="space-y-4">
      <div className="ds-card ds-card-pad">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Tag ของฉัน</h3>
          <Button size="sm" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setAsking(true)}>ขอ Tag</Button>
        </div>
        {mine.loading && !mine.data ? <Skeleton className="h-8" />
          : <div className="flex flex-wrap gap-1.5">{(mine.data ?? []).map((t) => <TagChip key={t.id} tag={t} size="md" />)}</div>}
        <p className="mt-3 text-xs text-muted">ทุกคนมี Tag <b>All</b> · Tag อื่นได้จาก Admin / Master หรือกด “ขอ Tag” — ได้ Tag แล้วจะเห็นไฟล์และข่าวที่แชร์ให้ Tag นั้น</p>
      </div>
      <div className="ds-card">
        <h3 className="border-b border-line px-5 py-3 font-semibold">คำขอของฉัน</h3>
        {reqs.loading && !reqs.data ? <div className="space-y-2 p-4">{[1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          : !list.length ? <EmptyState icon={<Send />} title="ยังไม่เคยขอ Tag" description="กด “ขอ Tag” เพื่อขอเข้ากลุ่ม เช่น แผนกหรือไลน์ผลิตของคุณ" />
          : <div className="divide-y divide-line">{list.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <TagChip tag={r.tag} size="md" />
              <div className="min-w-0 flex-1 text-sm">
                <p>ส่งถึง <b>{r.approver.displayName}</b> · {relTime(r.createdAt)}</p>
                {r.note && <p className="text-xs text-muted">“{r.note}”</p>}
                {r.reviewNote && <p className="text-xs text-muted">ผู้อนุมัติ: “{r.reviewNote}”</p>}
              </div>
              <StatusChip s={r.status} />
              {r.status === 'pending' && <Button size="sm" variant="ghost" icon={<Undo2 className="h-3.5 w-3.5" />} onClick={() => void cancel(r)}>ยกเลิก</Button>}
            </div>
          ))}</div>}
      </div>
      <RequestModal open={asking} onClose={() => setAsking(false)} onSent={() => void reqs.reload(true)}
        mine={(mine.data ?? []).map((t) => t.id)} pendingTagIds={list.filter((r) => r.status === 'pending').map((r) => r.tag.id)} />
    </div>
  );
}

export function TagRequestInbox() {
  const isAdmin = useAuth((s) => isAdminRole(s.user?.role));
  const loadPending = useData((s) => s.loadPending);
  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [status, setStatus] = useState<'pending' | 'any'>('pending');
  const { data, loading, reload } = useLoad(() => tagRequestsApi.inbox({ scope: scope === 'all' ? 'all' : undefined, status: status === 'pending' ? 'pending' : undefined }), [scope, status]);
  const [rejecting, setRejecting] = useState<TagRequest | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const review = async (r: TagRequest, approve: boolean, n?: string) => {
    setBusy(r.id);
    try {
      await tagRequestsApi.review(r.id, approve, n || null);
      toast.success(approve ? `เพิ่ม ${r.user.displayName} เข้า Tag “${r.tag.name}” แล้ว` : 'ไม่อนุมัติคำขอแล้ว');
      setRejecting(null);
      void reload(true);
      void loadPending();
    } catch (e) { toast.error(e); } finally { setBusy(null); }
  };
  const list = data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {isAdmin && <Segmented value={scope} onChange={setScope} size="sm" options={[{ value: 'me', label: 'ส่งถึงฉัน' }, { value: 'all', label: 'ทั้งหมด (Admin)' }]} />}
        <Segmented value={status} onChange={setStatus} size="sm" options={[{ value: 'pending', label: 'รออนุมัติ' }, { value: 'any', label: 'ทุกสถานะ' }]} />
      </div>
      <div className="ds-card">
        {loading && !data ? <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          : !list.length ? <EmptyState icon={<Inbox />} title={status === 'pending' ? 'ไม่มีคำขอที่รออนุมัติ' : 'ยังไม่มีคำขอ'} description="เมื่อมีคนขอ Tag และเลือกส่งถึงคุณ จะแสดงที่นี่และมีแจ้งเตือน" />
          : <div className="divide-y divide-line">{list.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
              <Avatar name={r.user.displayName} src={r.user.avatarUrl} size={36} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm"><b>{r.user.displayName}</b><RoleBadge role={r.user.role} /><span className="text-muted">ขอเข้า</span><TagChip tag={r.tag} size="md" /></div>
                <p className="text-xs text-muted">{fmtDateTime(r.createdAt)}{scope === 'all' && ` · ส่งถึง ${r.approver.displayName}`}{r.note && ` · “${r.note}”`}</p>
                {r.status !== 'pending' && <p className="text-xs text-muted">{r.reviewedByName && `${r.reviewedByName} · `}{r.reviewNote && `“${r.reviewNote}”`}</p>}
              </div>
              {r.status === 'pending' ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => { setNote(''); setRejecting(r); }}>ไม่อนุมัติ</Button>
                  <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} loading={busy === r.id} onClick={() => void review(r, true)}>อนุมัติ</Button>
                </div>
              ) : <StatusChip s={r.status} />}
            </div>
          ))}</div>}
      </div>
      <Modal open={!!rejecting} onClose={() => setRejecting(null)} size="sm" icon={<X className="h-5 w-5" />} title="ไม่อนุมัติคำขอ"
        description={rejecting ? `${rejecting.user.displayName} ขอเข้า Tag “${rejecting.tag.name}”` : ''}
        footer={<><Button variant="secondary" onClick={() => setRejecting(null)}>ยกเลิก</Button><Button variant="danger" loading={!!busy} onClick={() => rejecting && void review(rejecting, false, note.trim())}>ไม่อนุมัติ</Button></>}>
        <Field label="เหตุผล (ผู้ขอจะเห็น)"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
      </Modal>
    </div>
  );
}

type Tab = 'mine' | 'requests' | 'manage';

/** /tags: my tags + "ขอ Tag" for everyone; requests sent to me and tag management for master / admin */
export default function TagHubPage() {
  const role = useAuth((s) => s.user?.role);
  const manager = !!role && !isBasicRole(role);
  const pending = useData((s) => s.pendingTagRequests);
  const [sp, setSp] = useSearchParams();
  const tab: Tab = manager && (sp.get('tab') === 'requests' || sp.get('tab') === 'manage') ? (sp.get('tab') as Tab) : 'mine';
  const tabs: { v: Tab; label: string; icon: JSX.Element; badge?: number }[] = [
    { v: 'mine', label: 'Tag ของฉัน', icon: <Tags className="h-4 w-4" /> },
    ...(manager ? [
      { v: 'requests' as Tab, label: 'คำขอ Tag', icon: <Inbox className="h-4 w-4" />, badge: pending },
      { v: 'manage' as Tab, label: 'จัดการ Tag', icon: <Settings2 className="h-4 w-4" /> },
    ] : []),
  ];
  return (
    <Page>
      <PageHeader icon={<Tags />} title="Tag" subtitle={manager ? 'ดู Tag ของตัวเอง · อนุมัติคำขอ · กำหนด Tag ให้ผู้ใช้' : 'ดู Tag ของตัวเอง และขอเข้า Tag จาก Admin / Master'} />
      {tabs.length > 1 && (
        <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="เมนู Tag">
          {tabs.map((t) => (
            <button key={t.v} onClick={() => setSp(t.v === 'mine' ? {} : { tab: t.v }, { replace: true })}
              className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                tab === t.v ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>
              {t.icon}{t.label}
              {!!t.badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{t.badge}</span>}
            </button>
          ))}
        </nav>
      )}
      {tab === 'mine' ? <MyTags /> : tab === 'requests' ? <TagRequestInbox /> : <TagManager />}
    </Page>
  );
}

/** คำขออนุมัติ → คำขอ Tag: my requests (+ ขอ Tag) for everyone; requests to me and tag management for master / admin */
export function TagRequestsTab() {
  const role = useAuth((s) => s.user?.role);
  const manager = !!role && !isBasicRole(role);
  const pending = useData((s) => s.pendingTagRequests);
  const [sp, setSp] = useSearchParams();
  const asked = sp.get('box');
  const box = manager && (asked === 'review' || asked === 'manage') ? asked : asked === 'mine' || !manager ? 'mine' : 'review';
  const set = (v: string) => setSp((p) => { const n = new URLSearchParams(p); n.set('box', v); n.delete('ask'); return n; }, { replace: true });
  return (
    <div>
      {manager && (
        <div className="mb-3">
          <Segmented value={box} onChange={set} size="sm" options={[
            { value: 'review', label: <span className="inline-flex items-center gap-1.5">รอฉันอนุมัติ{!!pending && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white">{pending}</span>}</span> },
            { value: 'mine', label: 'คำขอของฉัน' },
            { value: 'manage', label: 'จัดการ Tag' },
          ]} />
        </div>
      )}
      {box === 'review' ? <TagRequestInbox /> : box === 'manage' ? <TagManager /> : <MyTags ask={sp.get('ask') === '1'} />}
    </div>
  );
}
