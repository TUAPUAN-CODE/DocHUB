import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, CheckCircle2, Clock, Download, ExternalLink, PenLine, Send, XCircle } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Segmented, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { fmtDateTime } from '@/lib/format';
import { toast } from '@/store/ui';
import { ApprovalRequest, FlowStep, approvalsApi } from './api';
import { SignatureDialog } from './SignatureDialog';
import { StepEditor } from './StepEditor';
import { newStep } from './FlowsDialog';

const ST: Record<string, { t: string; c: string }> = { pending: { t: 'รออนุมัติ', c: 'text-amber-600' }, approved: { t: 'อนุมัติครบแล้ว', c: 'text-emerald-600' }, rejected: { t: 'ถูกปฏิเสธ', c: 'text-danger' }, waiting: { t: 'รอคิว', c: 'text-muted' } };

/** Approval inbox: documents waiting for me, sent by me, handled by me */
export default function ApprovalsPage() {
  const [sp, setSp] = useSearchParams();
  const [box, setBox] = useState<'inbox' | 'sent' | 'done'>('inbox');
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [sel, setSel] = useState<ApprovalRequest | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [fwd, setFwd] = useState<FlowStep | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setItems(await approvalsApi.list(box)); } catch (e) { toast.error(apiError(e).message); } }, [box]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const id = sp.get('open'); if (id) approvalsApi.one(id).then(setSel).catch(() => undefined); }, [sp]);

  const refresh = async (id: string) => { await load(); setSel(await approvalsApi.one(id)); };
  const approve = async () => {
    if (!sel) return;
    if (fwd && !fwd.userId) return toast.error('เลือกผู้อนุมัติคนถัดไป');
    setBusy(true);
    try { await approvalsApi.approve(sel.id, fwd ?? undefined); toast.success('อนุมัติและประทับลายเซ็นแล้ว'); setFwd(null); await refresh(sel.id); }
    catch (e) {
      const er = apiError(e);
      if ((er as { details?: { code?: string } }).details?.code === 'NO_SIGNATURE' || /ลายเซ็น/.test(er.message)) setSigOpen(true);
      toast.error(er.message, 'อนุมัติไม่สำเร็จ');
    } finally { setBusy(false); }
  };
  const reject = async () => {
    if (!sel) return;
    setBusy(true);
    try { await approvalsApi.reject(sel.id, reason); setRejecting(false); setReason(''); await refresh(sel.id); } catch (e) { toast.error(apiError(e).message); } finally { setBusy(false); }
  };
  const cur = sel?.steps[sel.currentStep];

  return (
    <div>
      <PageHeader title="อนุมัติเอกสาร" subtitle="เอกสาร PDF ที่รอคุณลงนาม / ที่คุณส่งไปอนุมัติ" icon={<CheckCircle2 />} actions={<Button variant="secondary" onClick={() => setSigOpen(true)}><PenLine className="h-4 w-4" />ลายเซ็นของฉัน</Button>} />
      <Segmented value={box} onChange={(v) => { setBox(v); setSel(null); setSp({}); }} options={[{ value: 'inbox', label: 'รอฉันอนุมัติ' }, { value: 'sent', label: 'ที่ฉันส่ง' }, { value: 'done', label: 'ที่ฉันเกี่ยวข้อง' }]} />
      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <ul className="divide-y divide-line rounded-xl border border-line">
          {!items.length && <li className="p-4"><EmptyState title="ไม่มีรายการ" description="" /></li>}
          {items.map((r) => (
            <li key={r.id}><button type="button" onClick={() => setSel(r)} className={`w-full px-3 py-2.5 text-left hover:bg-ink/[.03] ${sel?.id === r.id ? 'bg-primary/5' : ''}`}>
              <p className="truncate text-sm font-medium">{r.title}</p>
              <p className="truncate text-xs text-muted">{fmtDateTime(r.createdAt)} · {r.createdByName}</p>
              <p className={`text-xs font-medium ${ST[r.status].c}`}>{ST[r.status].t}{r.status === 'pending' && r.steps[r.currentStep] ? ` — รอ ${r.steps[r.currentStep].userName}` : ''}</p>
            </button></li>
          ))}
        </ul>
        {sel ? (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{sel.title}</h2>
              <Button variant="secondary" size="sm" onClick={() => void approvalsApi.openPdf(sel.id).catch((e) => toast.error(apiError(e).message))}><ExternalLink className="h-4 w-4" />เปิดดู PDF</Button>
              <Button variant="secondary" size="sm" onClick={() => void approvalsApi.openPdf(sel.id, true, `${sel.title}.pdf`).catch((e) => toast.error(apiError(e).message))}><Download className="h-4 w-4" />ดาวน์โหลด</Button>
            </div>
            <ol className="space-y-1.5">
              {sel.steps.map((s, i) => (
                <li key={s.id} className="flex items-start gap-2 text-sm">
                  {s.status === 'approved' ? <Check className="mt-0.5 h-4 w-4 text-emerald-600" /> : s.status === 'rejected' ? <XCircle className="mt-0.5 h-4 w-4 text-danger" /> : <Clock className={`mt-0.5 h-4 w-4 ${i === sel.currentStep ? 'text-amber-600' : 'text-muted'}`} />}
                  <div><b>{s.userName}</b> {s.label && <span className="text-muted">({s.label})</span>} — <span className={ST[s.status].c}>{s.status === 'approved' ? 'อนุมัติ' : s.status === 'rejected' ? 'ปฏิเสธ' : s.status === 'pending' ? 'รออนุมัติ' : 'รอคิว'}</span>{s.at && <span className="text-xs text-muted"> · {fmtDateTime(s.at)}</span>}{s.comment && <p className="text-xs text-danger">เหตุผล: {s.comment}</p>}</div>
                </li>
              ))}
            </ol>
            {sel.myTurn && cur && (
              <div className="space-y-3 rounded-xl bg-ink/[.03] p-3">
                <p className="text-sm font-medium">ถึงคิวของคุณ — พื้นที่ลายเซ็น: หน้า {cur.area.page}</p>
                {cur.allowForward && (fwd
                  ? <StepEditor index={sel.currentStep + 1} step={fwd} onChange={(p) => setFwd({ ...fwd, ...p })} onRemove={() => setFwd(null)} size="A4" landscape={false} />
                  : <Button variant="secondary" size="sm" onClick={() => setFwd(newStep())}><Send className="h-4 w-4" />ส่งต่อให้คนอื่นอนุมัติเพิ่มหลังจากฉัน</Button>)}
                <div className="flex gap-2">
                  <Button onClick={() => void approve()} loading={busy}><Check className="h-4 w-4" />อนุมัติ + ประทับลายเซ็น</Button>
                  <Button variant="secondary" onClick={() => setRejecting(true)}>ปฏิเสธ</Button>
                </div>
              </div>
            )}
          </div>
        ) : <EmptyState title="เลือกเอกสารทางซ้าย" description="" />}
      </div>
      <SignatureDialog open={sigOpen} onClose={() => setSigOpen(false)} />
      <Modal open={rejecting} onClose={() => setRejecting(false)} size="sm" title="ปฏิเสธเอกสาร" footer={<><Button variant="secondary" onClick={() => setRejecting(false)}>ยกเลิก</Button><Button onClick={() => void reject()} loading={busy} disabled={!reason.trim()}>ยืนยันปฏิเสธ</Button></>}>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เหตุผล (จำเป็น)" />
      </Modal>
    </div>
  );
}
