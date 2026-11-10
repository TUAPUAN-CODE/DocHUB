import { ReactNode, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronUp, Copy, Lock, Plus, Trash2, Unlock, Upload, X } from 'lucide-react';
import { filesApi, uploadsApi } from '@/api/endpoints';
import { cn } from '@/lib/cn';
import { isDateish } from '@/lib/columnTypes';
import { loadCols } from '@/lib/dashCols';
import { FONTS } from '@/lib/fonts';
import { toast } from '@/store/ui';
import type { Agg, Column, DataSource, Sheet, Widget } from '@/types';
import { Button } from '../ui/Button';
import { Field, Segmented, Select, TextArea, TextInput, Toggle } from '../ui/Inputs';
import { ColorInput } from '../ui/misc';
import { FilePicker, PickedFile } from '../files/FilePicker';
import { ChartFormat, ChartAnalytics } from './ChartFormat';
import { useDash } from './dashContext';
import { COMPARE_OPS, SLICER_MODES } from './SpecialBodies';
import { CHART_TYPES, DATA_TYPES_W, needsX, PALETTE, WIDGETS } from './widgets';

const AGGS: { v: Agg; label: string }[] = [
  { v: 'sum', label: 'ผลรวม' }, { v: 'avg', label: 'ค่าเฉลี่ย' }, { v: 'count', label: 'นับจำนวน' }, { v: 'count_distinct', label: 'นับค่าไม่ซ้ำ' },
  { v: 'min', label: 'ต่ำสุด' }, { v: 'max', label: 'สูงสุด' },
];
const isNum = (c: Column) => c.dataType === 'int' || c.dataType === 'float';

function useCols(sheetId: string | undefined) {
  const [cols, setCols] = useState<Column[]>([]);
  useEffect(() => { let live = true; if (sheetId) void loadCols(sheetId).then((c) => live && setCols(c)); else setCols([]); return () => { live = false; }; }, [sheetId]);
  return cols;
}

