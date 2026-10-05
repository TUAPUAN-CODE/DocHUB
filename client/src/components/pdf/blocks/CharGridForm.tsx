import { Plus, Trash2 } from 'lucide-react';
import { CharGridBlock, CharGridLine, newCharGridLine } from '@/lib/pdf/blocks/charGrid';
import { listTokens } from '@/lib/pdf/variables';
import { Button } from '../../ui/Button';
import { TextInput, Toggle } from '../../ui/Inputs';
import { Group, Num } from '../BlockForms';
import type { BlockFormProps } from '../formRegistry';

export function CharGridForm({ block: b, template, onChange }: BlockFormProps<CharGridBlock>) {
  const setLine = (id: string, p: Partial<CharGridLine>) => onChange({ lines: b.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const tokens = listTokens(template.prompts);
  return (
    <div className="space-y-4">
      <Group title="บรรทัด (ข้อความที่แตกเป็นช่อง ช่องละ 1 ตัวอักษร)">
        {b.lines.map((l) => (
          <div key={l.id} className="space-y-1.5 rounded-xl border border-line p-2.5">
            <div className="flex items-center gap-1.5">
              <TextInput value={l.label} onChange={(e) => setLine(l.id, { label: e.target.value })} className="!h-8 w-24" aria-label="ป้ายบรรทัด" />
              <button type="button" onClick={() => onChange({ lines: b.lines.filter((x) => x.id !== l.id) })} className="ml-auto rounded p-1 text-muted hover:bg-danger/10 hover:text-danger" aria-label="ลบบรรทัด"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
            <TextInput value={l.text} onChange={(e) => setLine(l.id, { text: e.target.value })} className="!h-8 font-mono text-xs" placeholder="เช่น {{Code Format แถว 1}}" list={`cg-${l.id}`} />
            <datalist id={`cg-${l.id}`}>{tokens.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}</datalist>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange({ lines: [...b.lines, newCharGridLine(b.lines.length + 1)] })} disabled={b.lines.length >= 10}>เพิ่มบรรทัด</Button>
      </Group>
      <Group title="ตาราง">
        <div className="grid grid-cols-2 gap-2">
          <Num label="จำนวนช่อง" value={b.cells} onChange={(v) => onChange({ cells: v ?? 40 })} min={5} max={120} />
          <Num label="สูงช่อง" value={b.cellHeightMm} onChange={(v) => onChange({ cellHeightMm: v ?? 6 })} min={3} max={30} suffix="mm" />
          <Num label="ขนาดตัวอักษร" value={b.fontSize} onChange={(v) => onChange({ fontSize: v ?? 10 })} min={5} max={30} />
        </div>
        <Toggle checked={b.showIndex} onChange={(v) => onChange({ showIndex: v })} label="แสดงเลขตำแหน่ง 1…N เหนือช่อง" />
        <Toggle checked={b.showLabels} onChange={(v) => onChange({ showLabels: v })} label="แสดงป้ายบรรทัดด้านซ้าย" />
        <p className="text-[11px] text-muted">ถ้าข้อความยาวกว่าจำนวนช่อง ระบบตัดส่วนเกินและพิมพ์คำเตือนสีแดงใต้ตาราง</p>
      </Group>
    </div>
  );
}
