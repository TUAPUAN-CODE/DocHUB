import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScanLine, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { EmptyState } from '@/components/ui/misc';
import { toast } from '@/store/ui';
import { inkTraceApi, TraceResult } from './api';

type Vals = Record<string, string | number | null>;
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('th-TH', { maximumFractionDigits: 3 }) : String(v));
/** the raw-material columns shown (the rest of the row is in the record file) */
const LEAD = new Set(['วันที่ผลิต', 'เวลา', 'ไลน์', 'Doc.No (รายการ)', 'ประเทศ']);

/**
 * Search › ย้อนรอยโค้ด Ink: type (or scan) the code printed on a product → which day / line / shift / document it was, what the
 * production plan said about that run, and the raw materials of that run (from the record file left by the plan drop).
 */
export function InkTrace() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<TraceResult | null>(null);
  const run = async () => {
    if (q.trim().replace(/\s+/g, '').length < 3) { toast.error('พิมพ์โค้ดอย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true);
    try { setData(await inkTraceApi.trace(q.trim())); } catch (e) { toast.error(e, 'ค้นหาไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <form className="ds-card flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <div className="min-w-[240px] flex-1">
          <p className="mb-1 text-sm font-medium">โค้ดที่พิมพ์บนสินค้า (บรรทัดใดก็ได้ หรือบางส่วน — ไม่สนใจช่องว่าง)</p>
          <TextInput icon={<ScanLine />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น BBE:NOV 12, 2028 หรือ PWMAOF93R S9LCS3" autoFocus />
        </div>
        <Button type="submit" icon={<Search />} loading={busy}>ค้นหา</Button>
      </form>
      {data && !data.results.length && <div className="ds-card"><EmptyState icon={<ScanLine />} title="ไม่พบโค้ดนี้ในใบออกโค้ด" description="ตรวจการพิมพ์ หรือพิมพ์เฉพาะส่วนที่อ่านชัด เช่น 6–10 ตัวอักษร" /></div>}
      {data && data.results.length > 0 && <p className="text-sm text-muted">พบ {data.total} รายการ{data.truncated ? ' (แสดง 60 รายการแรก — พิมพ์โค้ดให้ยาวขึ้น)' : ''}</p>}
      {data?.results.map((r) => <TraceCard key={r.rowId} r={r} />)}
    </div>
  );
}

function TraceCard({ r }: { r: TraceResult['results'][number] }) {
  const row = r.row, item = r.plan?.item ?? null;
  const codes = [1, 2, 3, 4].map((n) => row[`Code Format แถว ${n}`]).filter((x) => x !== null && x !== '');
  const matCols = r.plan?.materials.length ? Object.keys(r.plan.materials.reduce((a, m) => ({ ...a, ...m }), {} as Vals)).filter((k) => !LEAD.has(k)) : [];
  const fact = (label: string, v: unknown) => <div className="min-w-0"><p className="text-[11px] text-muted">{label}</p><p className="break-words text-sm font-medium">{show(v)}</p></div>;
  return (
    <div className="ds-card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5 font-mono text-sm font-semibold">{codes.map((c, i) => <p key={i}>{String(c)}</p>)}</div>
        <Link to={`/files/${r.fileId}?sheet=${r.sheetId}`} className="text-sm text-primary hover:underline">ใบออกโค้ด {r.fileName} › {r.sheetName}</Link>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-6">
        {fact('วันที่ผลิต', row['วันที่ผลิต'])}{fact('เวลาเริ่ม', row['เวลาเริ่ม'] ?? item?.['เวลา'])}{fact('ไลน์', row['ไลน์'])}{fact('กะ', row['กะ'])}
        {fact('รหัสเอกสาร', row['รหัสเอกสาร'])}{fact('Market', row.Market)}{fact('ลูกค้า', row['ลูกค้า'])}{fact('ชนิด', row['ชนิด'])}{fact('Product Code SAP', row['Product Code SAP'])}
        {row['Remark (ไม่ Ink)'] && fact('Remark (ไม่ Ink)', row['Remark (ไม่ Ink)'])}
      </div>
      {!r.plan && <p className="rounded-lg bg-ink/5 px-3 py-2 text-xs text-muted">ไม่มีบันทึกแผนผลิตของวันนี้ (แผนที่นำเข้าก่อนมีระบบบันทึก หรือกรอกแถวเอง) — มีเฉพาะข้อมูลจากใบออกโค้ด</p>}
      {r.plan && (
        <div className="space-y-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">ตามแผนผลิต</p>
            <Link to={`/files/${r.plan.fileId}`} className="text-xs text-primary hover:underline">{r.plan.fileName}</Link>
          </div>
          {item && <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            {fact('Rev.', item['Rev.'])}{fact('ยอด', item['ยอด'])}{fact('Code', item.Code)}{fact('Doc.No อื่น (วัตถุดิบ)', item['Doc.No อื่นในรายการ'])}
            {fact('หัวบล็อก', item['หัวบล็อก'])}{fact('หมายเหตุยอด', item['หมายเหตุยอด'])}{fact('หมายเหตุ', item['หมายเหตุ'])}{fact('แจ้งเตือนตอนนำเข้า', item['แจ้งเตือน'])}
          </div>}
          {matCols.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-xs">
                <thead><tr className="border-b border-line text-left text-muted">{matCols.map((c) => <th key={c} className="px-2 py-1 font-medium">{c}</th>)}</tr></thead>
                <tbody>{r.plan.materials.map((m, i) => <tr key={i} className="border-b border-line/60">{matCols.map((c) => <td key={c} className="px-2 py-1 align-top">{show(m[c])}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
