import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, FileSpreadsheet, Folder, KeyRound, X } from 'lucide-react';
import { requestsApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextArea } from '@/components/ui/Inputs';
import { Avatar, EmptyState, PageHeader, PermBadge, Skeleton, StatusDot } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { useLoad } from '@/hooks';
import { fmtDateTime, relTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import { isBasicRole } from '@/types';
import type { AccessRequest, Perm } from '@/types';

const STATUS: Record<string, { tone: 'amber' | 'green' | 'red' | 'gray'; label: string }> = {
  pending: { tone: 'amber', label: 'รออนุมัติ' }, approved: { tone: 'green', label: 'อนุมัติแล้ว' }, rejected: { tone: 'red', label: 'ปฏิเสธ' }, cancelled: { tone: 'gray', label: 'ยกเลิก' },
};

/** embedded: a tab of คำขออนุมัติ (no page frame / title) */
export default function AccessRequestsPage({ embedded }: { embedded?: boolean }) {
  const role = useAuth((s) => s.user?.role);
  const [sp, setSp] = useSearchParams();
  const box = (sp.get('box') === 'review' && !isBasicRole(role) ? 'review' : 'mine') as 'mine' | 'review';
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const { data, loading, reload } = useLoad(() => requestsApi.list(box, status), [box, status]);
  const [review, setReview] = useState<{ req: AccessRequest; action: 'approve' | 'reject' } | null>(null);
  const [perm, setPerm] = useState<Perm>('read');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (req: AccessRequest, action: 'approve' | 'reject') => { setReview({ req, action }); setPerm(req.permission); setDays(req.durationDays ? String(req.durationDays) : ''); setNote(''); };
  const submit = async () => {
    if (!review) return;
    setBusy(true);
    try {
      if (review.action === 'approve') await requestsApi.approve(review.req.id, { permission: perm, expiresAt: days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null, reviewNote: note || undefined });
      else await requestsApi.reject(review.req.id, note);
      toast.success(review.action === 'approve' ? 'อนุมัติแล้ว' : 'ปฏิเสธคำขอแล้ว', 'ผู้ขอจะได้รับการแจ้งเตือน');
      setReview(null);
      void reload(true);
      void useData.getState().loadPending();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };

  return (
    <Frame embedded={embedded}>
      {(() => {
        const controls = <>
          {!isBasicRole(role) && <Segmented value={box} onChange={(v) => setSp((p) => { const n = new URLSearchParams(p); n.set('box', v); return n; })} options={[{ value: 'review', label: 'รอฉันอนุมัติ' }, { value: 'mine', label: 'คำขอของฉัน' }]} />}
          <Segmented value={status} onChange={setStatus} options={[{ value: 'pending', label: 'รออนุมัติ' }, { value: 'all', label: 'ทั้งหมด' }]} />
        </>;
        return embedded
          ? <div className="mb-3 flex flex-wrap items-center gap-2">{controls}<span className="text-xs text-muted">{box === 'review' ? 'คำขอสิทธิ์ไฟล์ / โฟลเดอร์ที่คุณพิจารณาได้' : 'คำขอสิทธิ์ที่คุณส่งไป'}</span></div>
          : <PageHeader icon={<KeyRound />} title="คำขอสิทธิ์เข้าถึง" subtitle={box === 'review' ? 'คำขอที่คุณมีสิทธิ์พิจารณา' : 'คำขอที่คุณส่งไป'} actions={controls} />;
      })()}
      {loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-theme" />)}</div>
        : !data?.length ? <div className="ds-card"><EmptyState icon={<KeyRound />} title="ไม่มีคำขอ" description={box === 'mine' ? 'ขอสิทธิ์ได้จากไฟล์หรือโฟลเดอร์ที่ถูกล็อก' : 'เมื่อมีผู้ขอสิทธิ์ในไฟล์ที่คุณดูแล จะแสดงที่นี่'} /></div>
        : (
          <div className="overflow-x-auto">
            <table className="row-table min-w-[900px]">
              <thead><tr><th>ผู้ขอ</th><th>รายการ</th><th>สิทธิ์</th><th>เหตุผล</th><th>ส่งเมื่อ</th><th>สถานะ</th><th /></tr></thead>
              <tbody>
                {data.map((r) => (
                  <tr key={r.id}>
                    <td><div className="flex items-center gap-2.5"><Avatar name={r.requester.displayName} src={r.requester.avatarUrl} size={32} />
                      <span className="min-w-0"><span className="block truncate text-sm font-medium">{r.requester.displayName}</span><span className="block text-xs text-muted">{r.requester.username}</span></span></div></td>
                    <td><Link to={r.targetType === 'file' ? `/files/${r.targetId}` : `/folders/${r.targetId}`} className="inline-flex max-w-[220px] items-center gap-2 text-sm font-medium hover:text-primary">
                      {r.targetType === 'file' ? <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" /> : <Folder className="h-4 w-4 shrink-0 text-primary" />}<span className="truncate">{r.targetName ?? '(ถูกลบ)'}</span></Link></td>
                    <td><PermBadge perm={r.permission} /><p className="mt-1 text-[11px] text-muted">{r.durationDays ? `${r.durationDays} วัน` : 'ถาวร'}</p></td>
                    <td className="max-w-[280px]"><p className="line-clamp-2 text-[13px]" title={r.note}>{r.note}</p>{r.reviewNote && <p className="mt-1 line-clamp-1 text-xs text-muted">↳ {r.reviewerName}: {r.reviewNote}</p>}</td>
                    <td className="whitespace-nowrap text-[13px] text-muted" title={fmtDateTime(r.createdAt)}>{relTime(r.createdAt)}</td>
                    <td><StatusDot tone={STATUS[r.status].tone} label={STATUS[r.status].label} /></td>
                    <td className="text-right">
                      {r.canReview && r.status === 'pending' && (
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" icon={<Check className="h-3.5 w-3.5" />} onClick={() => open(r, 'approve')}>อนุมัติ</Button>
                          <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => open(r, 'reject')}>ปฏิเสธ</Button>
                        </div>
                      )}
                      {box === 'mine' && r.status === 'pending' && <Button size="sm" variant="ghost" onClick={async () => { await requestsApi.cancel(r.id); void reload(true); }}>ยกเลิก</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={!!review} onClose={() => setReview(null)} size="sm" title={review?.action === 'approve' ? 'อนุมัติคำขอ' : 'ปฏิเสธคำขอ'}
        description={review ? `${review.req.requester.displayName} · ${review.req.targetName}` : ''}
        footer={<><Button variant="secondary" onClick={() => setReview(null)}>ยกเลิก</Button>
          <Button variant={review?.action === 'reject' ? 'danger' : 'primary'} loading={busy} disabled={review?.action === 'reject' && note.trim().length < 3} onClick={submit}>{review?.action === 'approve' ? 'อนุมัติ' : 'ปฏิเสธ'}</Button></>}>
        {review && (
          <div className="space-y-4">
            <div className="rounded-xl bg-ink/[.04] p-3 text-sm"><p className="text-xs text-muted">เหตุผลของผู้ขอ</p><p className="mt-1">{review.req.note}</p></div>
            {review.action === 'approve' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="ให้สิทธิ์"><Select value={perm} onChange={(e) => setPerm(e.target.value as Perm)}><option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option></Select></Field>
                <Field label="หมดอายุใน"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="">ไม่หมดอายุ</option>{[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d} วัน</option>)}</Select></Field>
              </div>
            )}
            <Field label={review.action === 'reject' ? 'เหตุผลที่ปฏิเสธ' : 'หมายเหตุถึงผู้ขอ (ไม่บังคับ)'} required={review.action === 'reject'}><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </Frame>
  );
}

const Frame = ({ embedded, children }: { embedded?: boolean; children: React.ReactNode }) => (embedded ? <>{children}</> : <Page>{children}</Page>);
