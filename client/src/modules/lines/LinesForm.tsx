import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { filesApi, type LinesCfg } from '@/api/endpoints';
import { loadCols } from '@/lib/dashCols';
import type { Column, Sheet } from '@/types';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput, Toggle, Segmented } from '@/components/ui/Inputs';
import { FilePicker, PickedFile } from '@/components/files/FilePicker';

/** Settings: which sheet holds the line items of each row of this sheet (a trolley and the materials on it), what to show, and one-click actions for all lines */
export function LinesForm({ cfg, onChange, fileId, fileName }: { cfg: LinesCfg | null; onChange: (c: LinesCfg | null) => void; fileId: string; fileName: string }) {
  const [picked, setPicked] = useState<PickedFile | null>({ id: fileId, name: fileName, path: 'ไฟล์นี้' });
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [cols, setCols] = useState<Column[]>([]);
  useEffect(() => {
    if (!picked) return;
    let live = true;
    filesApi.get(picked.id).then((r) => live && setSheets(r.sheets)).catch(() => live && setSheets([]));
    return () => { live = false; };
  }, [picked]);
  useEffect(() => {
    let live = true;
    if (cfg?.lineSheetId) void loadCols(cfg.lineSheetId).then((c) => live && setCols(c.filter((x) => !x.isDeleted))).catch(() => live && setCols([]));
    else setCols([]);
    return () => { live = false; };
  }, [cfg?.lineSheetId]);
  const set = (p: Partial<LinesCfg>) => cfg && onChange({ ...cfg, ...p });
  const actions = cfg?.actions ?? [];
  return (
    <div className="space-y-3">
      <Toggle checked={!!cfg} onChange={(v) => onChange(v ? { lineSheetId: '', displayColumnIds: [], actions: [] } : null)} label={<span className="font-semibold">แต่ละแถวของชีตนี้มีรายการย่อย (เช่น รถเข็น 1 คัน มีหลายวัตถุดิบ)</span>} />
      {cfg && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="ไฟล์ของชีตรายการ"><FilePicker value={picked} onChange={(f) => { setPicked(f); set({ lineSheetId: '', displayColumnIds: [], actions: [] }); }} /></Field>
            <Field label="ชีตรายการ" hint="1 แถวในชีตนั้น = 1 รายการบนแถวของชีตนี้">
              <Select value={cfg.lineSheetId} onChange={(e) => set({ lineSheetId: e.target.value, displayColumnIds: [], actions: [] })}>
                <option value="">— เลือกชีต —</option>{sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          {cfg.lineSheetId && (
            <>
              <Field label="วิธีเพิ่มรายการ" hint={cfg.entry === 'form' ? 'เหมาะกับเอกสารที่มีหัว + หลายบรรทัด เช่น ใบตรวจ Metal Detector: กรอกฟอร์มทีละรายการ ช่องที่ชื่อตรงกับหัวเอกสารเติมให้เอง' : 'เหมาะกับรถเข็น / พาเลท: สแกน QR ของวัตถุดิบเพื่อใส่ลงในแถว'}>
                <Segmented size="sm" value={cfg.entry === 'form' ? 'form' : 'scan'} onChange={(v) => set({ entry: v })}
                  options={[{ value: 'scan', label: 'สแกน QR' }, { value: 'form', label: 'กรอกฟอร์ม' }]} />
              </Field>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">คอลัมน์ของรายการที่แสดงในหน้าต่าง (สูงสุด 12)</p>
                <div className="flex flex-wrap gap-1.5">
                  {cols.map((c) => {
                    const on = !!cfg.displayColumnIds?.includes(c.id);
                    return <button key={c.id} type="button" onClick={() => set({ displayColumnIds: on ? (cfg.displayColumnIds ?? []).filter((x) => x !== c.id) : [...(cfg.displayColumnIds ?? []), c.id].slice(0, 12) })}
                      className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:border-primary/50'}`}>{c.name}</button>;
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted">ปุ่มทำพร้อมกันทุกรายการ (เช่น “ออกห้องเย็น” ลงเวลาปัจจุบันให้ทุกวัตถุดิบบนรถเข็น)</p>
                {actions.map((a, i) => (
                  <div key={i} className="grid gap-2 md:grid-cols-[1fr_1fr_8rem_1fr_auto]">
                    <TextInput value={a.label} placeholder="ชื่อปุ่ม" onChange={(e) => set({ actions: actions.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} />
                    <Select value={a.columnId} onChange={(e) => set({ actions: actions.map((x, k) => (k === i ? { ...x, columnId: e.target.value } : x)) })}>
                      <option value="">— คอลัมน์ที่จะเขียน —</option>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                    <Select value={a.kind} onChange={(e) => set({ actions: actions.map((x, k) => (k === i ? { ...x, kind: e.target.value as 'now' | 'value' } : x)) })}>
                      <option value="now">เวลาปัจจุบัน</option><option value="value">ค่าคงที่</option>
                    </Select>
                    <TextInput value={a.value ?? ''} disabled={a.kind !== 'value'} placeholder="ค่า" onChange={(e) => set({ actions: actions.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) })} />
                    <button type="button" onClick={() => set({ actions: actions.filter((_, k) => k !== i) })} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
                <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} disabled={actions.length >= 10} onClick={() => set({ actions: [...actions, { label: '', columnId: '', kind: 'now', value: null }] })}>เพิ่มปุ่ม</Button>
              </div>
              <p className="text-xs text-muted">เพิ่มรายการโดยสแกน QR ของรายการ (ใช้รูปแบบ QR ที่ตั้งไว้ในชีตรายการ) หรือเลือกแถวที่มีอยู่ — รายการอยู่ได้ที่แถวเดียว ถ้าย้ายไปแถวอื่นระบบจะย้ายให้และบันทึกประวัติ</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
