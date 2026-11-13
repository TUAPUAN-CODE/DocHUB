import { Plus, Trash2 } from 'lucide-react';
import { CodeSheetBlock, newSideCol, newSideItem, SheetSideCol } from '@/lib/pdf/blocks/codeSheet';
import { listTokens } from '@/lib/pdf/variables';
import { Button } from '../../ui/Button';
import { Field, TextInput, Toggle } from '../../ui/Inputs';
import { ColorInput } from '../../ui/misc';
import { Group, Num, PDF_SWATCHES } from '../BlockForms';
import type { BlockFormProps } from '../formRegistry';

function SideEditor({ title, cols, onChange, tokens }: { title: string; cols: SheetSideCol[]; onChange: (c: SheetSideCol[]) => void; tokens: { token: string; label: string }[] }) {
  const set = (id: string, p: Partial<SheetSideCol>) => onChange(cols.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <Group title={title}>
      {cols.map((c) => (
        <div key={c.id} className="space-y-1.5 rounded-xl border border-line p-2.5">
          <div className="flex items-center gap-1.5">
            <TextInput value={c.header} onChange={(e) => set(c.id, { header: e.target.value })} className="!h-8" aria-label="หัวคอลัมน์" />
            <div className="w-24 shrink-0"><Num label="" value={c.widthMm} onChange={(v) => set(c.id, { widthMm: v ?? 20 })} min={6} max={120} suffix="mm" /></div>
            <button type="button" onClick={() => onChange(cols.filter((x) => x.id !== c.id))} className="rounded p-1 text-muted hover:bg-danger/10 hover:text-danger" aria-label="ลบคอลัมน์"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <Toggle checked={!!c.qr} onChange={(v) => set(c.id, { qr: v })} label="คอลัมน์นี้คือ QR Code (สร้างจาก 4 บรรทัดโค้ดอัตโนมัติ)" />
          {!c.qr && c.items.map((it) => (
            <div key={it.id} className="flex items-center gap-1.5">
              <TextInput value={it.label} onChange={(e) => set(c.id, { items: c.items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)) })} className="!h-8 w-24 shrink-0 text-xs" placeholder="ป้าย (ถ้ามี)" />
              <TextInput value={it.text} onChange={(e) => set(c.id, { items: c.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })} className="!h-8 font-mono text-xs" placeholder="{{ชื่อคอลัมน์}}" list={`cs-${it.id}`} />
              <datalist id={`cs-${it.id}`}>{tokens.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}</datalist>
              {c.items.length > 1 && <button type="button" onClick={() => set(c.id, { items: c.items.filter((x) => x.id !== it.id) })} className="rounded p-1 text-muted hover:text-danger" aria-label="ลบรายการ"><Trash2 className="h-3 w-3" /></button>}
            </div>
          ))}
          {!c.qr && <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => set(c.id, { items: [...c.items, newSideItem()] })} disabled={c.items.length >= 6}>เพิ่มบรรทัดในคอลัมน์</Button>}
        </div>
      ))}
      <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange([...cols, newSideCol()])}>เพิ่มคอลัมน์</Button>
    </Group>
  );
}

