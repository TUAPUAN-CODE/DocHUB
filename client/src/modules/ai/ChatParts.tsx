import { Fragment, ReactNode } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Area, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts';
import { PALETTE } from '@/components/dashboard/ChartBody';
import { cn } from '@/lib/cn';
import { compactNumber, fmtNumber } from '@/lib/format';
import type { ChatChartData } from './api';

/** **bold**, `code` and - / 1. lists of the AI's answer (no HTML is ever injected: everything is made of React nodes) */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter((x) => x !== '').map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i} className="rounded bg-ink/[.08] px-1 py-px text-[.92em]">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const L = list; list = null;
    const Tag = L.ordered ? 'ol' : 'ul';
    blocks.push(<Tag key={blocks.length} className={cn('my-1 space-y-0.5 pl-5', L.ordered ? 'list-decimal' : 'list-disc')}>{L.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</Tag>);
  };
  for (const line of text.split('\n')) {
    const m = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (m) { const ordered = !!m[2]; if (list && list.ordered !== ordered) flush(); (list ??= { ordered, items: [] }).items.push(m[3]); continue; }
    flush();
    if (!line.trim()) { blocks.push(<div key={blocks.length} className="h-2" />); continue; }
    blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <div className={cn('space-y-0.5 break-words', className)}>{blocks}</div>;
}

const num = (v: unknown) => (v === null || v === undefined ? '' : fmtNumber(Number(v), Math.abs(Number(v)) >= 100 ? 0 : 2));
const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A chart (or small table) that the AI drew in the chat. `tall` = the chat is full screen. */
export function ChatChart({ c, tall }: { c: ChatChartData; tall?: boolean }) {
  const h = tall ? 340 : 230;
  const names = c.series.map((s) => s.name || 'ค่า');
  const rows = c.categories.map((cat, i) => ({ cat, ...Object.fromEntries(c.series.map((s, k) => [`s${k}`, s.values[i] ?? null])) }));
  const body = (() => {
    if (c.type === 'table') {
      return (
        <div className="max-h-72 overflow-auto rounded-xl border border-line/70">
          <table className="w-full min-w-max border-collapse text-[12.5px]">
            <thead className="sticky top-0 bg-ink/[.06] text-left"><tr><th className="px-3 py-1.5 font-semibold" />{names.map((n, i) => <th key={i} className="px-3 py-1.5 text-right font-semibold">{n}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line/60"><td className="px-3 py-1.5">{r.cat}</td>{names.map((_, k) => <td key={k} className="px-3 py-1.5 text-right tabular-nums">{num((r as any)[`s${k}`])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    if (c.type === 'pie' || c.type === 'doughnut') {
      const data = c.categories.map((name, i) => ({ name, value: Number(c.series[0]?.values[i]) || 0 })).filter((d) => d.value > 0);
      const total = data.reduce((t, d) => t + d.value, 0) || 1;
      return (
        <div style={{ height: h }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={c.type === 'doughnut' ? '48%' : 0} outerRadius="78%" paddingAngle={c.type === 'doughnut' ? 2 : 0} label={(e: any) => `${Math.round((e.value / total) * 100)}%`} labelLine={false}>
                {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => num(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      );
    }
    let data: Record<string, unknown>[] = rows;
    if (c.type === 'pareto') { // biggest first + cumulative share of the first series
      const sorted = [...rows].sort((a, b) => (Number((b as any).s0) || 0) - (Number((a as any).s0) || 0));
      const total = sorted.reduce((t, r) => t + (Number((r as any).s0) || 0), 0) || 1;
      let run = 0;
      data = sorted.map((r) => { run += Number((r as any).s0) || 0; return { ...r, pct: Math.round((run / total) * 1000) / 10 }; });
    }
    const line = c.type === 'line', area = c.type === 'area', pareto = c.type === 'pareto';
    const many = rows.length > 8;
    return (
      <div style={{ height: h }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 14, right: pareto ? 6 : 10, left: -6, bottom: many ? 22 : 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(var(--c-border) / .9)" />
            <XAxis dataKey="cat" tick={{ fontSize: 11 }} tickFormatter={(v) => short(String(v), many ? 10 : 16)} interval={0} angle={many ? -30 : 0} textAnchor={many ? 'end' : 'middle'} height={many ? 46 : 26} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => compactNumber(Number(v))} width={44} />
            {pareto && <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} width={38} />}
            <Tooltip formatter={(v: any, n: any) => (n === 'สะสม %' ? `${v}%` : num(v))} />
            {names.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
            {names.map((n, k) => (line
              ? <Line key={k} type="monotone" dataKey={`s${k}`} name={n} stroke={PALETTE[k % PALETTE.length]} strokeWidth={2.4} dot={rows.length <= 31} connectNulls />
              : area
                ? <Area key={k} type="monotone" dataKey={`s${k}`} name={n} stroke={PALETTE[k % PALETTE.length]} fill={PALETTE[k % PALETTE.length]} fillOpacity={0.2} strokeWidth={2.2} connectNulls />
                : <Bar key={k} dataKey={`s${k}`} name={n} fill={PALETTE[k % PALETTE.length]} radius={[6, 6, 0, 0]} maxBarSize={42}>{rows.length <= 14 && names.length === 1 && <LabelList dataKey={`s${k}`} position="top" formatter={(v: any) => compactNumber(Number(v))} style={{ fontSize: 10.5 }} />}</Bar>))}
            {pareto && <Line yAxisId="r" type="monotone" dataKey="pct" name="สะสม %" stroke="#E5484D" strokeWidth={2} dot={{ r: 3 }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  })();
  return (
    <figure className="mt-2 rounded-2xl border border-line/70 bg-white/60 p-3 dark:bg-white/5">
      {c.title && <figcaption className="mb-1 flex items-baseline justify-between gap-2 text-[13px] font-semibold"><span>{c.title}</span><span className="text-[11px] font-normal text-muted">{c.totalRows.toLocaleString()} แถว</span></figcaption>}
      {body}
    </figure>
  );
}
