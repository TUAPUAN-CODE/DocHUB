import { ReactNode, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Upload, X } from 'lucide-react';
import { uploadsApi } from '@/api/endpoints';
import { cn } from '@/lib/cn';
import { loadCols } from '@/lib/dashCols';
import { listTokens } from '@/lib/pdf/variables';
import { Align, Agg, Block, BlockType, ColumnsBlock, FieldsBlock, ImageBlock, LineBlock, newBlock, newTextBlock, PDF_FONTS, PdfFont, PromptDef, SpacerBlock, TableBlock, TableCol, TextBlock, TextStyle } from '@/lib/pdf/types';
import { toast } from '@/store/ui';
import type { Column } from '@/types';
import { Button } from '../ui/Button';
import { Checkbox, Field, Segmented, Select, TextArea, TextInput, Toggle } from '../ui/Inputs';
import { ColorInput } from '../ui/misc';

export const PDF_SWATCHES = ['#111827', '#6B7280', '#FFFFFF', '#1552F0', '#16A34A', '#E5484D', '#F59E0B', '#F3F4F6'];

export function Num({ label, value, onChange, min, max, step = 1, suffix }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <Field label={label}>
      <div className="relative">
        <TextInput inputMode="decimal" value={value ?? ''} step={step} className="!h-9 pr-9"
          onChange={(e) => { const raw = e.target.value; if (raw === '') return onChange(null); const v = Number(raw); if (!Number.isNaN(v)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))); }} />
        {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">{suffix}</span>}
      </div>
    </Field>
  );
}

export const Group = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="space-y-3 border-t border-line pt-3 first:border-0 first:pt-0"><p className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</p>{children}</div>
);

