import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, Pie, PieChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { compactNumber, fmtNumber } from '@/lib/format';
import { useTheme } from '@/store/theme';
import type { Widget, WidgetData } from '@/types';

export const PALETTE = ['#1552F0', '#16A34A', '#F59E0B', '#E5484D', '#8B5CF6', '#0EA5E9', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16', '#64748B'];

export interface RefLine { value: number; label?: string; color?: string; dash?: boolean; axis?: 'left' | 'right' }
export interface SeriesOverride { type?: 'bar' | 'line' | 'area'; axis?: 'left' | 'right'; color?: string; name?: string }

/** Number formatting shared by axes, labels and tooltips (Power BI "display units", decimals, prefix/suffix) */
export function makeFmt(cfg: Record<string, any>, forAxis = false) {
  const unit = cfg.unit ?? 'auto';
  const dec = cfg.decimals;
  return (v: unknown) => {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    let out: string;
    if (unit === 'thousand') out = `${fmtNumber(n / 1e3, dec ?? 1)}K`;
    else if (unit === 'million') out = `${fmtNumber(n / 1e6, dec ?? 1)}M`;
    else if (unit === 'billion') out = `${fmtNumber(n / 1e9, dec ?? 1)}B`;
    else if (unit === 'percent') out = `${fmtNumber(n * 100, dec ?? 0)}%`;
    else if (unit === 'none') out = fmtNumber(n, dec ?? 2);
    else out = forAxis ? compactNumber(n) : dec !== undefined ? fmtNumber(n, dec) : fmtNumber(n, Math.abs(n) >= 100 ? 0 : 2);
    return `${cfg.prefix ?? ''}${out}${cfg.suffix ?? ''}`;
  };
}

function lerp(a: string, b: string, t: number) {
  const pa = /^#?([0-9a-f]{6})$/i.exec(a)?.[1] ?? '000000';
  const pb = /^#?([0-9a-f]{6})$/i.exec(b)?.[1] ?? 'ffffff';
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const m = (i: number) => Math.round(ch(pa, i) + (ch(pb, i) - ch(pa, i)) * t).toString(16).padStart(2, '0');
  return `#${m(0)}${m(2)}${m(4)}`;
}

function Heatmap({ w, data }: { w: Widget; data: WidgetData }) {
  const cfg = w.config;
  const fmt = makeFmt(cfg);
  const all = data.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const lo = cfg.heatMin ?? (all.length ? Math.min(...all) : 0);
  const hi = cfg.heatMax ?? (all.length ? Math.max(...all) : 1);
  const low = cfg.colorLow ?? '#E8F0FE';
  const high = cfg.colorHigh ?? '#1552F0';
  return (
    <div className="h-full overflow-auto">
      <table className="w-full border-separate border-spacing-1 text-[12px]">
        <thead><tr><th />{data.series.map((s) => <th key={s.key} className="px-1 py-1 text-center font-medium opacity-70">{s.name}</th>)}</tr></thead>
        <tbody>
          {data.categories.map((c, i) => (
            <tr key={c}>
              <td className="whitespace-nowrap pr-2 text-right font-medium opacity-80">{c}</td>
              {data.series.map((s) => {
                const v = s.values[i];
                const t = v === null ? 0 : hi === lo ? 1 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
                return (
                  <td key={s.key} title={`${c} · ${s.name}: ${v === null ? '–' : fmt(v)}`} className="rounded-md px-1 py-2 text-center tabular-nums"
                    style={{ background: v === null ? 'rgb(var(--c-border) / .4)' : lerp(low, high, t), color: t > 0.55 ? '#fff' : '#101828' }}>
                    {cfg.showValues !== false && v !== null ? fmt(v) : ''}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ChartBody({ w, data }: { w: Widget; data: WidgetData }) {
  const colors = useTheme((s) => s.draft.colors);
  const cfg = w.config;
  const type = w.type;
  const pal: string[] = cfg.colors?.length ? cfg.colors : PALETTE;
  const fmt = makeFmt(cfg);
  const fmtAxis = makeFmt(cfg, true);
  const axisTick = (size?: number) => ({ fill: colors.muted, fontSize: size ?? 11 });
  const animate = cfg.animation !== false;
  const tooltip = cfg.tooltip === false ? null : (
    <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${colors.border}`, background: colors.surface, color: colors.text, fontSize: 12 }}
      formatter={(v: any, n: any) => [fmt(v), n]} cursor={{ fill: `${colors.primary}10` }} />
  );
  const legendPos: string = cfg.legendPos ?? 'bottom';
  const legend = cfg.legend !== false && data.series.length > 0 && type !== 'histogram' ? (
    <Legend verticalAlign={legendPos === 'top' ? 'top' : 'bottom'} align={legendPos === 'left' ? 'left' : legendPos === 'right' ? 'right' : 'center'}
      layout={legendPos === 'left' || legendPos === 'right' ? 'vertical' : 'horizontal'} wrapperStyle={{ fontSize: 12, color: colors.text }} iconType="circle" iconSize={8} />
  ) : null;
  const gridColor = cfg.gridColor || colors.border;
  const labelStyle = { fontSize: cfg.labelSize ?? 10, fill: cfg.labelColor || colors.muted };

  if (type === 'heatmap') return <Heatmap w={w} data={data} />;

  if (type === 'pie' || type === 'doughnut') {
    const s = data.series[0];
    const pd = data.categories.map((c, i) => ({ name: c, value: s?.values[i] ?? 0 })).filter((d) => d.value);
    const total = pd.reduce((a, b) => a + b.value, 0) || 1;
    const lab = cfg.labels
      ? ({ percent, value }: any) => (cfg.labelMode === 'value' ? fmt(value) : cfg.labelMode === 'both' ? `${fmt(value)} (${Math.round(percent * 100)}%)` : `${Math.round(percent * 100)}%`)
      : false;
    return (
      <ResponsiveContainer>
        <PieChart>
          {tooltip}{legend}
          <Pie data={pd} dataKey="value" nameKey="name" innerRadius={type === 'doughnut' ? `${cfg.innerRadius ?? 55}%` : 0} outerRadius="80%" paddingAngle={type === 'doughnut' ? 2 : 0}
            label={lab} labelLine={false} isAnimationActive={animate} stroke={colors.surface}>
            {pd.map((_, i) => <Cell key={i} fill={pal[i % pal.length]} />)}
          </Pie>
          {type === 'doughnut' && cfg.centerTotal && (
            <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" fill={colors.text} fontSize={20} fontWeight={600}>{fmt(total)}</text>
          )}
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'scatter')
    return (
      <ResponsiveContainer>
        <ScatterChart>
          {cfg.grid !== false && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}{tooltip}
          <XAxis dataKey="x" type="number" tick={axisTick(cfg.xFontSize)} stroke={colors.border} name="X" label={cfg.xTitle ? { value: cfg.xTitle, position: 'insideBottom', offset: -2, fill: colors.muted, fontSize: 11 } : undefined} />
          <YAxis dataKey="y" type="number" tick={axisTick(cfg.yFontSize)} stroke={colors.border} width={48} name="Y" domain={[cfg.yMin ?? 'auto', cfg.yMax ?? 'auto']} />
          <Scatter data={data.points as any[]} fill={pal[0]} isAnimationActive={animate} />
          {(cfg.refLines as RefLine[] | undefined)?.map((r, i) => <ReferenceLine key={i} y={r.value} stroke={r.color || colors.danger} strokeDasharray={r.dash === false ? undefined : '5 4'} label={r.label ? { value: r.label, fill: r.color || colors.muted, fontSize: 11, position: 'insideTopRight' } : undefined} />)}
        </ScatterChart>
      </ResponsiveContainer>
    );

  /* ---- cartesian family: bar / line / area / pct / pareto / histogram / xchart / xbar ---- */
  const overrides: SeriesOverride[] = cfg.seriesOverrides ?? [];
  const st = data.stats ?? {};
  const isSpc = type === 'xchart' || type === 'xbar';
  const horizontal = !!cfg.horizontal && (type === 'bar' || type === 'pct');
  const pct = type === 'pct' || cfg.stackMode === '100';
  const stacked = pct || !!cfg.stacked;

  let rows: Record<string, any>[] = data.categories.map((c, i) => ({ name: c, ...Object.fromEntries(data.series.map((s) => [s.key, s.values[i]])) }));
  if (pct) {
    rows = rows.map((r) => {
      const tot = data.series.reduce((a, s) => a + (Number(r[s.key]) || 0), 0) || 1;
      return { ...r, ...Object.fromEntries(data.series.map((s) => [s.key, ((Number(r[s.key]) || 0) / tot) * 100])) };
    });
  }
  if (type === 'pareto') {
    const s0 = data.series[0];
    const tot = (s0?.values ?? []).reduce<number>((a, b) => a + (b ?? 0), 0) || 1;
    let run = 0;
    rows = rows.map((r) => { run += Number(r[s0.key]) || 0; return { ...r, __cum: (run / tot) * 100 }; });
  }
  const spcKey = data.series[0]?.key;
  const oocPoint = (v: number) => isSpc && st.ucl !== undefined && st.lcl !== undefined && (v > st.ucl || v < st.lcl);

  const xAxis = (
    <XAxis dataKey="name" hide={cfg.showX === false} padding={type === 'line' || type === 'area' || isSpc ? { left: 24, right: 24 } : undefined} tick={axisTick(cfg.xFontSize)} stroke={colors.border} angle={Number(cfg.xAngle ?? 0)}
      textAnchor={cfg.xAngle ? 'end' : 'middle'} height={(cfg.xAngle ? 60 : 30) + (cfg.xTitle ? 16 : 0)} interval={cfg.xInterval ?? 'preserveStartEnd'}
      label={cfg.xTitle ? { value: cfg.xTitle, position: 'insideBottom', offset: 0, fill: colors.muted, fontSize: 11 } : undefined} />
  );
  // bars / Pareto / areas stand on 0 (an 'auto' lower bound made a count of 1 invisible on an axis that started at 1)
  const fromZero = !isSpc && (type === 'bar' || type === 'pareto' || type === 'area' || type === 'histogram');
  const low = fromZero ? (dataMin: number) => Math.min(0, dataMin) : 'auto';
  const domain: [any, any] = pct ? [0, 100] : [cfg.yMin ?? low, cfg.yMax ?? 'auto'];
  const yAxis = (
    <YAxis yAxisId="l" hide={cfg.showY === false} tick={axisTick(cfg.yFontSize)} stroke={colors.border} width={cfg.yTitle ? 64 : 52} domain={domain}
      scale={cfg.yLog ? 'log' : 'auto'} allowDataOverflow={cfg.yMin !== undefined || cfg.yMax !== undefined} allowDecimals={Number(cfg.decimals) === 0 ? false : undefined}
      tickFormatter={(v) => (pct ? `${v}%` : fmtAxis(v))}
      label={cfg.yTitle ? { value: cfg.yTitle, angle: -90, position: 'insideLeft', fill: colors.muted, fontSize: 11 } : undefined} />
  );
  const hasRight = type === 'pareto' || overrides.some((o) => o?.axis === 'right');
  const yRight = hasRight ? (
    <YAxis yAxisId="r" orientation="right" tick={axisTick(cfg.yFontSize)} stroke={colors.border} width={48} domain={type === 'pareto' ? [0, 100] : ['auto', 'auto']}
      tickFormatter={(v) => (type === 'pareto' ? `${v}%` : fmtAxis(v))}
      label={cfg.y2Title ? { value: cfg.y2Title, angle: 90, position: 'insideRight', fill: colors.muted, fontSize: 11 } : undefined} />
  ) : null;
  const grid = cfg.grid !== false ? <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={horizontal || !!cfg.gridV} horizontal={!horizontal} /> : null;

  // reference / analytics lines
  const refs: RefLine[] = [...((cfg.refLines as RefLine[] | undefined) ?? [])];
  if (cfg.avgLine && data.series[0]) {
    const vals = data.series[0].values.filter((v): v is number => v !== null);
    if (vals.length) refs.push({ value: vals.reduce((a, b) => a + b, 0) / vals.length, label: 'เฉลี่ย', color: '#F59E0B', dash: true });
  }
  if (type === 'pareto') refs.push({ value: cfg.paretoTarget ?? 80, label: `${cfg.paretoTarget ?? 80}%`, color: '#E5484D', dash: true, axis: 'right' });
  if (isSpc) {
    const lim = (v: number | undefined, label: string, color: string) => v !== undefined && refs.push({ value: v, label: `${label} ${fmt(v)}`, color, dash: label === 'CL' ? false : true });
    lim(st.cl, 'CL', '#16A34A');
    if (cfg.showLimits !== false) { lim(st.ucl, 'UCL', '#E5484D'); lim(st.lcl, 'LCL', '#E5484D'); }
    if (cfg.usl !== undefined && cfg.usl !== '') refs.push({ value: Number(cfg.usl), label: `USL ${cfg.usl}`, color: '#8B5CF6', dash: true });
    if (cfg.lsl !== undefined && cfg.lsl !== '') refs.push({ value: Number(cfg.lsl), label: `LSL ${cfg.lsl}`, color: '#8B5CF6', dash: true });
  }
  const refEls = refs.map((r, i) => (
    <ReferenceLine key={`r${i}`} yAxisId={r.axis === 'right' && hasRight ? 'r' : 'l'} y={r.value} stroke={r.color || colors.danger} strokeDasharray={r.dash === false ? undefined : '5 4'}
      ifOverflow="extendDomain" label={r.label ? { value: r.label, fill: r.color || colors.muted, fontSize: 11, position: 'insideTopRight' } : undefined} />
  ));

  const curve = isSpc ? 'linear' : cfg.curve ?? 'monotone';
  const lw = cfg.lineWidth ?? 2.5;
  const showDots = cfg.dots ?? (rows.length <= 31);
  const radius = Number(cfg.barRadius ?? 6);
  const labelFmt = (v: any) => (pct ? `${Math.round(Number(v))}%` : makeFmt({ ...cfg, unit: cfg.labelUnit ?? cfg.unit ?? 'auto', decimals: cfg.labelDecimals ?? cfg.decimals })(v));
  const labelPos = (cfg.labelPos ?? (stacked ? 'center' : 'top')) as any;
  const label = (key: string, pos = labelPos) => (cfg.labels ? <LabelList dataKey={key} position={horizontal && pos === 'top' ? 'right' : pos} {...labelStyle} formatter={labelFmt} /> : null);

  const seriesEls = data.series.map((s, i) => {
    const o = overrides[i] ?? {};
    const base = type === 'line' || isSpc ? 'line' : type === 'area' ? 'area' : 'bar';
    const kind = o.type ?? base;
    const color = o.color || pal[i % pal.length];
    const axis = o.axis === 'right' && hasRight ? 'r' : 'l';
    const name = o.name || s.name;
    if (kind === 'line')
      return (
        <Line key={s.key} yAxisId={axis} dataKey={s.key} name={name} type={curve} stroke={color} strokeWidth={lw} isAnimationActive={animate} connectNulls
          dot={isSpc ? (p: any) => <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={oocPoint(p.payload[s.key]) ? '#E5484D' : color} stroke="#fff" strokeWidth={1} /> : showDots ? { r: 3 } : false}>
          {label(s.key, 'top')}
        </Line>
      );
    if (kind === 'area')
      return (
        <Area key={s.key} yAxisId={axis} dataKey={s.key} name={name} type={curve} stroke={color} strokeWidth={lw} fill={color} fillOpacity={cfg.areaOpacity ?? 0.22}
          stackId={stacked ? 'a' : undefined} isAnimationActive={animate} connectNulls>{label(s.key)}</Area>
      );
    return (
      <Bar key={s.key} yAxisId={axis} dataKey={s.key} name={name} fill={color} stackId={stacked ? 'a' : undefined} isAnimationActive={animate}
        radius={stacked ? 0 : horizontal ? [0, radius, radius, 0] : [radius, radius, 0, 0]} maxBarSize={cfg.barMaxSize ?? (type === 'histogram' ? 200 : 56)}
        stroke={cfg.barBorder ? cfg.barBorderColor || '#fff' : undefined} strokeWidth={cfg.barBorder ? 1 : 0}>
        {cfg.colorByCategory && data.series.length === 1 && rows.map((_, ri) => <Cell key={ri} fill={pal[ri % pal.length]} />)}
        {label(s.key)}
      </Bar>
    );
  });

  return (
    <ResponsiveContainer>
      <ComposedChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} barCategoryGap={type === 'histogram' ? 1 : `${cfg.barGap ?? 22}%`} barGap={cfg.seriesGap ?? 4}>
        {grid}
        {horizontal ? (
          <>
            <XAxis type="number" tick={axisTick(cfg.xFontSize)} stroke={colors.border} domain={pct ? [0, 100] : [cfg.yMin ?? low, cfg.yMax ?? 'auto']} tickFormatter={(v) => (pct ? `${v}%` : fmtAxis(v))} />
            <YAxis yAxisId="l" type="category" dataKey="name" tick={axisTick(cfg.yFontSize)} stroke={colors.border} width={cfg.catWidth ?? 96} />
          </>
        ) : <>{xAxis}{yAxis}{yRight}</>}
        {tooltip}{legend}
        {isSpc && st.ucl !== undefined && st.lcl !== undefined && cfg.bandShade !== false && !horizontal && (
          <ReferenceArea yAxisId="l" y1={st.lcl} y2={st.ucl} fill="#16A34A" fillOpacity={0.05} ifOverflow="extendDomain" />
        )}
        {seriesEls}
        {type === 'pareto' && (
          <Line yAxisId="r" dataKey="__cum" name="สะสม %" type="monotone" stroke={cfg.cumColor || '#E5484D'} strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={animate}>
            {cfg.labels && <LabelList dataKey="__cum" position="top" {...labelStyle} formatter={(v: any) => `${Math.round(Number(v))}%`} />}
          </Line>
        )}
        {refEls}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