/** File + sheet chooser. The file may be any file the user can read (data from a different path/folder). */
function SourcePicker({ ds, setDs, fileId, fileName, fileSheets, srcFile, setSrcFile, resetSeries }: {
  ds: DataSource; setDs: (p: Partial<DataSource>) => void; fileId: string; fileName: string; fileSheets: Sheet[]; srcFile: string;
  setSrcFile: (id: string | undefined) => void; resetSeries: DataSource['series'];
}) {
  const [sheets, setSheets] = useState<Sheet[]>(fileSheets);
  const [picked, setPicked] = useState<PickedFile | null>({ id: srcFile, name: srcFile === fileId ? fileName : '…', path: srcFile === fileId ? 'ไฟล์ปัจจุบัน' : '' });
  useEffect(() => { if (srcFile === fileId) { setPicked({ id: fileId, name: fileName, path: 'ไฟล์ปัจจุบัน' }); return; } filesApi.get(srcFile).then((r) => setPicked({ id: srcFile, name: r.file.name, path: r.breadcrumb.map((c) => c.name).join(' / ') })).catch(() => undefined); }, [srcFile, fileId, fileName]);
  useEffect(() => { if (srcFile === fileId) setSheets(fileSheets); else filesApi.get(srcFile).then((r) => setSheets(r.sheets)).catch(() => setSheets([])); }, [srcFile, fileId, fileSheets]);
  return (
    <>
      <Field label="ไฟล์ข้อมูล" hint="เลือกจากโฟลเดอร์ → โฟลเดอร์ย่อย → ไฟล์ หรือค้นหาชื่อ">
        <FilePicker value={picked} placeholder={fileName} extra={[{ id: fileId, name: fileName, path: 'ไฟล์ปัจจุบัน' }]}
          onChange={async (f) => {
            const r = await filesApi.get(f.id).catch(() => null);
            if (!r?.sheets.length) return toast.error('ไฟล์นี้ไม่มีชีตที่อ่านได้');
            setPicked(f);
            setSrcFile(f.id === fileId ? undefined : f.id);
            setDs({ sheetId: r.sheets[0].id, xColumnId: null, groupByColumnId: null, series: resetSeries, filters: [] });
          }} />
      </Field>
      <Field label="ชีต">
        <Select value={ds.sheetId} onChange={(e) => setDs({ sheetId: e.target.value, xColumnId: null, groupByColumnId: null, series: resetSeries, filters: [] })}>
          {sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
    </>
  );
}

function FilterEditor({ ds, setDs, cols }: { ds: DataSource; setDs: (p: Partial<DataSource>) => void; cols: Column[] }) {
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-medium">กรองข้อมูล</p>
      {(ds.filters ?? []).map((f, i) => (
        <div key={i} className="mb-1.5 flex gap-1.5">
          <Select value={f.columnId} className="min-w-0 flex-1" onChange={(e) => setDs({ filters: ds.filters!.map((x, j) => (j === i ? { ...x, columnId: e.target.value } : x)) })}>
            {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={f.op ?? 'eq'} className="w-24 shrink-0" onChange={(e) => setDs({ filters: ds.filters!.map((x, j) => (j === i ? { ...x, op: e.target.value as any } : x)) })}>
            {[['eq', '='], ['neq', '≠'], ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['contains', 'มีคำ'], ['not_empty', 'ไม่ว่าง'], ['is_empty', 'ว่าง']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {!['is_empty', 'not_empty'].includes(f.op ?? '') && <TextInput value={f.value ?? ''} className="!w-24" type={isDateish(cols.find((c) => c.id === f.columnId)?.dataType ?? 'varchar') ? 'date' : 'text'}
            onChange={(e) => setDs({ filters: ds.filters!.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />}
          <button onClick={() => setDs({ filters: ds.filters!.filter((_, j) => j !== i) })} className="px-1 text-muted hover:text-danger" aria-label="ลบตัวกรอง"><X className="h-4 w-4" /></button>
        </div>
      ))}
      {cols.length > 0 && <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDs({ filters: [...(ds.filters ?? []), { columnId: cols[0].id, op: 'eq', value: '' }] })}>เพิ่มตัวกรอง</Button>}
    </div>
  );
}

/** Ticks columns in sheet order; `max` keeps the first N picked */
function ColumnChecks({ cols, value, onChange, max }: { cols: Column[]; value: string[]; onChange: (ids: string[]) => void; max?: number }) {
  return (
    <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-line p-1.5">
      {!cols.length && <p className="px-1 py-2 text-xs text-muted">ไม่มีคอลัมน์ที่ใช้ได้</p>}
      {cols.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-sm hover:bg-ink/5">
          <input type="checkbox" checked={value.includes(c.id)} onChange={(e) => {
            const next = e.target.checked ? cols.filter((x) => value.includes(x.id) || x.id === c.id).map((x) => x.id) : value.filter((id) => id !== c.id);
            onChange(max ? next.slice(0, max) : next);
          }} />
          <span className="truncate">{c.name}</span>
        </label>
      ))}
    </div>
  );
}

/** "ค้นหารายละเอียด" and "Rev ล่าสุด": a sheet, plus (records) which columns are searched / shown */
function RecordsDataTab({ w, set, ds, setDs, cols, fileId, fileName, fileSheets, srcFile, setSrcFile }: {
  w: Widget; set: (p: Partial<Widget>) => void; ds: DataSource; setDs: (p: Partial<DataSource>) => void; cols: Column[];
  fileId: string; fileName: string; fileSheets: Sheet[]; srcFile: string; setSrcFile: (v: string | undefined) => void;
}) {
  const c = w.config;
  const setC = (p: Record<string, unknown>) => set({ config: { ...c, ...p } });
  const textual = cols.filter((x) => ['varchar', 'text', 'int', 'select', 'doc_number', 'email', 'url'].includes(x.dataType));
  const shown = cols.filter((x) => x.dataType !== 'image');
  const images = cols.filter((x) => x.dataType === 'image');
  return (
    <div className="space-y-4">
      <SourcePicker ds={ds} setDs={setDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} srcFile={srcFile} setSrcFile={setSrcFile} resetSeries={[{ columnId: null, aggregation: 'count' }]} />
      {w.type === 'revision' ? (
        <Num label="แสดงรายการเปลี่ยนแปลงสูงสุด (ต่อหมวด)" value={c.limit ?? 10} onChange={(v) => setC({ limit: v })} min={1} max={200} />
      ) : (
        <>
          <Field label="ค้นหาจากคอลัมน์" hint="เช่น Sub Doc No. และ Short Code (ไม่เลือก = ค้นทุกคอลัมน์)"><ColumnChecks cols={textual} value={c.searchColumnIds ?? []} onChange={(v) => setC({ searchColumnIds: v })} /></Field>
          <Field label="หัวข้อการ์ด (สูงสุด 3)" hint="อันแรกเป็นหัวข้อใหญ่ (แถวที่ค่าซ้ำกันรวมเป็นการ์ดเดียว) ที่เหลือเป็นป้ายย่อย เช่น Short Code"><ColumnChecks cols={shown} value={c.titleColumnIds ?? []} onChange={(v) => setC({ titleColumnIds: v })} max={3} /></Field>
          <Field label="รายละเอียดที่แสดง"><ColumnChecks cols={shown} value={c.fieldColumnIds ?? []} onChange={(v) => setC({ fieldColumnIds: v })} /></Field>
          <Field label="คอลัมน์รูปภาพ">
            <Select value={c.imageColumnId ?? ''} onChange={(e) => setC({ imageColumnId: e.target.value || null })}>
              <option value="">— ไม่แสดงรูป —</option>
              {images.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Field label="ข้อความในช่องค้นหา"><TextInput value={c.placeholder ?? ''} onChange={(e) => setC({ placeholder: e.target.value })} placeholder="ค้นหา Sub Doc No. / Short Code" /></Field>
          <Num label="แสดงทีละ (รายการ)" value={c.pageSize ?? 20} onChange={(v) => setC({ pageSize: v })} min={5} max={200} />
          <Toggle checked={c.showRev !== false} onChange={(v) => setC({ showRev: v })} label="บอกว่าแถวไหนแก้ไข / เพิ่มใน Rev ล่าสุด" />
          <FilterEditor ds={ds} setDs={setDs} cols={cols} />
        </>
      )}
    </div>
  );
}

/** One aggregated number: "sum of column X" – used by the KPI-like widgets (card value, condition A / B) */
function ValueSource({ w, set, ds, onDs, fileId, fileName, fileSheets, fileKey }: {
  w: Widget; set: (p: Partial<Widget>) => void; ds: DataSource; onDs: (p: Partial<DataSource>) => void; fileId: string; fileName: string; fileSheets: Sheet[]; fileKey: string;
}) {
  const cols = useCols(ds.sheetId);
  const num = cols.filter(isNum);
  const s = ds.series[0];
  const reset: DataSource['series'] = [{ columnId: null, aggregation: 'sum' }];
  return (
    <div className="space-y-3">
      <SourcePicker ds={ds} setDs={onDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} srcFile={w.config[fileKey] ?? fileId} resetSeries={reset}
        setSrcFile={(v) => set({ config: { ...w.config, [fileKey]: v } })} />
      <div className="flex gap-1.5">
        <Select value={s.aggregation} className="w-32 shrink-0" onChange={(e) => onDs({ series: [{ ...s, aggregation: e.target.value as Agg, columnId: e.target.value === 'count' ? s.columnId : s.columnId ?? num[0]?.id ?? null }] })}>
          {AGGS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
        </Select>
        <Select value={s.columnId ?? ''} className="min-w-0 flex-1" onChange={(e) => onDs({ series: [{ ...s, columnId: e.target.value || null }] })}>
          {(s.aggregation === 'count' || s.aggregation === 'count_distinct') && <option value="">ทุกแถว</option>}
          {s.aggregation !== 'count' && s.aggregation !== 'count_distinct' && !s.columnId && <option value="">— เลือกคอลัมน์ตัวเลข —</option>}
          {(s.aggregation === 'count' || s.aggregation === 'count_distinct' ? cols : num).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </div>
      <FilterEditor ds={ds} setDs={onDs} cols={cols} />
    </div>
  );
}

function DataTab({ w, fileId, fileName, fileSheets, set }: { w: Widget; fileId: string; fileName: string; fileSheets: Sheet[]; set: (p: Partial<Widget>) => void }) {
  const ds = w.dataSource!;
  const cols = useCols(ds.sheetId);
  const setDs = (p: Partial<DataSource>) => set({ dataSource: { ...ds, ...p } });
  const numeric = cols.filter(isNum);
  const xCol = cols.find((c) => c.id === ds.xColumnId);
  const t = w.type;
  const srcFile: string = w.config.sourceFileId ?? fileId;
  const setSrcFile = (v: string | undefined) => set({ config: { ...w.config, sourceFileId: v } });

  if (t === 'records' || t === 'revision') return <RecordsDataTab w={w} set={set} ds={ds} setDs={setDs} cols={cols} fileId={fileId} fileName={fileName} fileSheets={fileSheets} srcFile={srcFile} setSrcFile={setSrcFile} />;

  if (t === 'condition') {
    const b: DataSource = w.config.b ?? { ...ds, series: [{ columnId: null, aggregation: 'sum' }], filters: [] };
    return (
      <div className="space-y-5">
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold text-primary">ค่าที่ 1 (A)</p>
          <TextInput value={w.config.labelA ?? ''} onChange={(e) => set({ config: { ...w.config, labelA: e.target.value } })} placeholder="ชื่อที่แสดง เช่น ยอดผลิตจริง" className="!h-9" />
          <ValueSource w={w} set={set} ds={ds} onDs={setDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} fileKey="sourceFileId" />
        </div>
        <Field label="เงื่อนไข (ผ่านเมื่อ…)">
          <Segmented size="sm" value={w.config.op ?? 'lte'} onChange={(v) => set({ config: { ...w.config, op: v } })} options={COMPARE_OPS.map((o) => ({ value: o.v, label: o.label.replace('A', '1').replace('B', '2') }))} />
        </Field>
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm font-semibold text-primary">ค่าที่ 2 (B)</p>
          <TextInput value={w.config.labelB ?? ''} onChange={(e) => set({ config: { ...w.config, labelB: e.target.value } })} placeholder="ชื่อที่แสดง เช่น เป้าหมาย" className="!h-9" />
          <ValueSource w={w} set={set} ds={b} onDs={(p) => set({ config: { ...w.config, b: { ...b, ...p } } })} fileId={fileId} fileName={fileName} fileSheets={fileSheets} fileKey="bFileId" />
        </div>
      </div>
    );
  }

  if (t === 'card')
    return (
      <div className="space-y-3">
        <Toggle checked={!!w.config.showValue} onChange={(v) => set({ config: { ...w.config, showValue: v } })} label="แสดงตัวเลขจากตารางในการ์ด" />
        {w.config.showValue && <ValueSource w={w} set={set} ds={ds} onDs={setDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} fileKey="sourceFileId" />}
        {!w.config.showValue && <p className="text-xs text-muted">การ์ดนี้แสดงเฉพาะข้อความ ปรับหัวข้อ/รายละเอียดที่แท็บ “รูปแบบ”</p>}
      </div>
    );

  if (t === 'slicer')
    return (
      <div className="space-y-4">
        <SourcePicker ds={ds} setDs={setDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} srcFile={srcFile} setSrcFile={setSrcFile} resetSeries={[{ columnId: null, aggregation: 'count' }]} />
        <Field label="คอลัมน์ที่ใช้กรอง">
          <Select value={ds.xColumnId ?? ''} onChange={(e) => setDs({ xColumnId: e.target.value || null })}>
            <option value="">— เลือกคอลัมน์ —</option>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-muted">ตัวกรองนี้จะกรองกราฟ/ตัวเลขทุกชิ้นที่ใช้ชีตเดียวกัน (หรือเลือกเฉพาะบางชิ้นได้ที่แท็บ “รูปแบบ”)</p>
      </div>
    );

  const single = t === 'pie' || t === 'doughnut' || t === 'scatter' || t === 'kpi' || t === 'pareto' || t === 'histogram' || t === 'xchart' || t === 'xbar' || t === 'heatmap' || t === 'pct';
  const valueOnly = t === 'histogram';
  const groupable = ['bar', 'line', 'area', 'pct', 'heatmap'].includes(t) && ds.series.length === 1;
  const xLabel = t === 'scatter' ? 'แกน X (ตัวเลข)' : t === 'histogram' ? 'คอลัมน์ตัวเลข' : t === 'xchart' ? 'ลำดับ/ป้ายชื่อ (แกน X)' : t === 'xbar' ? 'กลุ่มย่อย (แกน X)' : t === 'heatmap' ? 'แถว (แกนตั้ง)' : 'แกน X / หมวดหมู่';
  return (
    <div className="space-y-4">
      <SourcePicker ds={ds} setDs={setDs} fileId={fileId} fileName={fileName} fileSheets={fileSheets} srcFile={srcFile} setSrcFile={setSrcFile}
        resetSeries={[{ columnId: null, aggregation: t === 'scatter' ? 'none' : 'count' }]} />
      {needsX(t) && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={xLabel} className={xCol && isDateish(xCol.dataType) && t !== 'histogram' ? '' : 'col-span-2'}>
            <Select value={ds.xColumnId ?? ''} onChange={(e) => setDs({ xColumnId: e.target.value || null })}>
              <option value="">— เลือกคอลัมน์ —</option>
              {(t === 'scatter' || t === 'histogram' ? numeric : cols).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          {xCol && isDateish(xCol.dataType) && t !== 'histogram' && t !== 'xchart' && (
            <Field label="จัดกลุ่มวันที่">
              <Select value={ds.xBucket ?? 'none'} onChange={(e) => setDs({ xBucket: e.target.value as DataSource['xBucket'] })}>
                <option value="none">รายวัน (ตามค่า)</option><option value="week">รายสัปดาห์</option><option value="month">รายเดือน</option><option value="quarter">รายไตรมาส</option><option value="year">รายปี</option>
              </Select>
            </Field>
          )}
        </div>
      )}
      {t === 'histogram' && <Field label="จำนวนช่วง (bins)"><TextInput inputMode="numeric" value={ds.bins ?? 10} onChange={(e) => setDs({ bins: Math.max(2, Math.min(100, Number(e.target.value) || 10)) })} /></Field>}
      {!valueOnly && (
        <div>
          <p className="mb-1.5 text-[13px] font-medium">{t === 'scatter' ? 'แกน Y (ตัวเลข)' : t === 'xchart' || t === 'xbar' ? 'ค่าที่วัด (ตัวเลข)' : t === 'heatmap' ? 'ค่าในช่อง' : 'ค่าที่แสดง'}</p>
          <div className="space-y-2">
            {ds.series.map((s, i) => {
              const spc = t === 'xchart' || t === 'xbar';
              return (
                <div key={i} className="space-y-1.5 rounded-xl border border-line p-2">
                  <div className="flex gap-1.5">
                    {t !== 'scatter' && !spc && (
                      <Select value={s.aggregation} className="w-32 shrink-0" onChange={(e) => setDs({ series: ds.series.map((x, j) => (j === i ? { ...x, aggregation: e.target.value as Agg, columnId: e.target.value === 'count' ? x.columnId : x.columnId ?? numeric[0]?.id ?? null } : x)) })}>
                        {AGGS.map((a) => <option key={a.v} value={a.v}>{a.label}</option>)}
                      </Select>
                    )}
                    <Select value={s.columnId ?? ''} className="min-w-0 flex-1" onChange={(e) => setDs({ series: ds.series.map((x, j) => (j === i ? { ...x, columnId: e.target.value || null } : x)) })}>
                      {!spc && (s.aggregation === 'count' || s.aggregation === 'count_distinct') && <option value="">ทุกแถว</option>}
                      {(spc || (s.aggregation !== 'count' && s.aggregation !== 'count_distinct')) && !s.columnId && <option value="">— เลือกคอลัมน์ตัวเลข —</option>}
                      {(!spc && (s.aggregation === 'count' || s.aggregation === 'count_distinct') ? cols : numeric).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Select>
                    {ds.series.length > 1 && <button onClick={() => setDs({ series: ds.series.filter((_, j) => j !== i) })} className="rounded-lg px-1.5 text-muted hover:text-danger" aria-label="ลบชุดข้อมูล"><X className="h-4 w-4" /></button>}
                  </div>
                  <TextInput value={s.label ?? ''} onChange={(e) => setDs({ series: ds.series.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="ชื่อที่แสดง (ไม่บังคับ)" className="!h-8 text-xs" />
                </div>
              );
            })}
            {!(single && t !== 'heatmap' && t !== 'pct') && !ds.groupByColumnId && ds.series.length < 8 && (
              <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setDs({ series: [...ds.series, { columnId: numeric[0]?.id ?? null, aggregation: numeric.length ? 'sum' : 'count' }] })}>เพิ่มชุดข้อมูล</Button>
            )}
          </div>
        </div>
      )}
      {groupable && (
        <Field label={t === 'heatmap' ? 'คอลัมน์ (แกนนอน)' : 'แยกชุดข้อมูลตาม (ไม่บังคับ)'} hint={t === 'heatmap' ? 'เช่น กะ หรือ เดือน' : 'เช่น แยกยอดผลิตตามกะ'}>
          <Select value={ds.groupByColumnId ?? ''} onChange={(e) => setDs({ groupByColumnId: e.target.value || null })}>
            <option value="">{t === 'heatmap' ? '— ใช้ชุดข้อมูลเป็นคอลัมน์ —' : '— ไม่แยก —'}</option>
            {cols.filter((c) => ['select', 'varchar', 'boolean', 'multi_select', 'date', 'int'].includes(c.dataType) && c.id !== ds.xColumnId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      )}
      {needsX(t) && !['scatter', 'histogram', 'xchart', 'xbar'].includes(t) && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="เรียงลำดับ">
            <Select value={ds.sort ?? 'x_asc'} onChange={(e) => setDs({ sort: e.target.value as DataSource['sort'] })}>
              <option value="x_asc">หมวด ก → ฮ</option><option value="x_desc">หมวด ฮ → ก</option><option value="value_desc">ค่ามาก → น้อย</option><option value="value_asc">ค่าน้อย → มาก</option>
            </Select>
          </Field>
          <Field label="แสดงสูงสุด (Top N)"><TextInput inputMode="numeric" value={ds.limit ?? 50} onChange={(e) => setDs({ limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })} /></Field>
        </div>
      )}
      <FilterEditor ds={ds} setDs={setDs} cols={cols} />
    </div>
  );
}

function Num({ label, value, onChange, min, max, step = 1 }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number }) {
  return (
    <Field label={label}>
      <TextInput inputMode="decimal" value={value ?? ''} step={step} onChange={(e) => { const v = e.target.value === '' ? undefined : Number(e.target.value); onChange(v === undefined || Number.isNaN(v) ? undefined : Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v))); }} className="!h-9" />
    </Field>
  );
}

function StyleTab({ w, set }: { w: Widget; set: (p: Partial<Widget>) => void }) {
  const c = w.config;
  const s = w.style;
  const setC = (p: Record<string, unknown>) => set({ config: { ...c, ...p } });
  const setS = (p: Record<string, unknown>) => set({ style: { ...s, ...p } });
  const [uploading, setUploading] = useState(false);
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { const r = await uploadsApi.image(file); setC({ url: r.url }); } catch (e) { toast.error(e, 'อัปโหลดไม่สำเร็จ'); } finally { setUploading(false); }
  };
  const chart = CHART_TYPES.includes(w.type);
  return (
    <div className="space-y-4">
      {!['text', 'shape', 'image', 'slicer', 'card'].includes(w.type) && (
        <>
          <Field label="หัวข้อ"><TextInput value={w.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="หัวข้อย่อย"><TextInput value={s.subtitle ?? ''} onChange={(e) => setS({ subtitle: e.target.value })} placeholder="ไม่บังคับ" /></Field>
          <Field label="จัดตำแหน่งหัวข้อ"><Segmented size="sm" value={s.titleAlign ?? 'left'} onChange={(v) => setS({ titleAlign: v })} options={[{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }]} /></Field>
          <div className="flex items-center justify-between"><Toggle checked={s.showTitle !== false} onChange={(v) => setS({ showTitle: v })} label="แสดงหัวข้อ" />
            <div className="w-24"><Num label="" value={s.titleSize ?? 15} onChange={(v) => setS({ titleSize: v })} min={10} max={40} /></div></div>
        </>
      )}
      {chart && <ChartFormat w={w} set={set} />}
      {w.type === 'slicer' && (
        <div className="space-y-3">
          <Field label="รูปแบบตัวกรอง">
            <Select value={c.mode ?? 'dropdown_search'} onChange={(e) => setC({ mode: e.target.value })}>
              {SLICER_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          {SLICER_MODES.find((m) => m.value === (c.mode ?? 'dropdown_search'))?.hint && <p className="text-xs text-muted">{SLICER_MODES.find((m) => m.value === (c.mode ?? 'dropdown_search'))?.hint}</p>}
          <Field label="ชื่อที่แสดง"><TextInput value={c.label ?? ''} onChange={(e) => setC({ label: e.target.value })} placeholder="ตามชื่อคอลัมน์" /></Field>
          <Field label="ข้อความก่อนเลือก"><TextInput value={c.placeholder ?? ''} onChange={(e) => setC({ placeholder: e.target.value })} placeholder="เลือก…" /></Field>
          <Toggle checked={c.showLabel !== false} onChange={(v) => setC({ showLabel: v })} label="แสดงชื่อตัวกรอง" />
          <div className="space-y-2 rounded-xl border border-line p-2.5">
            <p className="text-[13px] font-medium">ตัวอักษร / สี</p>
            <div className="grid grid-cols-2 gap-2">
              <Num label="ขนาดตัวอักษร" value={c.fontSize ?? 14} onChange={(v) => setC({ fontSize: v })} min={8} max={48} />
              <Num label="ขนาดชื่อตัวกรอง" value={c.labelSize ?? 12} onChange={(v) => setC({ labelSize: v })} min={8} max={48} />
              <Field label="สีตัวอักษร"><ColorInput value={c.textColor} onChange={(v) => setC({ textColor: v ?? '' })} allowEmpty /></Field>
              <Field label="สีชื่อตัวกรอง"><ColorInput value={c.labelColor} onChange={(v) => setC({ labelColor: v ?? '' })} allowEmpty /></Field>
              <Field label="สีพื้นช่อง"><ColorInput value={c.controlBg} onChange={(v) => setC({ controlBg: v ?? '' })} allowEmpty /></Field>
              <Field label="สีขอบช่อง"><ColorInput value={c.controlBorder} onChange={(v) => setC({ controlBorder: v ?? '' })} allowEmpty /></Field>
              <Num label="มุมโค้งของช่อง" value={c.radius} onChange={(v) => setC({ radius: v })} min={0} max={40} />
            </div>
          </div>
          {['dropdown_search', 'dropdown', 'list', 'chips'].includes(c.mode ?? 'dropdown_search') && <Toggle checked={c.multi !== false} onChange={(v) => setC({ multi: v })} label="เลือกได้หลายค่า" />}
          <TargetPicker w={w} set={set} />
        </div>
      )}
      {w.type === 'card' && (
        <div className="space-y-3">
          {([['Heading', 'heading', 'หัวข้อหลัก', 20], ['Subheading', 'subheading', 'หัวข้อย่อย', 14]] as const).map(([, key, label, size]) => (
            <div key={key} className="space-y-1.5 rounded-xl border border-line p-2.5">
              <Toggle checked={c[`show${key[0].toUpperCase()}${key.slice(1)}`] !== false} onChange={(v) => setC({ [`show${key[0].toUpperCase()}${key.slice(1)}`]: v })} label={`แสดง${label}`} />
              <TextInput value={c[key] ?? ''} onChange={(e) => setC({ [key]: e.target.value })} placeholder={label} />
              <div className="grid grid-cols-2 gap-2"><Num label="ขนาด" value={c[`${key}Size`] ?? size} onChange={(v) => setC({ [`${key}Size`]: v })} min={8} max={120} />
                <Field label="สี"><ColorInput value={c[`${key}Color`]} onChange={(v) => setC({ [`${key}Color`]: v ?? '' })} allowEmpty /></Field></div>
            </div>
          ))}
          <div className="space-y-1.5 rounded-xl border border-line p-2.5">
            <Toggle checked={c.showBody !== false} onChange={(v) => setC({ showBody: v })} label="แสดงรายละเอียด" />
            <TextArea rows={3} value={c.body ?? ''} onChange={(e) => setC({ body: e.target.value })} placeholder="รายละเอียด" />
            <div className="grid grid-cols-2 gap-2"><Num label="ขนาด" value={c.bodySize ?? 13} onChange={(v) => setC({ bodySize: v })} min={8} max={60} />
              <Field label="สี"><ColorInput value={c.bodyColor} onChange={(v) => setC({ bodyColor: v ?? '' })} allowEmpty /></Field></div>
          </div>
          <div className="space-y-1.5 rounded-xl border border-line p-2.5">
            <Toggle checked={!!c.showIcon} onChange={(v) => setC({ showIcon: v })} label="แสดงไอคอน / อีโมจิ" />
            {c.showIcon && <TextInput value={c.icon ?? ''} onChange={(e) => setC({ icon: e.target.value })} placeholder="เช่น 📦 🏭 ✅" />}
          </div>
          {c.showValue && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="คำนำหน้า"><TextInput value={c.prefix ?? ''} onChange={(e) => setC({ prefix: e.target.value })} className="!h-9" /></Field>
              <Field label="คำต่อท้าย"><TextInput value={c.suffix ?? ''} onChange={(e) => setC({ suffix: e.target.value })} className="!h-9" /></Field>
              <Num label="ทศนิยม" value={c.decimals ?? 0} onChange={(v) => setC({ decimals: v })} min={0} max={6} />
              <Num label="ขนาดตัวเลข" value={c.valueSize ?? 36} onChange={(v) => setC({ valueSize: v })} min={12} max={160} />
              <Field label="สีตัวเลข" className="col-span-2"><ColorInput value={c.valueColor} onChange={(v) => setC({ valueColor: v ?? '' })} allowEmpty /></Field>
            </div>
          )}
          <Field label="จัดแนว"><Segmented value={c.align ?? 'left'} onChange={(v) => setC({ align: v })} size="sm" options={[{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }]} /></Field>
        </div>
      )}
      {w.type === 'condition' && (
        <div className="space-y-3">
          <Field label="ข้อความเมื่อ “ผ่าน”"><TextInput value={c.passMessage ?? ''} onChange={(e) => setC({ passMessage: e.target.value })} placeholder="เช่น ผลิตได้ตามแผน" /></Field>
          <Field label="สีเมื่อผ่าน"><ColorInput value={c.passColor ?? '#16A34A'} onChange={(v) => setC({ passColor: v ?? '#16A34A' })} /></Field>
          <Field label="ข้อความเมื่อ “ไม่ผ่าน”"><TextInput value={c.failMessage ?? ''} onChange={(e) => setC({ failMessage: e.target.value })} placeholder="เช่น ต่ำกว่าแผน" /></Field>
          <Field label="สีเมื่อไม่ผ่าน"><ColorInput value={c.failColor ?? '#E5484D'} onChange={(v) => setC({ failColor: v ?? '#E5484D' })} /></Field>
          <Field label="ข้อความเมื่อไม่มีข้อมูล"><TextInput value={c.emptyMessage ?? ''} onChange={(e) => setC({ emptyMessage: e.target.value })} placeholder="ไม่มีข้อมูลเปรียบเทียบ" /></Field>
          <div className="grid grid-cols-2 gap-2"><Num label="ขนาดข้อความ" value={c.messageSize ?? 22} onChange={(v) => setC({ messageSize: v })} min={10} max={100} /><Num label="ทศนิยม" value={c.decimals ?? 0} onChange={(v) => setC({ decimals: v })} min={0} max={6} /></div>
          <Toggle checked={c.showValues !== false} onChange={(v) => setC({ showValues: v })} label="แสดงค่าที่เปรียบเทียบ" />
          <Toggle checked={c.showIcon !== false} onChange={(v) => setC({ showIcon: v })} label="แสดงไอคอน ✓ / !" />
          <Toggle checked={c.tint !== false} onChange={(v) => setC({ tint: v })} label="พื้นหลังสีตามผล" />
        </div>
      )}
      {w.type === 'kpi' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="คำนำหน้า"><TextInput value={c.prefix ?? ''} onChange={(e) => setC({ prefix: e.target.value })} className="!h-9" placeholder="฿" /></Field>
          <Field label="คำต่อท้าย"><TextInput value={c.suffix ?? ''} onChange={(e) => setC({ suffix: e.target.value })} className="!h-9" placeholder=" ชิ้น" /></Field>
          <Num label="ทศนิยม" value={c.decimals ?? 0} onChange={(v) => setC({ decimals: v })} min={0} max={6} />
          <Num label="เป้าหมาย" value={c.target} onChange={(v) => setC({ target: v })} />
          <Field label="สีตัวเลข" className="col-span-2"><ColorInput value={c.color} onChange={(v) => setC({ color: v ?? '' })} allowEmpty /></Field>
        </div>
      )}
      {w.type === 'table' && <Num label="ทศนิยม" value={c.decimals ?? 2} onChange={(v) => setC({ decimals: v })} min={0} max={6} />}
      {(w.type === 'records' || w.type === 'revision') && <Num label="ขนาดตัวอักษร" value={c.fontSize ?? 14} onChange={(v) => setC({ fontSize: v })} min={10} max={32} />}
      {w.type === 'text' && (
        <>
          <Field label="ข้อความ"><TextArea rows={4} value={c.text ?? ''} onChange={(e) => setC({ text: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Num label="ขนาด" value={c.fontSize ?? 18} onChange={(v) => setC({ fontSize: v })} min={8} max={160} />
            <Field label="น้ำหนัก"><Select value={c.fontWeight ?? 400} onChange={(e) => setC({ fontWeight: Number(e.target.value) })}>{[300, 400, 500, 600, 700].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          </div>
          <Field label="ฟอนต์"><Select value={c.fontFamily ?? ''} onChange={(e) => setC({ fontFamily: e.target.value || undefined })}><option value="">ตามธีม</option>{FONTS.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}</Select></Field>
          <Field label="จัดแนว"><Segmented value={c.align ?? 'left'} onChange={(v) => setC({ align: v })} size="sm" options={[{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }]} /></Field>
          <Field label="แนวตั้ง"><Segmented value={c.valign ?? 'top'} onChange={(v) => setC({ valign: v })} size="sm" options={[{ value: 'top', label: 'บน' }, { value: 'middle', label: 'กลาง' }, { value: 'bottom', label: 'ล่าง' }]} /></Field>
          <Toggle checked={!!c.italic} onChange={(v) => setC({ italic: v })} label="ตัวเอียง" />
          <Field label="สีข้อความ"><ColorInput value={c.color} onChange={(v) => setC({ color: v ?? '' })} allowEmpty /></Field>
        </>
      )}
      {w.type === 'image' && (
        <>
          <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-4 text-sm text-muted hover:border-primary/50 hover:text-primary', uploading && 'opacity-50')}>
            <Upload className="h-4 w-4" />{uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดรูปภาพ (สูงสุด 5MB)'}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
          </label>
          <Field label="หรือใส่ URL รูปภาพ"><TextInput value={c.url ?? ''} onChange={(e) => setC({ url: e.target.value })} placeholder="https://…" /></Field>
          <Field label="การแสดงผล"><Segmented value={c.fit ?? 'cover'} onChange={(v) => setC({ fit: v })} size="sm" options={[{ value: 'cover', label: 'เต็มกรอบ' }, { value: 'contain', label: 'พอดีรูป' }, { value: 'fill', label: 'ยืด' }]} /></Field>
        </>
      )}
      {w.type === 'shape' && (
        <>
          <Field label="รูปทรง"><Segmented value={c.shape ?? 'rect'} onChange={(v) => setC({ shape: v })} size="sm" options={[{ value: 'rect', label: 'สี่เหลี่ยม' }, { value: 'ellipse', label: 'วงรี' }, { value: 'line', label: 'เส้น' }]} /></Field>
          <Field label="สีพื้น"><ColorInput value={c.fill} onChange={(v) => setC({ fill: v ?? 'transparent' })} allowEmpty /></Field>
          {c.shape !== 'line' && <Field label="สีขอบ"><ColorInput value={c.stroke} onChange={(v) => setC({ stroke: v ?? 'transparent' })} allowEmpty /></Field>}
          <Num label={c.shape === 'line' ? 'ความหนาเส้น' : 'ความหนาขอบ'} value={c.strokeWidth ?? 0} onChange={(v) => setC({ strokeWidth: v })} min={0} max={40} />
          {c.shape === 'rect' && <Num label="ความโค้งมุม" value={s.radius ?? 16} onChange={(v) => setS({ radius: v })} min={0} max={400} />}
        </>
      )}
      {w.type !== 'shape' && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">กรอบ</p>
          <Field label="สีพื้นหลัง"><ColorInput value={s.bg === 'transparent' ? null : s.bg} onChange={(v) => setS({ bg: v ?? 'transparent' })} allowEmpty /></Field>
          <Field label="สีตัวอักษร"><ColorInput value={s.text} onChange={(v) => setS({ text: v ?? undefined })} allowEmpty /></Field>
          <Field label="สีขอบ"><ColorInput value={s.border} onChange={(v) => setS({ border: v ?? undefined })} allowEmpty /></Field>
          <div className="grid grid-cols-3 gap-2">
            <Num label="ขอบ" value={s.borderWidth} onChange={(v) => setS({ borderWidth: v })} min={0} max={20} />
            <Num label="มุมโค้ง" value={s.radius} onChange={(v) => setS({ radius: v })} min={0} max={200} />
            <Num label="ระยะใน" value={s.padding} onChange={(v) => setS({ padding: v })} min={0} max={80} />
          </div>
          <Field label="เงา"><Segmented value={s.shadow ?? 'sm'} onChange={(v) => setS({ shadow: v })} size="sm" options={[{ value: 'none', label: 'ไม่มี' }, { value: 'sm', label: 'เบา' }, { value: 'md', label: 'กลาง' }, { value: 'lg', label: 'มาก' }]} /></Field>
        </div>
      )}
      <Field label={`ความโปร่งใส ${Math.round((s.opacity ?? 1) * 100)}%`}>
        <input type="range" min={0.1} max={1} step={0.05} value={s.opacity ?? 1} onChange={(e) => setS({ opacity: Number(e.target.value) })} className="w-full accent-[rgb(var(--c-primary))]" />
      </Field>
    </div>
  );
}


function TargetPicker({ w, set }: { w: Widget; set: (p: Partial<Widget>) => void }) {
  const { widgets } = useDash();
  const targets: string[] = w.config.targets ?? [];
  const cands = widgets.filter((x) => x.id !== w.id && x.dataSource?.sheetId === w.dataSource?.sheetId && x.type !== 'slicer');
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium">กรองวิดเจ็ต</p>
      <Segmented size="sm" value={targets.length ? 'some' : 'all'} onChange={(v) => set({ config: { ...w.config, targets: v === 'all' ? [] : cands.map((x) => x.id) } })} options={[{ value: 'all', label: 'ทุกชิ้นที่ใช้ชีตเดียวกัน' }, { value: 'some', label: 'เลือกเอง' }]} />
      {targets.length > 0 && (
        <div className="space-y-1 rounded-xl border border-line p-2">
          {cands.length === 0 && <p className="text-xs text-muted">ยังไม่มีวิดเจ็ตที่ใช้ชีตเดียวกัน</p>}
          {cands.map((x) => (
            <label key={x.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={targets.includes(x.id)} onChange={(e) => set({ config: { ...w.config, targets: e.target.checked ? [...targets, x.id] : targets.filter((i) => i !== x.id) } })} />
              <span className="truncate">{x.title || WIDGETS.find((m) => m.type === x.type)?.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function WidgetConfigPanel({ w, fileId, fileName, sheets, onChange, onRemove, onDuplicate, onLayer }: {
  w: Widget; fileId: string; fileName: string; sheets: Sheet[]; onChange: (p: Partial<Widget>) => void; onRemove: () => void; onDuplicate: () => void;
  onLayer: (op: 'front' | 'back' | 'up' | 'down') => void;
}) {
  const hasData = DATA_TYPES_W.includes(w.type) || ['slicer', 'card', 'condition', 'records', 'revision'].includes(w.type);
  const hasAnalytics = CHART_TYPES.includes(w.type);
  type Tab = 'data' | 'style' | 'analytics' | 'layout';
  const [tab, setTab] = useState<Tab>(hasData ? 'data' : 'style');
  useEffect(() => { setTab(hasData ? 'data' : 'style'); }, [w.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const meta = WIDGETS.find((x) => x.type === w.type)!;
  const tabs: { value: Tab; label: string }[] = [
    ...(hasData ? [{ value: 'data' as const, label: 'ข้อมูล' }] : []), { value: 'style', label: 'รูปแบบ' },
    ...(hasAnalytics ? [{ value: 'analytics' as const, label: 'วิเคราะห์' }] : []), { value: 'layout', label: 'จัดวาง' },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{meta.icon}</span>
        <span className="flex-1 truncate text-sm font-semibold">{w.title || meta.label}</span>
        <button onClick={() => onChange({ locked: !w.locked })} className={cn('rounded-lg p-1.5 hover:bg-ink/5', w.locked ? 'text-warning' : 'text-muted')} title={w.locked ? 'ปลดล็อก' : 'ล็อกตำแหน่ง'}>
          {w.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </button>
      </div>
      <div className="px-4 pt-3"><Segmented value={tab} onChange={setTab} size="sm" options={tabs} /></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'data' && hasData && w.dataSource && <DataTab w={w} fileId={fileId} fileName={fileName} fileSheets={sheets} set={onChange} />}
        {tab === 'style' && <StyleTab w={w} set={onChange} />}
        {tab === 'analytics' && <ChartAnalytics w={w} set={onChange} />}
        {tab === 'layout' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Num label="X" value={Math.round(w.x)} onChange={(v) => onChange({ x: v ?? 0 })} />
              <Num label="Y" value={Math.round(w.y)} onChange={(v) => onChange({ y: v ?? 0 })} />
              <Num label="กว้าง" value={Math.round(w.w)} onChange={(v) => onChange({ w: Math.max(20, v ?? 20) })} />
              <Num label="สูง" value={Math.round(w.h)} onChange={(v) => onChange({ h: Math.max(20, v ?? 20) })} />
            </div>
            <Field label="ลำดับชั้น">
              <div className="grid grid-cols-2 gap-1.5">
                <Button size="sm" variant="secondary" icon={<ArrowUpToLine className="h-3.5 w-3.5" />} onClick={() => onLayer('front')}>หน้าสุด</Button>
                <Button size="sm" variant="secondary" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => onLayer('back')}>หลังสุด</Button>
                <Button size="sm" variant="secondary" icon={<ChevronUp className="h-3.5 w-3.5" />} onClick={() => onLayer('up')}>ขึ้น 1 ชั้น</Button>
                <Button size="sm" variant="secondary" icon={<ChevronDown className="h-3.5 w-3.5" />} onClick={() => onLayer('down')}>ลง 1 ชั้น</Button>
              </div>
            </Field>
            <p className="text-xs text-muted">ลูกศรเลื่อน 1px · Shift+ลูกศร 10px · Ctrl+D ทำซ้ำ · Delete ลบ</p>
          </div>
        )}
      </div>
      <div className="flex gap-2 border-t border-line p-3">
        <Button size="sm" variant="secondary" className="flex-1" icon={<Copy className="h-3.5 w-3.5" />} onClick={onDuplicate}>ทำซ้ำ</Button>
        <Button size="sm" variant="ghost" className="flex-1 text-danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemove}>ลบ</Button>
      </div>
    </div>
  );
}
