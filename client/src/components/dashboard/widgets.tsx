import { useEffect, useMemo, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import {
  AreaChart as AreaIcon, BarChart3, BellRing, Circle, Donut, Filter, Gauge, Grid3x3, History, ImageIcon, LayoutList, LineChart as LineIcon, PieChart as PieIcon, ScanSearch,
  ScatterChart as ScatterIcon, Sigma, StretchHorizontal, Table2, TrendingUp, Type, Activity, BarChartHorizontal,
} from 'lucide-react';
import { ensureFont } from '@/lib/fonts';
import { fmtNumber } from '@/lib/format';
import { SHADOWS } from '@/lib/theme';
import { useTheme } from '@/store/theme';
import type { DataSource, Widget, WidgetData, WidgetType } from '@/types';
import { ChartBody, PALETTE } from './ChartBody';
import { useDash, withSlicers } from './dashContext';
import { CardBody, ConditionBody, SlicerBody } from './SpecialBodies';
import { RecordsBody, RevisionBody } from './RecordBodies';
import { CHART_TYPES, DATA_TYPES_W, dsValid, needsX, useWidgetData } from './useWidgetData';

export { CHART_TYPES, DATA_TYPES_W, dsValid, needsX, PALETTE, useWidgetData };

export const WIDGET_GROUPS: { label: string; types: WidgetType[] }[] = [
  { label: 'ตัวกรอง', types: ['slicer'] },
  { label: 'กราฟ', types: ['bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'pct', 'pareto', 'histogram', 'heatmap', 'xchart', 'xbar'] },
  { label: 'ตัวเลข', types: ['kpi', 'card', 'condition', 'table'] },
  { label: 'รายละเอียด', types: ['records', 'revision'] },
  { label: 'ตกแต่ง', types: ['text', 'image', 'shape'] },
];

export const WIDGETS: { type: WidgetType; label: string; icon: JSX.Element; w: number; h: number; hint?: string }[] = [
  { type: 'slicer', label: 'ตัวกรอง', icon: <Filter />, w: 260, h: 90, hint: 'Dropdown/ปุ่ม/ช่วงวันที่ ที่กรองกราฟอื่นในแดชบอร์ด' },
  { type: 'bar', label: 'แท่ง', icon: <BarChart3 />, w: 520, h: 340 },
  { type: 'line', label: 'เส้น', icon: <LineIcon />, w: 520, h: 340 },
  { type: 'area', label: 'พื้นที่', icon: <AreaIcon />, w: 520, h: 340 },
  { type: 'pie', label: 'วงกลม', icon: <PieIcon />, w: 380, h: 340 },
  { type: 'doughnut', label: 'โดนัท', icon: <Donut />, w: 380, h: 340 },
  { type: 'scatter', label: 'กระจาย', icon: <ScatterIcon />, w: 480, h: 340 },
  { type: 'pct', label: 'แท่ง 100%', icon: <StretchHorizontal />, w: 520, h: 340, hint: 'สัดส่วน % ของแต่ละหมวด (Stacked 100%)' },
  { type: 'pareto', label: 'Pareto', icon: <TrendingUp />, w: 560, h: 360, hint: 'แท่งเรียงมาก→น้อย + เส้น % สะสม' },
  { type: 'histogram', label: 'Histogram', icon: <BarChartHorizontal />, w: 520, h: 340, hint: 'การกระจายของค่าตัวเลขเป็นช่วง' },
  { type: 'heatmap', label: 'Heatmap', icon: <Grid3x3 />, w: 560, h: 360, hint: 'ตารางสีจากค่าตามหมวด × หมวด' },
  { type: 'xchart', label: 'X Chart', icon: <Activity />, w: 560, h: 340, hint: 'Individuals control chart (CL / UCL / LCL)' },
  { type: 'xbar', label: 'X-bar', icon: <Sigma />, w: 560, h: 340, hint: 'X-bar control chart ของกลุ่มย่อย' },
  { type: 'kpi', label: 'ตัวเลข KPI', icon: <Gauge />, w: 300, h: 150 },
  { type: 'card', label: 'การ์ด', icon: <LayoutList />, w: 320, h: 170, hint: 'หัวข้อหลัก/หัวข้อย่อย/รายละเอียด เลือกแสดงได้' },
  { type: 'condition', label: 'การ์ดเงื่อนไข', icon: <BellRing />, w: 340, h: 150, hint: 'เทียบค่าจาก 2 ตาราง ผ่าน/ไม่ผ่าน แสดงข้อความ' },
  { type: 'table', label: 'ตารางสรุป', icon: <Table2 />, w: 480, h: 320 },
  { type: 'records', label: 'ค้นหารายละเอียด', icon: <ScanSearch />, w: 760, h: 620, hint: 'พิมพ์รหัส (เช่น Sub Doc No. / Short Code) แล้วแสดงรายละเอียดและรูปของแถวที่ตรง' },
  { type: 'revision', label: 'Rev ล่าสุด', icon: <History />, w: 520, h: 480, hint: 'Rev ล่าสุดของชีต และต่างจาก Rev ก่อนหน้าอย่างไร' },
  { type: 'text', label: 'ข้อความ', icon: <Type />, w: 420, h: 80 },
  { type: 'image', label: 'รูปภาพ', icon: <ImageIcon />, w: 360, h: 240 },
  { type: 'shape', label: 'รูปทรง', icon: <Circle />, w: 220, h: 160 },
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

const blankDs = (sheetId: string, extra: Partial<DataSource> = {}): DataSource => ({ sheetId, xColumnId: null, xBucket: 'none', series: [{ columnId: null, aggregation: 'count' }], limit: 20, ...extra });

export function newWidget(type: WidgetType, x: number, y: number, z: number, sheetId: string | null): Widget {
  const def = WIDGETS.find((w) => w.type === type)!;
  const base: Widget = { id: uid(), type, title: def.label, x, y, w: def.w, h: def.h, z, locked: false, config: {}, style: { showTitle: true }, dataSource: null };
  const withData = (DATA_TYPES_W.includes(type) || ['slicer', 'card', 'condition', 'records', 'revision'].includes(type)) && sheetId;
  if (withData) base.dataSource = blankDs(sheetId!, { sort: type === 'pie' || type === 'doughnut' || type === 'pareto' ? 'value_desc' : 'x_asc' });
  if (type === 'text') Object.assign(base, { title: '', config: { text: 'พิมพ์ข้อความ', fontSize: 24, fontWeight: 600, align: 'left', color: '' }, style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 4 } });
  if (type === 'image') Object.assign(base, { title: '', config: { url: '', fit: 'cover' }, style: { showTitle: false, padding: 0 } });
  if (type === 'shape') Object.assign(base, { title: '', config: { shape: 'rect', fill: '#1552F0', stroke: 'transparent', strokeWidth: 0 }, style: { showTitle: false, bg: 'transparent', borderWidth: 0, shadow: 'none', padding: 0, radius: 16 } });
  if (type === 'kpi') base.config = { decimals: 0, color: '', prefix: '', suffix: '' };
  if (CHART_TYPES.includes(type)) base.config = { legend: true, grid: true, labels: false, colors: PALETTE.slice(0, 6) };
  if (type === 'scatter' && base.dataSource) base.dataSource.series = [{ columnId: null, aggregation: 'none' }];
  if (type === 'histogram' && base.dataSource) { base.dataSource.kind = 'histogram'; base.dataSource.bins = 10; base.config = { ...base.config, legend: false, barGap: 1, barRadius: 0 }; }
  if (type === 'xchart' && base.dataSource) { base.dataSource.kind = 'xchart'; base.config = { ...base.config, legend: false }; }
  if (type === 'xbar' && base.dataSource) { base.dataSource.kind = 'xbar'; base.config = { ...base.config, legend: false }; }
  if (type === 'pareto') base.config = { ...base.config, legend: true, labels: true };
  if (type === 'heatmap') base.config = { colorLow: '#E8F0FE', colorHigh: '#1552F0', showValues: true };
  if (type === 'records') base.config = { searchColumnIds: [], titleColumnIds: [], fieldColumnIds: [], imageColumnId: null, pageSize: 20, placeholder: '', showRev: true, fontSize: 14 };
  if (type === 'revision') base.config = { limit: 10, fontSize: 14 };
  if (type === 'slicer') { base.title = ''; base.style = { showTitle: false }; base.config = { mode: 'dropdown_search', multi: true, showLabel: true, placeholder: '', targets: [] }; }
  if (type === 'card') { base.title = ''; base.style = { showTitle: false }; base.config = { heading: 'หัวข้อหลัก', subheading: 'หัวข้อย่อย', body: 'รายละเอียด', showHeading: true, showSubheading: true, showBody: true, showValue: false, align: 'left', decimals: 0 }; }
  if (type === 'condition') {
    base.config = { op: 'lte', passMessage: 'ผ่านเงื่อนไข ✓', failMessage: 'ไม่ผ่านเงื่อนไข', labelA: 'ค่าที่ 1', labelB: 'ค่าที่ 2', decimals: 0, showValues: true, showIcon: true, tint: true,
      b: sheetId ? blankDs(sheetId) : null };
    if (base.dataSource) base.dataSource.series = [{ columnId: null, aggregation: 'sum' }];
    if (base.config.b) base.config.b.series = [{ columnId: null, aggregation: 'sum' }];
  }
  return base;
}

function KpiBody({ w, data }: { w: Widget; data: WidgetData }) {
  const primary = useTheme((s) => s.draft.colors.primary);
  const c = w.config;
  const v = data.series[0]?.values[0];
  const target = c.target !== undefined && c.target !== '' && c.target !== null ? Number(c.target) : null;
  const hit = target !== null && v !== null && v !== undefined ? v >= target : null;
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="truncate font-semibold leading-none tracking-tight tabular-nums" style={{ color: c.color || primary, fontSize: `clamp(20px, ${Math.min(w.h * 0.34, w.w * 0.16)}px, 72px)` }}>
        {c.prefix}{v === null || v === undefined ? '–' : fmtNumber(v, c.decimals ?? 0)}{c.suffix}
      </p>
      <p className="mt-2 truncate text-xs opacity-70">
        {target !== null ? <span style={{ color: hit ? 'rgb(var(--c-success))' : 'rgb(var(--c-danger))' }}>{hit ? '▲ ถึงเป้า' : '▼ ต่ำกว่าเป้า'} {fmtNumber(target, c.decimals ?? 0)}</span> : `จาก ${data.totalRows.toLocaleString()} แถว`}
      </p>
    </div>
  );
}

/** summary table: click a heading to sort by it (again = reverse, third time = original order); total row at the bottom */
function TableBody({ w, data }: { w: Widget; data: WidgetData }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const idx = data.categories.map((_, i) => i);
  if (sort) {
    const col = sort.key === '__cat' ? null : data.series.find((x) => x.key === sort.key);
    idx.sort((a, b) => {
      if (!col) return data.categories[a].localeCompare(data.categories[b], 'th', { numeric: true }) * sort.dir;
      return ((col.values[a] ?? -Infinity) - (col.values[b] ?? -Infinity)) * sort.dir;
    });
  }
  const click = (key: string) => setSort((s) => (!s || s.key !== key ? { key, dir: key === '__cat' ? 1 : -1 } : s.dir === (key === '__cat' ? 1 : -1) ? { key, dir: (s.dir * -1) as 1 | -1 } : null));
  const arrow = (key: string) => (sort?.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const additive = (w.dataSource?.series ?? []).every((x) => x.aggregation === 'count' || x.aggregation === 'sum');
  const showTotal = w.config.showTotal !== false && additive && data.categories.length > 1;
  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-inherit"><tr className="text-left text-xs opacity-70">
          <th className="cursor-pointer select-none py-1.5 pr-3 font-medium hover:opacity-100" onMouseDown={(e) => e.stopPropagation()} onClick={() => click('__cat')} title="คลิกเพื่อเรียง">{w.config.categoryLabel || 'หมวด'}{arrow('__cat')}</th>
          {data.series.map((s) => <th key={s.key} className="cursor-pointer select-none py-1.5 pr-2 text-right font-medium hover:opacity-100" onMouseDown={(e) => e.stopPropagation()} onClick={() => click(s.key)} title="คลิกเพื่อเรียง">{s.name}{arrow(s.key)}</th>)}
        </tr></thead>
        <tbody>
          {idx.map((i) => (
            <tr key={data.categories[i]} className="border-t border-current/10" style={{ borderColor: 'rgb(var(--c-border))' }}>
              <td className="py-1.5 pr-3">{data.categories[i]}</td>
              {data.series.map((s) => <td key={s.key} className="py-1.5 pr-2 text-right tabular-nums">{fmtNumber(s.values[i] ?? null, w.config.decimals ?? 2)}</td>)}
            </tr>
          ))}
          {showTotal && (
            <tr className="border-t-2 font-semibold" style={{ borderColor: 'rgb(var(--c-border))' }}>
              <td className="py-1.5 pr-3">รวม</td>
              {data.series.map((s) => <td key={s.key} className="py-1.5 pr-2 text-right tabular-nums">{fmtNumber(s.values.reduce<number>((t, v) => t + (v ?? 0), 0), w.config.decimals ?? 2)}</td>)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Phones (widgets stacked one per row): font sizes chosen for the big canvas are too large on a ~390 px screen and leave
 * little room for the text itself, so they are brought down to phone sizes. The saved dashboard is not changed.
 */
export const PHONE_FONT = { text: 20, records: 13, title: 14 };
export function phoneSized(w: Widget): Widget {
  const c = { ...(w.config ?? {}) };
  const s = { ...(w.style ?? {}) };
  if (w.type === 'text') c.fontSize = Math.min(Number(c.fontSize) || 18, Math.max(14, Math.round((Number(c.fontSize) || 18) * 0.6)), PHONE_FONT.text);
  if (w.type === 'records' || w.type === 'revision') c.fontSize = Math.min(Number(c.fontSize) || 14, PHONE_FONT.records);
  if (s.titleSize !== undefined) s.titleSize = Math.min(s.titleSize, PHONE_FONT.title);
  else s.titleSize = PHONE_FONT.title;
  return { ...w, config: c, style: s };
}

export function WidgetView({ w: given, refreshKey, editing, phone }: { w: Widget; refreshKey: number; editing?: boolean; phone?: boolean }) {
  const w = useMemo(() => (phone ? phoneSized(given) : given), [given, phone]);
  const isData = DATA_TYPES_W.includes(w.type);
  const ctx = useDash();
  const { data, error, loading } = useWidgetData(w.type, isData ? withSlicers(ctx, w.id, w.dataSource) : null, refreshKey);
  const s = w.style ?? {};
  const cfg = w.config ?? {};
  useEffect(() => { if (w.type === 'text' && cfg.fontFamily) ensureFont(cfg.fontFamily); }, [w.type, cfg.fontFamily]);
  const [expanded, setExpanded] = useState(false);
  if (s.hidden && !editing) return null;

  const frame: React.CSSProperties = {
    background: s.bg ?? 'var(--widget-bg)', color: s.text || 'var(--widget-text)',
    border: `${s.borderWidth ?? 'var(--widget-bw)'}${s.borderWidth !== undefined ? 'px' : ''} solid ${s.border ?? 'var(--widget-border)'}`,
    borderRadius: s.radius !== undefined ? s.radius : 'var(--widget-radius)', boxShadow: s.shadow ? SHADOWS[s.shadow] : 'var(--widget-shadow)',
    padding: s.padding !== undefined ? s.padding : 'var(--widget-pad)', opacity: s.hidden ? 0.35 : s.opacity ?? 1,
  };

  let body: React.ReactNode = null;
  if (isData) {
    if (!dsValid(w.type, w.dataSource)) body = <p className="grid h-full place-items-center text-center text-xs opacity-60">{editing ? 'เลือกข้อมูลที่แผง “ข้อมูล” ด้านขวา' : 'ยังไม่ได้ตั้งค่าข้อมูล'}</p>;
    else if (error) body = <p className="grid h-full place-items-center px-2 text-center text-xs text-danger">{error}</p>;
    else if (!data) body = <div className="skeleton h-full w-full" />;
    else if (w.type === 'kpi') body = <KpiBody w={w} data={data} />;
    else if (w.type === 'table') body = <TableBody w={w} data={data} />;
    else body = <ChartBody w={w} data={data} />;
  } else if (w.type === 'slicer') body = <SlicerBody w={w} editing={editing} />;
  else if (w.type === 'card') body = <CardBody w={w} refreshKey={refreshKey} />;
  else if (w.type === 'condition') body = <ConditionBody w={w} refreshKey={refreshKey} editing={editing} />;
  else if (w.type === 'records') body = <RecordsBody w={w} refreshKey={refreshKey} editing={editing} />;
  else if (w.type === 'revision') body = <RevisionBody w={w} refreshKey={refreshKey} editing={editing} />;
  else if (w.type === 'text') {
    body = (
      <div className="flex h-full w-full overflow-hidden whitespace-pre-wrap break-words" style={{
        fontSize: cfg.fontSize ?? 18, fontWeight: cfg.fontWeight ?? 400, textAlign: cfg.align ?? 'left', color: cfg.color || undefined,
        fontStyle: cfg.italic ? 'italic' : undefined, fontFamily: cfg.fontFamily ? `'${cfg.fontFamily}', var(--font)` : undefined, lineHeight: 1.35,
        alignItems: cfg.valign === 'middle' ? 'center' : cfg.valign === 'bottom' ? 'flex-end' : 'flex-start',
      }}><span className="w-full">{cfg.text}</span></div>
    );
  } else if (w.type === 'image') {
    body = cfg.url ? <img src={cfg.url} alt={w.title || 'image'} draggable={false} className="h-full w-full" style={{ objectFit: cfg.fit ?? 'cover', borderRadius: 'inherit' }} />
      : <div className="grid h-full place-items-center rounded-[inherit] bg-ink/5 text-xs opacity-60"><ImageIcon className="h-8 w-8" /></div>;
  } else if (w.type === 'shape') {
    const sh = cfg.shape ?? 'rect';
    body = sh === 'line'
      ? <div className="flex h-full items-center"><div className="w-full" style={{ height: Math.max(1, cfg.strokeWidth || 3), background: cfg.fill || '#1552F0', borderRadius: 99 }} /></div>
      : <div className="h-full w-full" style={{ background: cfg.fill, border: `${cfg.strokeWidth ?? 0}px solid ${cfg.stroke ?? 'transparent'}`, borderRadius: sh === 'ellipse' ? '50%' : s.radius ?? 16 }} />;
  }

  const showTitle = s.showTitle !== false && !!w.title && !['text', 'shape', 'image', 'slicer', 'card'].includes(w.type);
  // a chart opens full screen when tapped (view mode): every label of the x axis, scroll sideways when there are many
  const canExpand = !editing && isData && !!data && CHART_TYPES.includes(w.type);
  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={w.type === 'shape' ? { opacity: s.opacity ?? 1 } : frame}>
      {showTitle && (
        <div className="mb-2 shrink-0" style={{ textAlign: s.titleAlign ?? 'left' }}>
          <div className="flex items-center gap-2" style={{ justifyContent: s.titleAlign === 'center' ? 'center' : s.titleAlign === 'right' ? 'flex-end' : 'flex-start' }}>
            <p className="min-w-0 truncate font-semibold" style={{ fontSize: s.titleSize ?? 15 }}>{w.title}</p>
            {loading && data && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
          </div>
          {s.subtitle && <p className="truncate text-xs opacity-60">{s.subtitle}</p>}
        </div>
      )}
      <div className={canExpand ? 'group/exp relative min-h-0 flex-1 cursor-zoom-in' : 'relative min-h-0 flex-1'} onClick={canExpand ? () => setExpanded(true) : undefined}>
        {body}
        {canExpand && (
          <span className="pointer-events-none absolute right-1 top-0 grid h-7 w-7 place-items-center rounded-lg bg-surface/90 text-muted opacity-60 shadow-sm ring-1 ring-line group-hover/exp:opacity-100" aria-hidden>
            <Maximize2 className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      {canExpand && expanded && data && <ExpandedChart w={given} data={data} onClose={() => setExpanded(false)} />}
    </div>
  );
}

/** A chart full screen: every category under the x axis (labels turned when many), wide enough to read, scrolls sideways */
function ExpandedChart({ w, data, onClose }: { w: Widget; data: WidgetData; onClose: () => void }) {
  const n = data.categories?.length ?? 0;
  const cfg = w.config ?? {};
  const turn = n > 10 || data.categories.some((c) => String(c).length > 8);
  const big: Widget = { ...w, config: { ...cfg, xInterval: 0, xAngle: turn ? (cfg.xAngle || -45) : cfg.xAngle, xFontSize: Math.max(12, Number(cfg.xFontSize) || 12), yFontSize: Math.max(12, Number(cfg.yFontSize) || 12), legend: cfg.legend, labelSize: Math.max(11, Number(cfg.labelSize) || 11) } };
  const per = ['bar', 'pareto', 'pct', 'histogram'].includes(w.type) ? Math.max(28, 18 * Math.max(1, data.series.length)) : 28;
  return (
    <Modal open onClose={onClose} size="full" title={w.title || 'กราฟ'} description={n ? `${n.toLocaleString()} รายการบนแกน X` : undefined}>
      <div className="overflow-x-auto" onClick={(e) => e.stopPropagation()}>
        <div style={{ minWidth: Math.max(600, n * per), height: '70vh' }}>
          <ChartBody w={big} data={data} />
        </div>
      </div>
    </Modal>
  );
}
