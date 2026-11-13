import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, ExternalLink, GitFork, ScanLine, Search } from 'lucide-react';
import { filesApi, sheetsApi } from '@/api/endpoints';
import { loadCols } from '@/lib/dashCols';
import { toast } from '@/store/ui';
import type { Column, Sheet } from '@/types';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextInput } from '@/components/ui/Inputs';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { FilePicker, PickedFile } from '@/components/files/FilePicker';
import { levelsOf, traceApi, TimeGroup, TraceData, TraceNode } from '@/modules/trace/api';
import { TraceGraph } from '@/modules/trace/TraceGraph';
import { DataSearch } from '@/modules/dataSearch/DataSearch';
import { InkTrace } from '@/modules/inkcode/InkTrace';

const msg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } }; message?: string }).response?.data?.error?.message ?? (e as Error).message;

/** Menu "Search": search every sheet for a word (default) or trace a lot (Traceback) */
export default function SearchHubPage() {
  const [sp, setSp] = useSearchParams();
  const mode: 'data' | 'trace' | 'ink' = sp.get('mode') === 'ink' ? 'ink' : sp.get('mode') === 'trace' || sp.get('row') ? 'trace' : 'data';
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-4 p-4">
      <PageHeader icon={<Search className="h-5 w-5" />} title="Search"
        subtitle={mode === 'ink' ? 'พิมพ์โค้ดที่ Ink บนสินค้า → วันที่ ไลน์ กะ เอกสาร และวัตถุดิบตามแผนผลิต' : mode === 'data' ? 'ค้นหาคำในข้อมูลทุกไฟล์ ทุกชีต ที่คุณมีสิทธิ์' : 'ค้นหาล็อต/รหัสแล้วดูว่าทำมาจากอะไร และถูกนำไปใช้ที่ไหน (การผสม และรายการบนรถเข็น)'} />
      <Segmented value={mode} onChange={(m) => setSp(m === 'data' ? {} : { mode: m }, { replace: true })}
        options={[{ value: 'data', label: 'ค้นหาทุกข้อมูล', icon: <Search /> }, { value: 'trace', label: 'ย้อนรอย (Traceback)', icon: <GitFork /> }, { value: 'ink', label: 'โค้ด Ink', icon: <ScanLine /> }]} />
      {mode === 'data' ? <DataSearch /> : mode === 'ink' ? <InkTrace /> : <TracebackView />}
    </div>
  );
}

