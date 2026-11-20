import { useEffect, useState } from 'react';
import { Merge, Plus, ScanLine, Trash2 } from 'lucide-react';
import type { LinesCfg, MixCfg, ScanProfile, SheetSettings, TimeLinkCfg } from '@/api/endpoints';
import { TimeLinksForm } from '../trace/TimeLinksForm';
import { traceApi } from '../trace/api';
import { LinesForm } from '../lines/LinesForm';
import { VerifyEditor } from './VerifyEditor';
import { toast } from '@/store/ui';
import type { Column } from '@/types';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextInput, Toggle } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { linesApi, scanApi, splitScan } from './api';
import { sheetsApi } from '@/api/endpoints';

const newProfile = (): ScanProfile => ({ id: Math.random().toString(36).slice(2, 10), name: 'รูปแบบใหม่', delimiter: '|', match: null, fields: [], action: 'create', keyColumnId: null, onMiss: 'reject' });
const num = (c: Column) => c.dataType === 'int' || c.dataType === 'float';

/** Managers: QR formats (which piece goes to which column, the separator) and the mix rules (which column the weight is cut from) */
export function ScanMixSettings({ open, onClose, sheetId, columns, settings, onSaved, fileId, fileName }: {
  open: boolean; onClose: () => void; sheetId: string; columns: Column[]; settings: SheetSettings | undefined; onSaved: () => void; fileId: string; fileName: string;
}) {
  const [tab, setTab] = useState<'scan' | 'mix' | 'lines' | 'time'>('scan');
  const [timeLinks, setTimeLinks] = useState<TimeLinkCfg[]>([]);
  const [lines, setLines] = useState<LinesCfg | null>(null);
  const [profiles, setProfiles] = useState<ScanProfile[]>([]);
  const [mix, setMix] = useState<MixCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState(false);
  useEffect(() => { if (open) { setSingle(!!settings?.singleRow); setProfiles(structuredClone(settings?.scanProfiles ?? [])); setMix(settings?.mix ? structuredClone(settings.mix) : null); setLines(settings?.lines ? structuredClone(settings.lines) : null); setTimeLinks(structuredClone(settings?.timeLinks ?? [])); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setBusy(true);
    try {
      if (single !== !!settings?.singleRow) await sheetsApi.saveSettings(sheetId, { singleRow: single });
      await scanApi.saveProfiles(sheetId, profiles);
      await scanApi.saveMix(sheetId, mix?.deductColumnId ? mix : null);
      await linesApi.save(sheetId, lines?.lineSheetId ? lines : null);
      await traceApi.saveTimeLinks(sheetId, timeLinks.filter((t) => t.targetSheetId && t.aStartColumnId && t.bStartColumnId));
      toast.success('บันทึกการตั้งค่าสแกน/ผสมแล้ว'); onSaved(); onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<ScanLine className="h-5 w-5" />} title="ตั้งค่าสแกน QR / การผสม ของชีตนี้"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={save} loading={busy}>บันทึก</Button></>}>
      <div className="space-y-4">
        <Toggle checked={single} onChange={setSingle} label={<span><b>ชีตนี้เก็บได้แถวเดียว</b> (1 ไฟล์ = 1 เอกสาร) <span className="text-xs text-muted">— เพิ่มแถวที่ 2 ไม่ได้ ถ้าจะทำเอกสารใหม่ให้ทำสำเนาไฟล์</span></span>} />
        <Segmented value={tab} onChange={setTab} options={[{ value: 'scan', label: 'รูปแบบ QR' }, { value: 'mix', label: 'การผสม / ตัดน้ำหนัก' }, { value: 'lines', label: 'รายการในแถว (รถเข็น)' }, { value: 'time', label: 'เชื่อมตามเวลา (ย้อนรอย)' }]} />
        {tab === 'scan' ? (
          <div className="space-y-3">
            <p className="text-xs text-muted">กำหนดได้หลายรูปแบบ — ตอนสแกนระบบเลือกรูปแบบที่ตรงกับข้อความให้เอง (ดูจากเงื่อนไขที่ตั้ง เช่น ขึ้นต้นด้วย / จำนวนชุดข้อมูล)</p>
            {profiles.map((p, i) => <ProfileCard key={p.id} p={p} columns={columns} fileId={fileId} fileName={fileName} onChange={(np) => setProfiles(profiles.map((x, k) => (k === i ? np : x)))} onRemove={() => setProfiles(profiles.filter((_, k) => k !== i))} />)}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setProfiles([...profiles, newProfile()])}>เพิ่มรูปแบบ QR</Button>
          </div>
        ) : tab === 'mix' ? <MixForm columns={columns} mix={mix} onChange={setMix} /> : tab === 'lines' ? <LinesForm cfg={lines} onChange={setLines} fileId={fileId} fileName={fileName} /> : <TimeLinksForm links={timeLinks} onChange={setTimeLinks} columns={columns} />}
      </div>
    </Modal>
  );
}