export function CodeSheetForm({ block: b, template, onChange }: BlockFormProps<CodeSheetBlock>) {
  const tokens = listTokens(template.prompts);
  return (
    <div className="space-y-4">
      <SideEditor title="คอลัมน์ซ้าย (ก่อนตารางตำแหน่ง)" cols={b.left} onChange={(left) => onChange({ left })} tokens={tokens} />
      <Group title="บรรทัดโค้ดในตารางตำแหน่ง (1 ตัวอักษร 1 ช่อง)">
        <Field label="หัวตาราง"><TextInput value={b.gridHeader} onChange={(e) => onChange({ gridHeader: e.target.value })} /></Field>
        {b.lines.map((l, i) => (
          <div key={l.id} className="flex items-center gap-1.5">
            <span className="w-12 shrink-0 text-xs text-muted">แถว {i + 1}</span>
            <TextInput value={l.text} onChange={(e) => onChange({ lines: b.lines.map((x) => (x.id === l.id ? { ...x, text: e.target.value } : x)) })} className="!h-8 font-mono text-xs" list={`csl-${l.id}`} />
            <datalist id={`csl-${l.id}`}>{tokens.map((t) => <option key={t.token} value={t.token}>{t.label}</option>)}</datalist>
            <button type="button" onClick={() => onChange({ lines: b.lines.filter((x) => x.id !== l.id) })} className="rounded p-1 text-muted hover:text-danger" aria-label="ลบบรรทัด"><Trash2 className="h-3 w-3" /></button>
          </div>
        ))}
        <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange({ lines: [...b.lines, { id: crypto.randomUUID(), text: '' }] })} disabled={b.lines.length >= 10}>เพิ่มบรรทัด</Button>
        <div className="grid grid-cols-2 gap-2">
          <Num label="จำนวนช่อง" value={b.cells} onChange={(v) => onChange({ cells: v ?? 40 })} min={5} max={80} />
          <Num label="สูงช่อง" value={b.cellHeightMm} onChange={(v) => onChange({ cellHeightMm: v ?? 5 })} min={3} max={20} suffix="mm" />
          <Num label="ขนาดตัวอักษร" value={b.fontSize} onChange={(v) => onChange({ fontSize: v ?? 9 })} min={5} max={20} />
        </div>
        <Toggle checked={b.autoCells !== false} onChange={(v) => onChange({ autoCells: v })} label="ซ่อนช่องตำแหน่งที่ไม่มีตัวอักษร (ตามบรรทัดที่ยาวที่สุด)" />
        {b.autoCells !== false && <Num label="จำนวนช่องขั้นต่ำ" value={b.minCells ?? 12} onChange={(v) => onChange({ minCells: v ?? 12 })} min={1} max={80} />}
        <Toggle checked={b.showIndex} onChange={(v) => onChange({ showIndex: v })} label="แสดงเลขตำแหน่ง 1…N" />
        <Field label="สีหัวตาราง"><ColorInput value={b.headerBg} swatches={PDF_SWATCHES} onChange={(v) => onChange({ headerBg: v ?? '#DCEAF7' })} /></Field>
      </Group>
      <Group title="QR Code">
        <p className="text-[11px] text-muted">ข้อมูลใน QR = 4 บรรทัดโค้ด บรรทัดละ N ตัวอักษร (เติมช่องว่างให้ครบ) ต่อกัน แล้วตัดช่องว่างท้ายออก — วิธีเดียวกับเครื่องมือสร้าง QR เดิม</p>
        <div className="grid grid-cols-2 gap-2">
          <Num label="Can: ตัวอักษร/แถว" value={b.qrCanChars ?? 23} onChange={(v) => onChange({ qrCanChars: v ?? 23 })} min={5} max={80} />
          <Num label="อื่นๆ: ตัวอักษร/แถว" value={b.qrOtherChars ?? 40} onChange={(v) => onChange({ qrOtherChars: v ?? 40 })} min={5} max={80} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Num label="ขนาด QR (ว่าง = เต็มช่อง)" value={b.qrSizeMm ?? null} onChange={(v) => onChange({ qrSizeMm: v })} min={10} max={80} suffix="mm" />
          <Num label="ขอบขาวรอบ QR" value={b.qrPadMm ?? 0.8} onChange={(v) => onChange({ qrPadMm: v ?? 0.8 })} min={0} max={10} step={0.1} suffix="mm" />
        </div>
        <p className="text-[11px] text-muted">ถ้าใส่ขนาดที่ใหญ่กว่าช่อง ระบบเพิ่มความสูงของแถวโค้ดและความกว้างคอลัมน์ QR ให้พอดี · ขอบขาวรอบ QR ที่น้อยกว่าประมาณ 2 มม. (หรือใกล้เส้นตารางเกินไป) ทำให้โทรศัพท์สแกนยาก แนะนำ 1.5–3 มม.</p>
        <Field label="ข้อความที่บอกว่าเป็น Can"><TextInput value={b.qrCanText ?? '{{PKG}}'} onChange={(e) => onChange({ qrCanText: e.target.value })} className="font-mono text-xs" /></Field>
      </Group>
      <SideEditor title="คอลัมน์ขวา (หลังตารางตำแหน่ง)" cols={b.right} onChange={(right) => onChange({ right })} tokens={tokens} />
      <p className="text-[11px] text-muted">ถ้าความกว้างรวมเกินหน้ากระดาษ ระบบย่อคอลัมน์ข้างให้อัตโนมัติ (ช่องตำแหน่งแคบสุดประมาณ 2.8 มม.) แนะนำกระดาษ A3 แนวนอน</p>
    </div>
  );
}
