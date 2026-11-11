import { FileText, LayoutTemplate, Minus, Pencil, Plus, Settings2 } from 'lucide-react';
import type { FormatDiff } from './api';
import { formatCount } from './api';

/** What changed in the format of a sheet: columns, their options / formulas, form settings and PDF layouts */
export function FormatDiffView({ diff, empty = 'รูปแบบไม่เปลี่ยน' }: { diff: FormatDiff | null; empty?: string }) {
  if (!diff) return null;
  if (!formatCount(diff)) return <p className="rounded-xl bg-ink/[.03] px-3 py-2 text-sm text-muted">{empty}</p>;
  const c = diff.columns;
  const Line = ({ icon, tone, children }: { icon: JSX.Element; tone: string; children: React.ReactNode }) => (
    <li className="flex items-start gap-2 text-sm"><span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md ${tone}`}>{icon}</span><span className="min-w-0">{children}</span></li>
  );
  return (
    <div className="rounded-2xl border border-line p-3">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><LayoutTemplate className="h-4 w-4 text-primary" />การเปลี่ยนรูปแบบ ({formatCount(diff)})</p>
      <ul className="space-y-1.5">
        {c.added.map((n) => <Line key={`a${n}`} icon={<Plus className="h-3 w-3" />} tone="bg-success/15 text-success">เพิ่มคอลัมน์ <b>{n}</b></Line>)}
        {c.removed.map((n) => <Line key={`r${n}`} icon={<Minus className="h-3 w-3" />} tone="bg-danger/15 text-danger">ลบคอลัมน์ <b>{n}</b></Line>)}
        {c.renamed.map((r) => <Line key={`n${r.from}`} icon={<Pencil className="h-3 w-3" />} tone="bg-warning/15 text-warning">เปลี่ยนชื่อคอลัมน์ <b>{r.from}</b> → <b>{r.to}</b></Line>)}
        {c.changed.map((x) => <Line key={`c${x.name}`} icon={<Pencil className="h-3 w-3" />} tone="bg-warning/15 text-warning">คอลัมน์ <b>{x.name}</b>: {x.what.join(', ')}</Line>)}
        {c.reordered && <Line icon={<Pencil className="h-3 w-3" />} tone="bg-warning/15 text-warning">เรียงลำดับคอลัมน์ใหม่</Line>}
        {diff.settings.map((s) => <Line key={`s${s}`} icon={<Settings2 className="h-3 w-3" />} tone="bg-primary/10 text-primary">แก้ <b>{s}</b></Line>)}
        {diff.pdf.added.map((n) => <Line key={`pa${n}`} icon={<FileText className="h-3 w-3" />} tone="bg-success/15 text-success">เพิ่มแม่แบบ PDF <b>{n}</b></Line>)}
        {diff.pdf.removed.map((n) => <Line key={`pr${n}`} icon={<FileText className="h-3 w-3" />} tone="bg-danger/15 text-danger">ลบแม่แบบ PDF <b>{n}</b></Line>)}
        {diff.pdf.changed.map((n) => <Line key={`pc${n}`} icon={<FileText className="h-3 w-3" />} tone="bg-warning/15 text-warning">แก้แม่แบบ PDF <b>{n}</b></Line>)}
      </ul>
    </div>
  );
}