/* ---------------- text style ---------------- */
export function StyleForm({ s, onChange, compact }: { s: TextStyle; onChange: (p: TextStyle) => void; compact?: boolean }) {
  const set = (p: Partial<TextStyle>) => onChange({ ...s, ...p });
  const tog = (k: 'bold' | 'italic' | 'underline', label: string, cls = '') => (
    <button type="button" onClick={() => set({ [k]: !s[k] })} className={cn('h-8 w-8 rounded-lg border text-sm', s[k] ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:text-ink', cls)}>{label}</button>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="ฟอนต์"><Select value={s.font ?? ''} onChange={(e) => set({ font: (e.target.value || undefined) as PdfFont | undefined })}><option value="">ตามเอกสาร</option>{PDF_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field>
        <Num label="ขนาด" value={s.fontSize} onChange={(v) => set({ fontSize: v ?? undefined })} min={5} max={120} step={0.5} suffix="pt" />
      </div>
      <div className="flex items-center gap-1.5">
        {tog('bold', 'B', 'font-bold')}{tog('italic', 'I', 'italic')}{tog('underline', 'U', 'underline')}
        <Segmented size="sm" value={(s.align ?? 'left') as Align} onChange={(v) => set({ align: v })} options={[{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }, { value: 'justify', label: 'เต็ม' }]} />
      </div>
      <Field label="สีตัวอักษร"><ColorInput value={s.color} swatches={PDF_SWATCHES} onChange={(v) => set({ color: v ?? undefined })} allowEmpty /></Field>
      {!compact && <Field label="สีพื้นหลังข้อความ"><ColorInput value={s.bg} swatches={PDF_SWATCHES} onChange={(v) => set({ bg: v ?? undefined })} allowEmpty /></Field>}
    </div>
  );
}

export function SpacingForm({ b, onChange }: { b: Block; onChange: (p: Partial<Block>) => void }) {
  const canAbs = b.type === 'text' || b.type === 'image' || b.type === 'line';
  return (
    <Group title="ระยะและตำแหน่ง">
      <div className="grid grid-cols-2 gap-2">
        <Num label="เว้นบน" value={b.marginTop ?? 0} onChange={(v) => onChange({ marginTop: v ?? 0 })} min={0} max={200} suffix="mm" />
        <Num label="เว้นล่าง" value={b.marginBottom ?? 0} onChange={(v) => onChange({ marginBottom: v ?? 0 })} min={0} max={200} suffix="mm" />
        {b.type !== 'table' && <><Num label="เว้นซ้าย" value={b.marginLeft ?? 0} onChange={(v) => onChange({ marginLeft: v ?? 0 })} min={0} max={200} suffix="mm" /><Num label="เว้นขวา" value={b.marginRight ?? 0} onChange={(v) => onChange({ marginRight: v ?? 0 })} min={0} max={200} suffix="mm" /></>}
      </div>
      {canAbs && (
        <>
          <Toggle checked={!!b.position} onChange={(v) => onChange({ position: v ? { x: 20, y: 20 } : null })} label="วางตำแหน่งแน่นอน (X, Y จากมุมกระดาษ)" />
          {b.position && <div className="grid grid-cols-2 gap-2"><Num label="X" value={b.position.x} onChange={(v) => onChange({ position: { ...b.position!, x: v ?? 0 } })} suffix="mm" /><Num label="Y" value={b.position.y} onChange={(v) => onChange({ position: { ...b.position!, y: v ?? 0 } })} suffix="mm" /></div>}
        </>
      )}
      {b.type !== 'pageBreak' && (
        <div className="grid grid-cols-1 gap-1.5">
          <Toggle checked={!!b.pageBreakBefore} onChange={(v) => onChange({ pageBreakBefore: v })} label="ขึ้นหน้าใหม่ก่อนบล็อกนี้" />
          <Toggle checked={!!b.pageBreakAfter} onChange={(v) => onChange({ pageBreakAfter: v })} label="ขึ้นหน้าใหม่หลังบล็อกนี้" />
          <Field label="ฟอร์มต่อแถว + จัดกลุ่ม: พิมพ์บล็อกนี้">
            <Select value={b.groupOnce ?? ''} onChange={(e) => onChange({ groupOnce: (e.target.value || undefined) as 'start' | 'end' | undefined })}>
              <option value="">ซ้ำทุกแถว (ปกติ)</option>
              <option value="start">ครั้งเดียวต้นกลุ่ม (เช่น หัวเอกสาร)</option>
              <option value="end">ครั้งเดียวท้ายกลุ่ม (เช่น ลายเซ็นของลูกค้านั้น)</option>
            </Select>
          </Field>
        </div>
      )}
    </Group>
  );
}

/* ---------------- text ---------------- */
export function TextForm({ b, onChange, compact, prompts }: { b: TextBlock; onChange: (p: Partial<TextBlock>) => void; compact?: boolean; prompts?: PromptDef[] }) {
  return (
    <div className="space-y-3">
      <Field label="ข้อความ"><TextArea rows={compact ? 3 : 5} value={b.text} onChange={(e) => onChange({ text: e.target.value })} /></Field>
      <div className="flex flex-wrap gap-1">
        {listTokens(prompts).map((t) => <button key={t.token} type="button" title={t.label} onClick={() => onChange({ text: `${b.text}${t.token}` })} className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] hover:border-primary/50 hover:text-primary">{t.token}</button>)}
      </div>
      <p className="text-[11px] text-muted">ในโหมด “แบบฟอร์มต่อแถว” พิมพ์ {'{{ชื่อคอลัมน์}}'} เพื่อแทรกค่าของแถวนั้น เช่น {'{{หมายเลข IR}}'}</p>
      <StyleForm s={b.style} onChange={(style) => onChange({ style })} compact={compact} />
      {!compact && (
        <>
          <Toggle checked={!!b.border} onChange={(v) => onChange({ border: v ? { color: '#9CA3AF', width: 0.8, padding: 2 } : null })} label="ใส่กรอบ" />
          {b.border && <div className="grid grid-cols-3 gap-2"><Field label="สีกรอบ"><ColorInput value={b.border.color} swatches={PDF_SWATCHES} onChange={(v) => onChange({ border: { ...b.border!, color: v ?? '#9CA3AF' } })} /></Field>
            <Num label="หนา" value={b.border.width} onChange={(v) => onChange({ border: { ...b.border!, width: v ?? 0.5 } })} step={0.1} min={0.1} max={5} /><Num label="ระยะใน" value={b.border.padding} onChange={(v) => onChange({ border: { ...b.border!, padding: v ?? 2 } })} suffix="mm" /></div>}
        </>
      )}
    </div>
  );
}

/* ---------------- image ---------------- */
export function ImageForm({ b, onChange, perRow, columns, compact }: { b: ImageBlock; onChange: (p: Partial<ImageBlock>) => void; perRow: boolean; columns: Column[]; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { onChange({ url: (await uploadsApi.image(f)).url }); } catch (e) { toast.error(e, 'อัปโหลดไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const imgCols = columns.filter((c) => c.dataType === 'image');
  return (
    <div className="space-y-3">
      {perRow && !compact && <Segmented size="sm" value={b.source} onChange={(v) => onChange({ source: v })} options={[{ value: 'static', label: 'รูปคงที่ (โลโก้)' }, { value: 'column', label: 'รูปจากคอลัมน์ของแถว' }]} />}
      {b.source === 'column' ? (
        <>
          <Field label="คอลัมน์รูปภาพ"><Select value={b.columnId ?? ''} onChange={(e) => { const c = imgCols.find((x) => x.id === e.target.value); onChange({ columnId: e.target.value || null, columnName: c?.name ?? null }); }}><option value="">— เลือก —</option>{imgCols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Num label="จำนวนรูปสูงสุด" value={b.maxImages ?? 4} onChange={(v) => onChange({ maxImages: v ?? 4 })} min={1} max={30} />
        </>
      ) : (
        <>
          {b.url && <img src={b.url} alt="" className="max-h-28 rounded-lg border border-line object-contain" />}
          <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-3 text-sm text-muted hover:border-primary/50 hover:text-primary', busy && 'opacity-50')}>
            <Upload className="h-4 w-4" />{busy ? 'กำลังอัปโหลด…' : b.url ? 'เปลี่ยนรูป' : 'อัปโหลดรูป / โลโก้'}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          <Field label="หรือใส่ URL รูป"><TextInput value={b.url} onChange={(e) => onChange({ url: e.target.value })} placeholder="/uploads/…  หรือ https://…" /></Field>
        </>
      )}
      <div className="grid grid-cols-2 gap-2"><Num label="กว้าง" value={b.widthMm} onChange={(v) => onChange({ widthMm: v ?? 40 })} min={2} max={400} suffix="mm" /><Num label="สูง (ว่าง = ตามสัดส่วน)" value={b.heightMm} onChange={(v) => onChange({ heightMm: v })} min={2} max={400} suffix="mm" /></div>
      {!compact && <Field label="จัดแนว"><Segmented size="sm" value={b.align} onChange={(v) => onChange({ align: v })} options={[{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }]} /></Field>}
    </div>
  );
}

/* ---------------- line / spacer ---------------- */
export function LineForm({ b, onChange }: { b: LineBlock; onChange: (p: Partial<LineBlock>) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2"><Num label="ความหนา" value={b.thickness} onChange={(v) => onChange({ thickness: v ?? 1 })} step={0.1} min={0.1} max={10} /><Num label="ความกว้าง" value={b.widthPct} onChange={(v) => onChange({ widthPct: v ?? 100 })} min={5} max={100} suffix="%" /></div>
      <Field label="สีเส้น"><ColorInput value={b.color} swatches={PDF_SWATCHES} onChange={(v) => onChange({ color: v ?? '#9CA3AF' })} /></Field>
      <Toggle checked={!!b.dash} onChange={(v) => onChange({ dash: v })} label="เส้นประ" />
    </div>
  );
}
export const SpacerForm = ({ b, onChange }: { b: SpacerBlock; onChange: (p: Partial<SpacerBlock>) => void }) => <Num label="ความสูงช่องว่าง" value={b.height} onChange={(v) => onChange({ height: v ?? 5 })} min={1} max={250} suffix="mm" />;

/* ---------------- columns row ---------------- */
export function ColumnsForm({ b, onChange, perRow, columns }: { b: ColumnsBlock; onChange: (p: Partial<ColumnsBlock>) => void; perRow: boolean; columns: Column[] }) {
  const setCol = (i: number, p: Partial<ColumnsBlock['cols'][number]>) => onChange({ cols: b.cols.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  return (
    <div className="space-y-3">
      <Num label="ระยะห่างระหว่างคอลัมน์" value={b.gap} onChange={(v) => onChange({ gap: v ?? 4 })} min={0} max={50} suffix="mm" />
      {b.cols.map((col, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-line p-2.5">
          <div className="flex items-center gap-2"><span className="text-xs font-semibold">คอลัมน์ {i + 1}</span><div className="ml-auto w-24"><Num label="" value={col.widthPct} onChange={(v) => setCol(i, { widthPct: v ?? 50 })} min={5} max={100} suffix="%" /></div>
            {b.cols.length > 1 && <button onClick={() => onChange({ cols: b.cols.filter((_, j) => j !== i) })} className="text-muted hover:text-danger" aria-label="ลบคอลัมน์"><X className="h-4 w-4" /></button>}</div>
          {col.blocks.map((cb, k) => (
            <div key={cb.id} className="space-y-2 rounded-lg bg-ink/[.03] p-2">
              <div className="flex items-center justify-between text-xs text-muted"><span>{cb.type === 'text' ? 'ข้อความ' : 'รูปภาพ'}</span><button onClick={() => setCol(i, { blocks: col.blocks.filter((_, j) => j !== k) })} className="hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button></div>
              {cb.type === 'text' ? <TextForm compact b={cb} onChange={(p) => setCol(i, { blocks: col.blocks.map((x, j) => (j === k ? { ...cb, ...p } : x)) })} />
                : <ImageForm compact perRow={perRow} columns={columns} b={cb} onChange={(p) => setCol(i, { blocks: col.blocks.map((x, j) => (j === k ? { ...cb, ...p } as ImageBlock : x)) })} />}
            </div>
          ))}
          <div className="flex gap-1.5"><Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCol(i, { blocks: [...col.blocks, newTextBlock('ข้อความ')] })}>ข้อความ</Button>
            <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setCol(i, { blocks: [...col.blocks, newBlock('image') as ImageBlock] })}>รูปภาพ</Button></div>
        </div>
      ))}
      {b.cols.length < 4 && <Button size="sm" variant="secondary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => onChange({ cols: [...b.cols, { widthPct: 25, blocks: [newTextBlock('ข้อความ')] }] })}>เพิ่มคอลัมน์</Button>}
    </div>
  );
}

/* ---------------- columns picker (table / fields) ---------------- */
export function ColumnPicker({ cols, available, onChange, showWidth }: { cols: TableCol[]; available: Column[]; onChange: (c: TableCol[]) => void; showWidth?: boolean }) {
  const used = new Set(cols.map((c) => c.columnId));
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= cols.length) return; const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {cols.map((c, i) => {
          const real = available.find((x) => x.id === c.columnId) ?? available.find((x) => x.name === c.columnName);
          return (
            <div key={c.columnId + i} className="space-y-1 rounded-lg border border-line px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{real?.name ?? c.columnName}{!real && <span className="ml-1 text-xs text-danger">(ไม่พบ)</span>}</span>
                <button onClick={() => move(i, -1)} className="text-muted hover:text-ink"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button onClick={() => move(i, 1)} className="text-muted hover:text-ink"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button onClick={() => onChange(cols.filter((_, j) => j !== i))} className="text-muted hover:text-danger"><X className="h-3.5 w-3.5" /></button>
              </div>
              <div className="grid grid-cols-[1fr_72px_84px] gap-1.5">
                <TextInput value={c.header ?? ''} placeholder="หัวคอลัมน์ในเอกสาร" className="!h-8 text-xs" onChange={(e) => onChange(cols.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)))} />
                {showWidth ? <TextInput value={c.widthMm ?? ''} placeholder="กว้าง mm" inputMode="decimal" className="!h-8 text-xs" onChange={(e) => onChange(cols.map((x, j) => (j === i ? { ...x, widthMm: e.target.value === '' ? null : Number(e.target.value) || null } : x)))} /> : <span />}
                {showWidth ? <Select value={c.align ?? ''} className="[&>select]:!h-8 [&>select]:text-xs" onChange={(e) => onChange(cols.map((x, j) => (j === i ? { ...x, align: (e.target.value || undefined) as Align | undefined } : x)))}><option value="">แนวอัตโนมัติ</option><option value="left">ซ้าย</option><option value="center">กลาง</option><option value="right">ขวา</option></Select> : <span />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="max-h-40 overflow-y-auto rounded-lg border border-dashed border-line p-1.5">
        <p className="mb-1 px-1 text-[11px] text-muted">คอลัมน์ที่ยังไม่ได้ใช้ (คลิกเพื่อเพิ่ม)</p>
        {available.filter((c) => !used.has(c.id)).map((c) => <button key={c.id} onClick={() => onChange([...cols, { columnId: c.id, columnName: c.name }])} className="mr-1 mt-1 rounded-full border border-line px-2 py-0.5 text-xs hover:border-primary/50 hover:text-primary">+ {c.name}</button>)}
        {available.every((c) => used.has(c.id)) && <span className="px-1 text-xs text-muted">ใช้ครบทุกคอลัมน์แล้ว</span>}
      </div>
      <div className="flex gap-1.5"><Button size="sm" variant="ghost" onClick={() => onChange(available.map((c) => ({ columnId: c.id, columnName: c.name })))}>ใช้ทุกคอลัมน์</Button><Button size="sm" variant="ghost" onClick={() => onChange([])}>ล้าง</Button></div>
    </div>
  );
}

/* ---------------- table ---------------- */
export function TableForm({ b, onChange, sheets }: { b: TableBlock; onChange: (p: Partial<TableBlock>) => void; sheets: { id: string; name: string }[] }) {
  const [cols, setCols] = useState<Column[]>([]);
  useEffect(() => { let live = true; if (b.sheetId) void loadCols(b.sheetId).then((c) => live && setCols(c)); else setCols([]); return () => { live = false; }; }, [b.sheetId]);
  const numeric = cols.filter((c) => c.dataType === 'int' || c.dataType === 'float');
  const setH = (p: Partial<TableBlock['header']>) => onChange({ header: { ...b.header, ...p } });
  const setB = (p: Partial<TableBlock['body']>) => onChange({ body: { ...b.body, ...p } });
  return (
    <div className="space-y-4">
      <Group title="ข้อมูล">
        <Field label="ชีตที่แสดง"><Select value={b.sheetId} onChange={(e) => { const s = sheets.find((x) => x.id === e.target.value); onChange({ sheetId: e.target.value, sheetName: s?.name ?? '', columns: [], summary: [] }); }}><option value="">— เลือกชีต —</option>{sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="คอลัมน์ในตาราง (เรียงตามลำดับด้านล่าง)"><ColumnPicker cols={b.columns} available={cols} onChange={(c) => onChange({ columns: c })} showWidth /></Field>
        <Toggle checked={b.useCurrentFilters} onChange={(v) => onChange({ useCurrentFilters: v })} label="ใช้ตัวกรอง/การเรียง ที่ผู้ใช้เลือกอยู่ตอนส่งออก" />
        <Field label="ข้อความหัวตาราง (ไม่บังคับ)"><TextInput value={b.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value })} placeholder="เช่น รายการตรวจสอบประจำวัน" /></Field>
      </Group>
      <Group title="การแบ่งหน้า">
        <div className="grid grid-cols-2 gap-2">
          <Num label="จำนวนแถวต่อหน้า (ว่าง = เต็มหน้า)" value={b.rowsPerPage} onChange={(v) => onChange({ rowsPerPage: v && v > 0 ? Math.round(v) : null })} min={1} max={500} />
          <Num label="จำกัดแถวทั้งหมด (ว่าง = ทั้งหมด)" value={b.limit} onChange={(v) => onChange({ limit: v && v > 0 ? Math.round(v) : null })} min={1} max={50000} />
        </div>
        <p className="text-[11px] text-muted">ถ้ากำหนดแถวต่อหน้า เมื่อครบจะ <b>ขึ้นหน้าใหม่</b> พร้อมหัวตารางซ้ำให้อัตโนมัติ</p>
        <Toggle checked={b.repeatHeader} onChange={(v) => onChange({ repeatHeader: v })} label="ซ้ำหัวตารางทุกหน้า" />
      </Group>
      <Group title="พื้นที่ของตาราง">
        <div className="grid grid-cols-2 gap-2"><Num label="กว้าง" value={b.widthPct} onChange={(v) => onChange({ widthPct: v ?? 100 })} min={20} max={100} suffix="%" /><Field label="จัดแนว"><Select value={b.align} onChange={(e) => onChange({ align: e.target.value as TableBlock['align'] })}><option value="left">ชิดซ้าย</option><option value="center">กึ่งกลาง</option><option value="right">ชิดขวา</option></Select></Field></div>
      </Group>
      <Group title="หัวตาราง">
        <div className="grid grid-cols-2 gap-2"><Field label="สีพื้น"><ColorInput value={b.header.bg} swatches={PDF_SWATCHES} onChange={(v) => setH({ bg: v ?? '#1552F0' })} /></Field><Field label="สีตัวอักษร"><ColorInput value={b.header.color} swatches={PDF_SWATCHES} onChange={(v) => setH({ color: v ?? '#FFFFFF' })} /></Field></div>
        <div className="grid grid-cols-2 gap-2"><Num label="ขนาดตัวอักษร" value={b.header.fontSize} onChange={(v) => setH({ fontSize: v ?? 10 })} min={5} max={40} step={0.5} suffix="pt" /><Field label="จัดแนว"><Select value={b.header.align} onChange={(e) => setH({ align: e.target.value as Align })}><option value="left">ซ้าย</option><option value="center">กลาง</option><option value="right">ขวา</option></Select></Field></div>
        <Toggle checked={b.header.bold} onChange={(v) => setH({ bold: v })} label="ตัวหนา" />
      </Group>
      <Group title="เนื้อหาตาราง">
        <div className="grid grid-cols-2 gap-2"><Num label="ขนาดตัวอักษร" value={b.body.fontSize} onChange={(v) => setB({ fontSize: v ?? 9.5 })} min={5} max={40} step={0.5} suffix="pt" /><Num label="ความสูงบรรทัด" value={b.body.lineHeight} onChange={(v) => setB({ lineHeight: v ?? 1.15 })} min={0.8} max={3} step={0.05} /></div>
        <Field label="สีตัวอักษร"><ColorInput value={b.body.color} swatches={PDF_SWATCHES} onChange={(v) => setB({ color: v ?? '#111827' })} /></Field>
        <Toggle checked={!!b.body.zebra} onChange={(v) => setB({ zebra: v ? '#F3F4F6' : null })} label="สลับสีแถว" />
        {b.body.zebra && <Field label="สีแถวสลับ"><ColorInput value={b.body.zebra} swatches={['#F3F4F6', '#EEF2FF', '#ECFDF5', '#FEF9C3', '#FFE4E6']} onChange={(v) => setB({ zebra: v })} /></Field>}
        <div className="grid grid-cols-3 gap-2"><Field label="สีเส้น"><ColorInput value={b.border.color} swatches={['#D1D5DB', '#9CA3AF', '#111827']} onChange={(v) => onChange({ border: { ...b.border, color: v ?? '#D1D5DB' } })} /></Field><Num label="หนาเส้น" value={b.border.width} onChange={(v) => onChange({ border: { ...b.border, width: v ?? 0.5 } })} min={0} max={5} step={0.1} /><Num label="ระยะใน" value={b.padding} onChange={(v) => onChange({ padding: v ?? 3 })} min={0} max={10} step={0.5} suffix="mm" /></div>
        <Toggle checked={b.showRowNumber} onChange={(v) => onChange({ showRowNumber: v })} label="แสดงลำดับแถว (#)" />
        {cols.some((c) => c.dataType === 'image') && <div className="grid grid-cols-2 gap-2"><Num label="ขนาดรูปในเซลล์" value={b.imageSizeMm} onChange={(v) => onChange({ imageSizeMm: v ?? 18 })} min={5} max={100} suffix="mm" /><Num label="รูปสูงสุดต่อเซลล์" value={b.maxImagesPerCell} onChange={(v) => onChange({ maxImagesPerCell: v ?? 3 })} min={1} max={20} /></div>}
      </Group>
      <Group title="แถวสรุปท้ายตาราง">
        {b.summary.map((s, i) => (
          <div key={i} className="grid grid-cols-[1fr_92px_auto] gap-1.5">
            <Select value={s.columnId} className="[&>select]:!h-8 [&>select]:text-xs" onChange={(e) => onChange({ summary: b.summary.map((x, j) => (j === i ? { ...x, columnId: e.target.value } : x)) })}>{b.columns.map((c) => <option key={c.columnId} value={c.columnId}>{c.header || c.columnName}</option>)}</Select>
            <Select value={s.agg} className="[&>select]:!h-8 [&>select]:text-xs" onChange={(e) => onChange({ summary: b.summary.map((x, j) => (j === i ? { ...x, agg: e.target.value as Agg } : x)) })}><option value="sum">ผลรวม</option><option value="avg">เฉลี่ย</option><option value="count">จำนวน</option><option value="min">ต่ำสุด</option><option value="max">สูงสุด</option></Select>
            <button onClick={() => onChange({ summary: b.summary.filter((_, j) => j !== i) })} className="text-muted hover:text-danger"><X className="h-4 w-4" /></button>
          </div>
        ))}
        <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} disabled={!b.columns.length} onClick={() => onChange({ summary: [...b.summary, { columnId: (numeric.find((c) => b.columns.some((x) => x.columnId === c.id)) ?? { id: b.columns[0].columnId }).id, agg: 'sum' }] })}>เพิ่มแถวสรุป</Button>
        {b.summary.length > 0 && <Field label="ข้อความหน้าแถวสรุป"><TextInput value={b.summaryLabel} onChange={(e) => onChange({ summaryLabel: e.target.value })} /></Field>}
      </Group>
    </div>
  );
}

/* ---------------- fields (per-row form) ---------------- */
export function FieldsForm({ b, onChange, columns }: { b: FieldsBlock; onChange: (p: Partial<FieldsBlock>) => void; columns: Column[] }) {
  return (
    <div className="space-y-4">
      <Field label="ฟิลด์ที่แสดง"><ColumnPicker cols={b.columns} available={columns} onChange={(c) => onChange({ columns: c })} /></Field>
      <Field label="จำนวนช่องต่อบรรทัด"><Segmented size="sm" value={String(b.perRow) as '1'} onChange={(v) => onChange({ perRow: Number(v) as 1 | 2 | 3 })} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} /></Field>
      <Group title="ชื่อฟิลด์"><StyleForm s={b.label} onChange={(label) => onChange({ label })} compact /></Group>
      <Group title="ค่า"><StyleForm s={b.value} onChange={(value) => onChange({ value })} compact /></Group>
      <Toggle checked={!!b.border} onChange={(v) => onChange({ border: v ? { color: '#E5E7EB', width: 0.5 } : null })} label="เส้นกรอบช่อง" />
      <Num label="ขนาดรูปในฟิลด์" value={b.imageSizeMm} onChange={(v) => onChange({ imageSizeMm: v ?? 30 })} min={5} max={120} suffix="mm" />
    </div>
  );
}

export const BLOCK_TYPES_BODY: BlockType[] = ['text', 'image', 'table', 'fields', 'columns', 'line', 'spacer', 'pageBreak'];
export const BLOCK_TYPES_SIDE: BlockType[] = ['text', 'image', 'columns', 'line', 'spacer'];
void Checkbox;