function ProfileCard({ p, columns, onChange, onRemove, fileId, fileName }: { p: ScanProfile; columns: Column[]; onChange: (p: ScanProfile) => void; onRemove: () => void; fileId: string; fileName: string }) {
  const [sample, setSample] = useState('');
  const pieces = sample ? splitScan(sample, p.delimiter) : [];
  const rows = Math.max(pieces.length, ...p.fields.map((f) => f.index), 5);
  const colOf = (idx: number) => p.fields.find((f) => f.index === idx)?.columnId ?? '';
  const setCol = (idx: number, columnId: string) => {
    const rest = p.fields.filter((f) => f.index !== idx);
    onChange({ ...p, fields: columnId ? [...rest, { index: idx, columnId }].sort((a, b) => a.index - b.index) : rest });
  };
  const mapped = p.fields.map((f) => f.columnId);
  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <div className="grid gap-2 md:grid-cols-[1fr_8rem_auto]">
        <Field label="ชื่อรูปแบบ"><TextInput value={p.name} onChange={(e) => onChange({ ...p, name: e.target.value })} /></Field>
        <Field label="ตัวคั่น" hint="เช่น |  ,  ;  หรือ \t (แท็บ)"><TextInput value={p.delimiter} onChange={(e) => onChange({ ...p, delimiter: e.target.value })} className="font-mono" /></Field>
        <button type="button" onClick={onRemove} className="mt-6 rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger" title="ลบรูปแบบ"><Trash2 className="h-4 w-4" /></button>
      </div>
      <Field label="ตัวอย่างข้อความจาก QR" hint="วางตัวอย่างเพื่อดูว่าแต่ละชุดคืออะไร แล้วเลือกว่าชุดไหนไปคอลัมน์ไหน">
        <TextInput value={sample} onChange={(e) => setSample(e.target.value)} className="font-mono" placeholder="14L11DFF | BATCH123 | 12345 | 25 | KG." />
      </Field>
      <div className="overflow-hidden rounded-lg border border-line">
        {Array.from({ length: rows }, (_, k) => k + 1).map((idx) => (
          <div key={idx} className="grid grid-cols-[4.5rem_1fr_1.4fr] items-center gap-2 border-b border-line px-2 py-1 last:border-0">
            <span className="text-xs text-muted">ชุดที่ {idx}</span>
            <span className="truncate font-mono text-sm">{pieces[idx - 1] ?? <span className="text-muted">—</span>}</span>
            <Select value={colOf(idx)} onChange={(e) => setCol(idx, e.target.value)} className="!h-8">
              <option value="">ไม่ใช้</option>
              {columns.map((c) => <option key={c.id} value={c.id} disabled={mapped.includes(c.id) && colOf(idx) !== c.id}>{c.name}</option>)}
            </Select>
          </div>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        <Field label="เมื่อสแกน">
          <Select value={p.action} onChange={(e) => onChange({ ...p, action: e.target.value as 'create' | 'update', keyColumnId: e.target.value === 'update' ? p.keyColumnId ?? p.fields[0]?.columnId ?? null : null })}>
            <option value="create">เพิ่มแถวใหม่</option><option value="update">อัปเดตแถวที่มีอยู่</option>
          </Select>
        </Field>
        {p.action === 'update' && (
          <>
            <Field label="หาแถวจากคอลัมน์" hint="ต้องเป็นคอลัมน์ที่รับข้อมูลชุดใดชุดหนึ่งข้างบน">
              <Select value={p.keyColumnId ?? ''} onChange={(e) => onChange({ ...p, keyColumnId: e.target.value || null })}>
                <option value="">— เลือก —</option>{columns.filter((c) => mapped.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="ถ้าไม่พบแถว">
              <Select value={p.onMiss ?? 'reject'} onChange={(e) => onChange({ ...p, onMiss: e.target.value as 'create' | 'reject' })}>
                <option value="reject">แจ้งว่าไม่พบ</option><option value="create">เพิ่มแถวใหม่</option>
              </Select>
            </Field>
          </>
        )}
      </div>
      <VerifyEditor p={p} columns={columns} onChange={onChange} fileId={fileId} fileName={fileName} />
      {p.action === 'update' && <StampsEditor p={p} columns={columns} onChange={onChange} />}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">เงื่อนไขเลือกรูปแบบอัตโนมัติ (เมื่อมีหลายรูปแบบ)</summary>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <Field label="ขึ้นต้นด้วย"><TextInput value={p.match?.prefix ?? ''} onChange={(e) => onChange({ ...p, match: { ...p.match, prefix: e.target.value || null } })} placeholder="เช่น 14M" /></Field>
          <Field label="จำนวนชุดข้อมูลพอดี"><TextInput type="number" min={1} value={p.match?.fieldCount ?? ''} onChange={(e) => onChange({ ...p, match: { ...p.match, fieldCount: e.target.value ? Number(e.target.value) : null } })} /></Field>
          <Field label="Regex (ขั้นสูง)"><TextInput value={p.match?.regex ?? ''} onChange={(e) => onChange({ ...p, match: { ...p.match, regex: e.target.value || null } })} className="font-mono" /></Field>
        </div>
      </details>
    </div>
  );
}

/** Time stamps in order: every scan of the same card fills the next empty time column (in → out …) */
function StampsEditor({ p, columns, onChange }: { p: ScanProfile; columns: Column[]; onChange: (p: ScanProfile) => void }) {
  const stamps = p.stamps ?? [];
  const times = columns.filter((c) => c.dataType === 'datetime' || c.dataType === 'date');
  const toggle = (id: string) => {
    const next = stamps.includes(id) ? stamps.filter((x) => x !== id) : [...stamps, id].slice(0, 6);
    onChange({ ...p, stamps: next.length ? next : null, onFull: next.length ? p.onFull ?? 'ignore' : null });
  };
  return (
    <div className="space-y-2 rounded-lg bg-primary/[.04] p-2.5">
      <p className="text-xs font-medium">ลงเวลาตามลำดับเมื่อสแกนซ้ำ (เช่น เข้า → ออก)</p>
      <p className="text-[11px] text-muted">เลือกคอลัมน์เวลาตามลำดับที่ต้องการ — สแกนครั้งที่ 1 ลงเวลาในคอลัมน์ที่ 1, ครั้งที่ 2 (การ์ดใบเดิม) ลงในคอลัมน์ที่ 2 … ใช้แถวล่าสุดของการ์ดใบนั้น</p>
      <div className="flex flex-wrap gap-1.5">
        {times.map((c) => {
          const i = stamps.indexOf(c.id);
          return <button key={c.id} type="button" onClick={() => toggle(c.id)} className={`rounded-full border px-2.5 py-0.5 text-xs ${i >= 0 ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:border-primary/50'}`}>{i >= 0 ? `${i + 1}. ` : ''}{c.name}</button>;
        })}
        {!times.length && <span className="text-xs text-muted">ชีตนี้ยังไม่มีคอลัมน์วันที่/เวลา</span>}
      </div>
      {stamps.length > 0 && (
        <Field label="เมื่อลงเวลาครบทุกคอลัมน์แล้วสแกนอีก">
          <Select value={p.onFull ?? 'ignore'} onChange={(e) => onChange({ ...p, onFull: e.target.value as 'ignore' | 'reject' | 'new_row' })}>
            <option value="ignore">ไม่ทำอะไร</option><option value="reject">แจ้งว่าครบแล้ว</option><option value="new_row">เริ่มรอบใหม่ (เพิ่มแถวใหม่ เก็บแถวเดิมไว้)</option>
          </Select>
        </Field>
      )}
    </div>
  );
}

function MixForm({ columns, mix, onChange }: { columns: Column[]; mix: MixCfg | null; onChange: (m: MixCfg | null) => void }) {
  const set = (p: Partial<MixCfg>) => mix && onChange({ ...mix, ...p });
  const chips = (key: 'inheritColumnIds' | 'sameColumnIds', title: string, hint: string) => (
    <div>
      <p className="text-xs font-medium text-muted">{title}</p><p className="mb-1 text-[11px] text-muted">{hint}</p>
      <div className="flex flex-wrap gap-1.5">
        {columns.filter((c) => c.id !== mix?.deductColumnId).map((c) => {
          const on = !!mix?.[key]?.includes(c.id);
          return <button key={c.id} type="button" onClick={() => set({ [key]: on ? (mix?.[key] ?? []).filter((x) => x !== c.id) : [...(mix?.[key] ?? []), c.id] })}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:border-primary/50'}`}>{c.name}</button>;
        })}
      </div>
    </div>
  );
  return (
    <div className="space-y-3">
      <Toggle checked={!!mix} onChange={(v) => onChange(v ? { deductColumnId: columns.find(num)?.id ?? '', keyColumnId: null, inheritColumnIds: [], sameColumnIds: [] } : null)} label={<span className="font-semibold"><Merge className="mr-1 inline h-4 w-4" />เปิดใช้การผสมในชีตนี้</span>} />
      {mix && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="ตัดน้ำหนักจากคอลัมน์" hint="ตอนผสม จำนวนที่ใช้จะถูกหักออกจากคอลัมน์นี้ของแถวต้นทาง และผลรวมไปใส่ในคอลัมน์เดียวกันของล็อตใหม่">
              <Select value={mix.deductColumnId} onChange={(e) => set({ deductColumnId: e.target.value })}>
                <option value="">— เลือกคอลัมน์ตัวเลข —</option>{columns.filter(num).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="คอลัมน์ที่ใช้หาแถวตอนสแกน/พิมพ์" hint="เช่น mapping_id">
              <Select value={mix.keyColumnId ?? ''} onChange={(e) => set({ keyColumnId: e.target.value || null })}>
                <option value="">— ไม่ใช้ (เลือกจากแถวที่ติ๊กเท่านั้น) —</option>{columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          </div>
          {chips('inheritColumnIds', 'คัดลอกจากแถวแรกไปยังล็อตใหม่', 'เช่น ชนิดวัตถุดิบ — คอลัมน์เลขที่อัตโนมัติ (mapping_id) จะออกเลขใหม่ให้เอง')}
          {chips('sameColumnIds', 'ต้องมีค่าเท่ากันทุกแถวที่นำมาผสม', 'ถ้าต่างกันระบบจะไม่ให้ผสม (ว่างไว้ = ผสมข้ามอะไรก็ได้)')}
        </>
      )}
    </div>
  );
}
