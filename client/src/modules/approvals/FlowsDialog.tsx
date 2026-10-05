import { useEffect, useState } from 'react';
import { Plus, Workflow } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/ui';
import { Flow, FlowStep, approvalsApi } from './api';
import { StepEditor } from './StepEditor';

export const newStep = (): FlowStep => ({ userId: '', label: '', allowForward: false, area: { page: 1, x: 130, y: 240, w: 60, h: 25 } });

/** Define the approval flows of a file: who approves, in which order, where each signature is stamped */
export function FlowsDialog({ open, onClose, fileId }: { open: boolean; onClose: () => void; fileId: string }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [sel, setSel] = useState(0);
  const [size, setSize] = useState('A4');
  const [landscape, setLandscape] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    approvalsApi.flows(fileId).then((r) => { setFlows(r.flows as Flow[]); setSel(0); }).catch((e) => toast.error(apiError(e).message));
  }, [open, fileId]);

  const cur = flows[sel];
  const patch = (p: Partial<Flow>) => setFlows((fs) => fs.map((f, i) => (i === sel ? { ...f, ...p } : f)));
  const patchStep = (i: number, p: Partial<FlowStep>) => cur && patch({ steps: cur.steps.map((s, k) => (k === i ? { ...s, ...p } : s)) });
  const add = () => { setFlows((fs) => [...fs, { name: `สายอนุมัติ ${fs.length + 1}`, steps: [newStep()] }]); setSel(flows.length); };
  const remove = () => { setFlows((fs) => fs.filter((_f, i) => i !== sel)); setSel(0); };
  const save = async () => {
    if (flows.some((f) => f.steps.some((s) => !s.userId))) return toast.error('เลือกผู้อนุมัติให้ครบทุกขั้น');
    setBusy(true);
    try { await approvalsApi.saveFlows(fileId, flows); toast.success('บันทึกสายอนุมัติแล้ว'); onClose(); }
    catch (e) { toast.error(apiError(e).message, 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<Workflow className="h-5 w-5" />} title="สายอนุมัติเอกสาร" description="กำหนดผู้อนุมัติตามลำดับ และพื้นที่ที่จะประทับลายเซ็นในหน้า PDF"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void save()} loading={busy}>บันทึก</Button></>}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="สายอนุมัติ"><Select value={String(sel)} onChange={(e) => setSel(Number(e.target.value))}>{flows.map((f, i) => <option key={i} value={i}>{f.name}</option>)}{!flows.length && <option>—</option>}</Select></Field>
          <Button variant="secondary" size="sm" onClick={add}><Plus className="h-4 w-4" />เพิ่มสาย</Button>
          {cur && <Button variant="secondary" size="sm" onClick={remove}>ลบสายนี้</Button>}
          <Field label="ขนาดหน้า (สำหรับตัวช่วยลาก)"><Select value={size} onChange={(e) => setSize(e.target.value)}>{['A3', 'A4', 'A5', 'LETTER', 'LEGAL'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
          <Field label="แนวหน้า"><Select value={landscape ? 'l' : 'p'} onChange={(e) => setLandscape(e.target.value === 'l')}><option value="p">แนวตั้ง</option><option value="l">แนวนอน</option></Select></Field>
        </div>
        {cur ? (
          <>
            <Field label="ชื่อสายอนุมัติ"><TextInput value={cur.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
            {cur.steps.map((s, i) => <StepEditor key={i} index={i} step={s} size={size} landscape={landscape} onChange={(p) => patchStep(i, p)} onRemove={cur.steps.length > 1 ? () => patch({ steps: cur.steps.filter((_x, k) => k !== i) }) : undefined} />)}
            <Button variant="secondary" size="sm" onClick={() => patch({ steps: [...cur.steps, newStep()] })}><Plus className="h-4 w-4" />เพิ่มผู้อนุมัติ (ขั้นถัดไป)</Button>
          </>
        ) : <p className="text-sm text-muted">ยังไม่มีสายอนุมัติ — กด “เพิ่มสาย”</p>}
        <p className="text-xs text-muted">พื้นที่วัดเป็นมิลลิเมตรจากมุมซ้ายบนของหน้า PDF ที่ออกมา ผู้อนุมัติแต่ละคนต้องตั้งลายเซ็นของตัวเองก่อน (เมนู “ลายเซ็นของฉัน”)</p>
      </div>
    </Modal>
  );
}