/** Traceback: find a lot / mapping_id and see what it was made of and where it went */
function TracebackView() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetId, setSheetId] = useState('');
  const [cols, setCols] = useState<Column[]>([]);
  const [colId, setColId] = useState('');
  const [value, setValue] = useState('');
  const [dir, setDir] = useState<'both' | 'back' | 'forward'>('both');
  const [data, setData] = useState<TraceData | null>(null);
  const [sel, setSel] = useState<TraceNode | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [timeGroups, setTimeGroups] = useState<TimeGroup[] | null>(null);

  useEffect(() => { if (file) void filesApi.get(file.id).then((r) => setSheets(r.sheets)).catch(() => setSheets([])); }, [file]);
  useEffect(() => {
    if (!sheetId) { setCols([]); return; }
    void (async () => {
      const [c, d] = await Promise.all([loadCols(sheetId), sheetsApi.get(sheetId).catch(() => null)]);
      const list = c.filter((x) => !x.isDeleted);
      setCols(list);
      const key = d?.settings?.mix?.keyColumnId ?? d?.settings?.scanProfiles?.find((p) => p.keyColumnId)?.keyColumnId;
      setColId((cur) => (cur && list.some((x) => x.id === cur) ? cur : key ?? list[0]?.id ?? ''));
    })();
  }, [sheetId]);

  const run = async (rowId: string, d = dir) => {
    setBusy(true); setErr(''); setSel(null);
    try { const t = await traceApi.trace(rowId, d); setData(t); setSel(t.nodes.find((n) => n.rowId === t.startRowId) ?? null); setSp({ row: rowId }, { replace: true }); } catch (e) { setErr(msg(e)); setData(null); } finally { setBusy(false); }
  };
  const search = async () => {
    if (!sheetId || !colId || !value.trim()) return;
    setBusy(true); setErr('');
    try { const f = await traceApi.find(sheetId, colId, value.trim()); await run(f.rowId); } catch (e) { setErr(msg(e)); setData(null); setBusy(false); }
  };
  // rows of other tables linked to the selected row by time (set per sheet in "ตั้งค่าสแกน/ผสม › เชื่อมตามเวลา")
  useEffect(() => {
    setTimeGroups(null);
    if (!sel || sel.restricted) return;
    let live = true;
    void traceApi.timeLinks(sel.rowId).then((r) => live && setTimeGroups(r.groups)).catch(() => live && setTimeGroups([]));
    return () => { live = false; };
  }, [sel?.rowId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = sp.get('row'); if (r && !data) void run(r); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const csv = () => {
    if (!data) return;
    const lv = levelsOf(data);
    const rows = [['ระดับ', 'แถว', 'ชื่อ/รหัส', 'ไฟล์', 'ชีต', 'สร้างเมื่อ', 'รายละเอียด'], ...[...data.nodes].sort((a, b) => (lv.get(a.rowId) ?? 0) - (lv.get(b.rowId) ?? 0)).map((n) => [String(lv.get(n.rowId) ?? ''), String(n.rowNo), n.label ?? '', n.fileName, n.sheetName, n.createdAt, n.fields.map((f) => `${f.name}=${f.value}`).join('; ')])];
    const text = '﻿' + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'traceback.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast.success('ดาวน์โหลดแล้ว');
  };

  return (
    <div className="space-y-4">
      <div className="ds-card grid gap-3 p-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
        <Field label="ไฟล์"><FilePicker value={file} onChange={(f) => { setFile(f); setSheetId(''); }} /></Field>
        <Field label="ชีต"><Select value={sheetId} onChange={(e) => setSheetId(e.target.value)} disabled={!file}><option value="">— เลือกชีต —</option>{sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="ค้นหาจากคอลัมน์"><Select value={colId} onChange={(e) => setColId(e.target.value)} disabled={!sheetId}>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="ค่าที่ค้นหา"><TextInput value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void search()} placeholder="สแกนหรือพิมพ์ แล้วกด Enter" className="font-mono" /></Field>
        <div className="flex items-end"><Button icon={<Search className="h-4 w-4" />} onClick={() => void search()} loading={busy} disabled={!sheetId || !colId || !value.trim()}>ค้นหา</Button></div>
      </div>
      {err && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
      {data ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented size="sm" value={dir} onChange={(d) => { setDir(d); void run(data.startRowId, d); }} options={[{ value: 'both', label: 'ทั้งสองทิศ' }, { value: 'back', label: 'ทำมาจากอะไร' }, { value: 'forward', label: 'ไปอยู่ที่ไหน' }]} />
            <span className="text-xs text-muted">{data.nodes.length} แถว{data.truncated ? ' (แสดงบางส่วน)' : ''}</span>
            <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={csv}>ดาวน์โหลด CSV</Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
            <TraceGraph data={data} selected={sel?.rowId ?? null} onSelect={setSel} />
            <div className="ds-card space-y-2 p-4 text-sm">
              {sel ? (
                <>
                  <p className="text-base font-semibold">{sel.restricted ? 'ไม่มีสิทธิ์ดูข้อมูล' : sel.label ?? `แถว #${sel.rowNo}`}</p>
                  <p className="text-muted">#{sel.rowNo} · {sel.fileName} › {sel.sheetName}</p>
                  <p className="text-xs text-muted">สร้างเมื่อ {new Date(sel.createdAt).toLocaleString('th-TH')}</p>
                  {sel.fields.map((f) => <p key={f.name}><span className="text-muted">{f.name}: </span>{f.value}</p>)}
                  <div className="flex flex-wrap gap-2 pt-2">
                    {sel.rowId !== data.startRowId && <Button size="sm" variant="secondary" onClick={() => void run(sel.rowId)}>ย้อนรอยจากแถวนี้</Button>}
                    {!sel.restricted && <Button size="sm" variant="secondary" icon={<ExternalLink className="h-4 w-4" />} onClick={() => nav(`/files/${sel.fileId}?sheet=${sel.sheetId}`)}>เปิดชีต</Button>}
                  </div>
                </>
              ) : <p className="text-muted">กดที่กล่องเพื่อดูรายละเอียด</p>}
            </div>
          </div>
          {!!timeGroups?.length && (
            <div className="ds-card space-y-3 p-4">
              <p className="text-base font-semibold">เชื่อมตามช่วงเวลา — {sel?.label ?? `แถว #${sel?.rowNo}`}</p>
              {timeGroups.map((g) => (
                <div key={`${g.linkId}-${g.reverse}`} className="space-y-1.5">
                  <p className="text-sm font-medium">{g.name} <span className="text-xs font-normal text-muted">→ {g.other.fileName} › {g.other.sheetName}</span></p>
                  {g.restricted ? <p className="text-sm text-muted">ไม่มีสิทธิ์ดูตารางนี้</p>
                    : g.noTime ? <p className="text-sm text-muted">แถวนี้ยังไม่มีเวลาเริ่ม จึงเชื่อมไม่ได้</p>
                    : g.noKey ? <p className="text-sm text-muted">แถวนี้ยังไม่มีค่าที่ใช้จับคู่ (เช่น ไลน์) จึงเชื่อมไม่ได้</p>
                    : !g.matches.length ? <p className="text-sm text-muted">ไม่พบแถวที่ช่วงเวลาซ้อนกัน</p>
                    : (
                      <div className="overflow-x-auto rounded-lg border border-line">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-ink/5 text-left text-xs text-muted"><th className="px-3 py-1.5">แถว</th><th className="px-3 py-1.5">ชื่อ/รหัส</th><th className="px-3 py-1.5">เริ่ม</th><th className="px-3 py-1.5">สิ้นสุด</th><th className="px-3 py-1.5 text-right">ซ้อนกัน (นาที)</th><th /></tr></thead>
                          <tbody>
                            {g.matches.map((m) => (
                              <tr key={m.rowId} className="border-t border-line">
                                <td className="px-3 py-1.5">#{m.rowNo}</td>
                                <td className="px-3 py-1.5">{m.label ?? ''}<span className="ml-2 text-xs text-muted">{(m.fields ?? []).slice(0, 2).map((f) => `${f.name}: ${f.value}`).join(' · ')}</span></td>
                                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(m.start).toLocaleString('th-TH')}</td>
                                <td className="px-3 py-1.5 whitespace-nowrap">{m.end ? new Date(m.end).toLocaleString('th-TH') : 'ยังไม่จบ'}</td>
                                <td className="px-3 py-1.5 text-right tabular-nums">{m.overlapMin}</td>
                                <td className="px-2 text-right"><button type="button" className="text-xs text-primary hover:underline" onClick={() => void run(m.rowId)}>ย้อนรอยจากแถวนี้</button></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : !err && <EmptyState icon={<GitFork />} title="เลือกไฟล์ ชีต และค้นหาค่า" description="เช่น mapping_id ของล็อตที่ผสม หรือรหัสรถเข็น" />}
    </div>
  );
}
