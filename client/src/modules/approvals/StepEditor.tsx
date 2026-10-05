import { Trash2 } from 'lucide-react';
import { usersApi } from '@/api/endpoints';
import { Num } from '@/components/pdf/BlockForms';
import { Field, TextInput, Toggle } from '@/components/ui/Inputs';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { AreaPicker } from './AreaPicker';
import type { FlowStep } from './api';

/** One approver: who, label, whether he may forward, and where his signature goes */
export function StepEditor({ step, onChange, onRemove, index, size, landscape }: { step: FlowStep; onChange: (p: Partial<FlowStep>) => void; onRemove?: () => void; index: number; size: string; landscape: boolean }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold">ขั้นที่ {index + 1}</p>{onRemove && <button type="button" onClick={onRemove} className="text-muted hover:text-danger" aria-label="ลบขั้น"><Trash2 className="h-4 w-4" /></button>}</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <Field label="ผู้อนุมัติ">
            <SearchSelect value={step.userId} onChange={(v, o) => onChange({ userId: v, userName: o?.label ?? step.userName })} placeholder={step.userName || 'ค้นหาผู้ใช้…'}
              load={async (q) => (await usersApi.lookup(q)).map((u) => ({ value: u.id, label: u.displayName, sub: `${u.username} · ${u.email}` }))} />
          </Field>
          <Field label="ตำแหน่ง / ชื่อขั้น (เช่น ผู้จัดการ QC)"><TextInput value={step.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
          <Toggle checked={step.allowForward} onChange={(v) => onChange({ allowForward: v })} label="ให้ผู้อนุมัติขั้นนี้ส่งต่อให้คนอื่นอนุมัติเพิ่มได้" />
          <div className="grid grid-cols-5 gap-2">
            <Num label="หน้า" value={step.area.page} min={1} onChange={(v) => onChange({ area: { ...step.area, page: v ?? 1 } })} />
            <Num label="X mm" value={step.area.x} onChange={(v) => onChange({ area: { ...step.area, x: v ?? 10 } })} />
            <Num label="Y mm" value={step.area.y} onChange={(v) => onChange({ area: { ...step.area, y: v ?? 10 } })} />
            <Num label="กว้าง" value={step.area.w} min={5} onChange={(v) => onChange({ area: { ...step.area, w: v ?? 10 } })} />
            <Num label="สูง" value={step.area.h} min={5} onChange={(v) => onChange({ area: { ...step.area, h: v ?? 10 } })} />
          </div>
        </div>
        <AreaPicker area={step.area} onChange={(a) => onChange({ area: { ...a, page: step.area.page } })} size={size} landscape={landscape} />
      </div>
    </div>
  );
}
