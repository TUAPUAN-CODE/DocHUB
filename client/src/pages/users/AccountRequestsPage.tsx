import { useEffect, useState } from 'react';
import { Check, Inbox, UserPlus, Users, X } from 'lucide-react';
import { accountRequestsApi, tagsApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextArea } from '@/components/ui/Inputs';
import { Avatar, EmptyState, PageHeader, RoleBadge, Skeleton, StatusDot } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { TagPicker } from '@/components/ui/TagChip';
import { useLoad } from '@/hooks';
import { fmtDateTime, relTime } from '@/lib/format';
import { ROLE_HINT, ROLE_OPTIONS } from '@/lib/roles';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import type { AccountRequest, Role } from '@/types';
import { UsersTabs } from './UsersTabs';

const PROVIDER = { microsoft: 'Microsoft', google: 'Google' } as const;
const STATUS: Record<AccountRequest['status'], { tone: 'amber' | 'green' | 'red'; label: string }> = {
  pending: { tone: 'amber', label: 'รออนุมัติ' }, approved: { tone: 'green', label: 'อนุมัติแล้ว' }, rejected: { tone: 'red', label: 'ปฏิเสธแล้ว' },
};

function ApproveModal({ req, onClose, onDone }: { req: AccountRequest | null; onClose: () => void; onDone: () => void }) {
  const { data: tags } = useLoad(() => tagsApi.list(), [req?.id], { skip: !req });
  const [role, setRole] = useState<Role>('user');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (req) { setRole(req.requestedRole); setTagIds([]); setNote(''); } }, [req]);
  const submit = async () => {
    if (!req) return;
    setBusy(true);
    try {
      await accountRequestsApi.approve(req.id, { role, tagIds, reviewNote: note.trim() || undefined });
      toast.success(`สร้างบัญชี ${req.displayName} แล้ว`, req.provider ? `เข้าสู่ระบบด้วย ${PROVIDER[req.provider]} ได้เลย` : `เข้าสู่ระบบด้วยชื่อผู้ใช้ ${req.username} ได้เลย`);
      onDone();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!req} onClose={onClose} size="sm" icon={<Check className="h-5 w-5" />} title={`อนุมัติบัญชี ${req?.displayName ?? ''}`}
      description="ผู้ขอเลือกระดับที่ต้องการมา — Admin เป็นคนกำหนดระดับจริง"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy}>อนุมัติและสร้างบัญชี</Button></>}>
      {req && (
        <div className="space-y-4">
          <div className="rounded-xl bg-ink/[.04] px-3 py-2.5 text-sm">ผู้ใช้ขอระดับ <span className="ml-1 align-middle"><RoleBadge role={req.requestedRole} /></span></div>
          <Field label="ระดับที่ให้" hint={ROLE_HINT[role]}>
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}{o.v === req.requestedRole ? ' — ตามที่ขอ' : ''}</option>)}</Select>
          </Field>
          <Field label="Tag" hint="ใส่ผู้ใช้เข้า Tag เลย (ไม่บังคับ) — ได้สิทธิ์ไฟล์ที่แชร์ให้ Tag นั้นทันที">
            <TagPicker tags={tags ?? []} value={tagIds} onChange={setTagIds} />
          </Field>
          <Field label="หมายเหตุ"><TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
        </div>
      )}
    </Modal>
  );
}

function RejectModal({ req, onClose, onDone }: { req: AccountRequest | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setNote(''), [req]);
  const submit = async () => {
    if (!req) return;
    setBusy(true);
    try { await accountRequestsApi.reject(req.id, note.trim() || undefined); toast.success('ปฏิเสธคำขอแล้ว'); onDone(); onClose(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!req} onClose={onClose} size="sm" icon={<X className="h-5 w-5" />} title={`ปฏิเสธคำขอของ ${req?.displayName ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button variant="danger" onClick={submit} loading={busy}>ปฏิเสธคำขอ</Button></>}>
      <Field label="เหตุผล (ไม่บังคับ)"><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} autoFocus /></Field>
    </Modal>
  );
}

export default function AccountRequestsPage() {
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const { data, loading, reload } = useLoad(() => accountRequestsApi.list(status), [status]);
  const [approve, setApprove] = useState<AccountRequest | null>(null);
  const [reject, setReject] = useState<AccountRequest | null>(null);
  const done = () => { void reload(true); void useData.getState().loadPending(); };
  const items = data ?? [];
  return (
    <Page>
      <PageHeader icon={<Users />} title="จัดการผู้ใช้" subtitle="คำขอสร้างบัญชีจากหน้าเข้าสู่ระบบ (สมัครเอง หรือ Microsoft) — อนุมัติแล้วผู้ขอเข้าใช้งานได้ทันที" />
      <UsersTabs />
      <div className="mb-3"><Segmented value={status} onChange={setStatus} options={[{ value: 'pending', label: 'รออนุมัติ' }, { value: 'all', label: 'ทั้งหมด' }]} /></div>
      {loading && !data ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-theme" />)}</div>
        : !items.length ? <div className="ds-card"><EmptyState icon={<Inbox />} title={status === 'pending' ? 'ไม่มีคำขอรออนุมัติ' : 'ยังไม่มีคำขอ'} description="ผู้ที่ยังไม่มีบัญชีกด “ขอสร้างบัญชี” ที่หน้าเข้าสู่ระบบ แล้วคำขอจะมาที่นี่ (Admin ได้รับการแจ้งเตือน)" /></div>
        : (
          <div className="space-y-3">
            {items.map((r) => (
              <div key={r.id} className="ds-card ds-card-pad">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={r.displayName} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{r.displayName}</span>
                      {r.provider ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{PROVIDER[r.provider]}</span>
                        : <span className="text-xs text-muted">@{r.username}</span>}
                      <StatusDot tone={STATUS[r.status].tone} label={STATUS[r.status].label} />
                    </div>
                    <div className="mt-0.5 break-all text-sm text-muted">{r.email}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted">ขอระดับ</span><RoleBadge role={r.requestedRole} />
                      {r.grantedRole && <><span className="text-muted">· ได้รับ</span><RoleBadge role={r.grantedRole} /></>}
                    </div>
                    {r.note && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-ink/[.04] px-3 py-2 text-sm">{r.note}</p>}
                    <div className="mt-2 text-xs text-muted" title={fmtDateTime(r.createdAt)}>
                      ส่งคำขอ {relTime(r.createdAt)}
                      {r.reviewedAt && ` · ${r.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}โดย ${r.reviewerName ?? '-'} ${relTime(r.reviewedAt)}`}
                      {r.reviewNote && ` · “${r.reviewNote}”`}
                    </div>
                  </div>
                  {r.status === 'pending' && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      <Button variant="secondary" className="flex-1 sm:flex-none" icon={<X className="h-4 w-4" />} onClick={() => setReject(r)}>ปฏิเสธ</Button>
                      <Button className="flex-1 sm:flex-none" icon={<UserPlus className="h-4 w-4" />} onClick={() => setApprove(r)}>อนุมัติ</Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      <ApproveModal req={approve} onClose={() => setApprove(null)} onDone={done} />
      <RejectModal req={reject} onClose={() => setReject(null)} onDone={done} />
    </Page>
  );
}
