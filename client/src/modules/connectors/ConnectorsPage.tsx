import { useCallback, useEffect, useMemo, useState } from 'react';
import { Database, Play, Plus, Trash2 } from 'lucide-react';
import { apiError } from '@/api/client';
import { filesApi } from '@/api/endpoints';
import { FilePicker, PickedFile } from '@/components/files/FilePicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Segmented, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, PageHeader } from '@/components/ui/misc';
import { fmtDateTime } from '@/lib/format';
import { loadCols } from '@/lib/dashCols';
import { confirmDialog, toast } from '@/store/ui';
import type { Column, Sheet } from '@/types';
import { Connector, Credentials, Preview, connectorsApi, emptyConnector, needsAuth } from './api';
import { AuthDialog } from './AuthDialog';

const norm = (s: string) => s.toLowerCase().replace(/[\s_.-]+/g, '');
const SCHEDULES = [{ v: 0, t: 'ดึงเมื่อกดเอง' }, { v: 5, t: 'ทุก 5 นาที' }, { v: 15, t: 'ทุก 15 นาที' }, { v: 60, t: 'ทุก 1 ชั่วโมง' }, { v: 360, t: 'ทุก 6 ชั่วโมง' }, { v: 1440, t: 'ทุกวัน' }];

/** Pull data from another link / API into a sheet (like Power Query): source → format → mapping → table */
export default function ConnectorsPage() {
  const [items, setItems] = useState<Connector[]>([]);
  const [ms, setMs] = useState(false);
  const [edit, setEdit] = useState<Connector | null>(null);

  const load = useCallback(async () => { try { const r = await connectorsApi.list(); setItems(r.items); setMs(r.microsoft); } catch (e) { toast.error(apiError(e).message); } }, []);
  useEffect(() => { void load(); }, [load]);

  const runNow = async (c: Connector) => {
    try { const r = await connectorsApi.run(c.id!); toast.success(`อ่าน ${r.read} · เพิ่ม ${r.created} · อัปเดต ${r.updated}${r.skipped ? ` · ข้าม ${r.skipped}` : ''}`, 'ดึงข้อมูลสำเร็จ'); if (r.errors.length) toast.error(r.errors.slice(0, 3).join('\n'), 'บางแถวมีปัญหา'); }
    catch (e) { if (needsAuth(e)) setEdit(c); else toast.error(apiError(e).message, 'ดึงข้อมูลไม่สำเร็จ'); }
    void load();
  };
  const remove = async (c: Connector) => { if (await confirmDialog({ title: `ลบ “${c.name}”?`, message: 'ข้อมูลที่ดึงไปแล้วในตารางจะไม่ถูกลบ', danger: true, confirmText: 'ลบ' })) { await connectorsApi.remove(c.id!).catch((e) => toast.error(apiError(e).message)); void load(); } };

  return (
    <div className="mx-auto w-full max-w-[1100px] space-y-4 p-4">
      <PageHeader icon={<Database className="h-5 w-5" />} title="ดึงข้อมูลจากลิงก์ / API" subtitle="ตั้งค่าครั้งเดียว: ใส่ลิงก์ → กำหนดรูปแบบข้อมูล → จับคู่คอลัมน์ → บันทึกลงตาราง (ดึงเองหรือตั้งเวลาอัตโนมัติ)" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit(emptyConnector())}>สร้าง connector</Button>} />
      {!items.length ? <EmptyState title="ยังไม่มี connector" description="กด “สร้าง connector” เพื่อดึงข้อมูลจาก API, ไฟล์ CSV/Excel หรือลิงก์ SharePoint / OneDrive" /> : (
        <ul className="ds-card divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEdit(c)}>
                <p className="truncate font-medium">{c.name} <span className="text-xs text-muted">· {c.kind === 'sharepoint' ? 'SharePoint/OneDrive' : 'HTTP'}</span></p>
                <p className="truncate text-xs text-muted">{c.config.url}</p>
                <p className={`text-xs ${c.lastStatus === 'ok' ? 'text-emerald-600' : c.lastStatus ? 'text-danger' : 'text-muted'}`}>{c.lastStatus ? `${fmtDateTime(c.lastRunAt!)} — ${c.lastMessage ?? ''}` : 'ยังไม่เคยดึง'}</p>
              </button>
              <span className="text-xs text-muted">{SCHEDULES.find((s) => s.v === c.scheduleMin)?.t ?? `ทุก ${c.scheduleMin} นาที`}</span>
              <IconButton label="ดึงข้อมูลตอนนี้" onClick={() => void runNow(c)}><Play className="h-4 w-4" /></IconButton>
              <IconButton label="ลบ" onClick={() => void remove(c)}><Trash2 className="h-4 w-4" /></IconButton>
            </li>
          ))}
        </ul>
      )}
      {edit && <Editor key={edit.id ?? 'new'} initial={edit} msReady={ms} onClose={() => setEdit(null)} onSaved={() => { void load(); }} />}
    </div>
  );
}

function Editor({ initial, msReady, onClose, onSaved }: { initial: Connector; msReady: boolean; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState<Connector>(initial);
  const [pv, setPv] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [cols, setCols] = useState<Column[]>([]);
  const [auth, setAuth] = useState<string | null>(null);
  const [headersText, setHeadersText] = useState(Object.entries(initial.config.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n'));

  const cfg = (p: Partial<Connector['config']>) => setC((x) => ({ ...x, config: { ...x.config, ...p } }));
  useEffect(() => { if (file) void filesApi.get(file.id).then((r) => setSheets(r.sheets)).catch(() => setSheets([])); }, [file]);
  useEffect(() => { if (c.targetSheetId) void loadCols(c.targetSheetId).then((l) => setCols(l.filter((x) => !x.isDeleted))); else setCols([]); }, [c.targetSheetId]);

  const withHeaders = (x: Connector): Connector => ({ ...x, config: { ...x.config, headers: Object.fromEntries(headersText.split('\n').map((l) => l.split(/:(.*)/s)).filter((p) => p[0]?.trim() && p[1] !== undefined).map((p) => [p[0].trim(), p[1].trim()])) } });
  const ensureSaved = async (): Promise<Connector | null> => {
    const x = withHeaders(c);
    if (!x.name.trim()) { toast.error('ตั้งชื่อ connector ก่อน'); return null; }
    try {
      if (x.id) { const r = await connectorsApi.update(x); if (r.credentialsReset) toast.info('ลิงก์เปลี่ยน จึงล้างข้อมูลเข้าสู่ระบบเดิมแล้ว'); return x; }
      const { id } = await connectorsApi.create(x); const y = { ...x, id }; setC(y); onSaved(); return y;
    } catch (e) { toast.error(apiError(e).message, 'บันทึกไม่สำเร็จ'); return null; }
  };
  const doPreview = async (cred?: Credentials) => {
    const x = withHeaders(c);
    if (!x.config.url.trim()) return toast.error('ใส่ลิงก์ก่อน');
    setBusy(true);
    try {
      const saved = x.id ? x : await ensureSaved();   // saved first so that credentials / Microsoft sign-in have somewhere to live
      if (!saved) return;
      const p = await connectorsApi.preview(saved, cred);
      setPv(p);
      setC((cur) => (cur.mapping.length ? cur : { ...cur, mapping: [] }));
    } catch (e) {
      if (needsAuth(e)) setAuth(apiError(e).message); else toast.error(apiError(e).message, 'ดึงตัวอย่างไม่สำเร็จ');
    } finally { setBusy(false); }
  };
  const autoMap = () => {
    if (!pv) return;
    const used = new Set<string>();
    const m = pv.fields.flatMap((f) => { const col = cols.find((x) => !used.has(x.id) && norm(x.name) === norm(f)); if (!col) return []; used.add(col.id); return [{ source: f, columnId: col.id }]; });
    setC((x) => ({ ...x, mapping: m })); toast.info(`จับคู่อัตโนมัติ ${m.length} คอลัมน์ (ตามชื่อ)`);
  };
  const srcFor = (columnId: string) => c.mapping.find((m) => m.columnId === columnId)?.source ?? '';
  const setSrc = (columnId: string, source: string) => setC((x) => ({ ...x, mapping: [...x.mapping.filter((m) => m.columnId !== columnId), ...(source ? [{ source, columnId }] : [])] }));
  const save = async () => { const x = await ensureSaved(); if (x) { toast.success('บันทึกแล้ว'); onSaved(); onClose(); } };
  const keyOptions = useMemo(() => cols.filter((x) => c.mapping.some((m) => m.columnId === x.id)), [cols, c.mapping]);

  return (
    <Modal open onClose={onClose} size="xl" icon={<Database className="h-5 w-5" />} title={c.id ? 'แก้ไข connector' : 'สร้าง connector'}
      footer={<><Button variant="secondary" onClick={onClose}>ปิด</Button><Button onClick={() => void save()}>บันทึก</Button></>}>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">1) ต้นทาง</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="ชื่อ"><TextInput value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="เช่น ยอดผลิตประจำวัน PF1" /></Field>
            <Field label="ชนิดลิงก์"><Segmented size="sm" value={c.kind} onChange={(v) => setC({ ...c, kind: v })} options={[{ value: 'http', label: 'API / ไฟล์จากลิงก์ทั่วไป' }, { value: 'sharepoint', label: 'SharePoint / OneDrive' }]} /></Field>
          </div>
          <Field label="ลิงก์" hint={c.kind === 'sharepoint' ? (msReady ? 'วางลิงก์ที่กด “แชร์” จาก SharePoint/OneDrive (ไฟล์ Excel/CSV)' : '⚠ เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า MS_CLIENT_ID/MS_CLIENT_SECRET — ดู docs/CONNECTORS.md') : undefined}>
            <TextInput value={c.config.url} onChange={(e) => cfg({ url: e.target.value })} placeholder="https://…" />
          </Field>
          {c.kind === 'http' && (
            <div className="grid gap-3 md:grid-cols-[8rem_1fr]">
              <Field label="Method"><Select value={c.config.method} onChange={(e) => cfg({ method: e.target.value as 'GET' | 'POST' })}><option>GET</option><option>POST</option></Select></Field>
              <Field label="Headers (บรรทัดละ 1 ค่า  ชื่อ: ค่า) — ห้ามใส่รหัสผ่านที่นี่"><TextArea rows={2} value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder="Accept: application/json" /></Field>
            </div>
          )}
          {c.kind === 'http' && c.config.method === 'POST' && <Field label="Body"><TextArea rows={3} value={c.config.body ?? ''} onChange={(e) => cfg({ body: e.target.value })} /></Field>}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">2) รูปแบบข้อมูล</h3>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="ชนิดไฟล์"><Select value={c.config.format} onChange={(e) => cfg({ format: e.target.value as Connector['config']['format'] })}><option value="auto">ตรวจจับอัตโนมัติ</option><option value="json">JSON</option><option value="csv">CSV</option><option value="xlsx">Excel (.xlsx)</option></Select></Field>
            <Field label="JSON path ของรายการ" hint="เช่น data.items (ว่าง = ทั้งก้อน)"><TextInput value={c.config.jsonPath ?? ''} onChange={(e) => cfg({ jsonPath: e.target.value })} /></Field>
            <Field label="ชื่อชีต Excel">{pv?.sheetNames.length ? <Select value={c.config.sheetName ?? ''} onChange={(e) => cfg({ sheetName: e.target.value })}><option value="">ชีตแรก</option>{pv.sheetNames.map((n) => <option key={n}>{n}</option>)}</Select> : <TextInput value={c.config.sheetName ?? ''} onChange={(e) => cfg({ sheetName: e.target.value })} />}</Field>
            <Field label="แถวหัวคอลัมน์ (Excel/CSV)"><TextInput inputMode="numeric" value={c.config.headerRow ?? 1} onChange={(e) => cfg({ headerRow: Math.max(1, Number(e.target.value) || 1) })} /></Field>
          </div>
          <Button variant="secondary" onClick={() => void doPreview()} loading={busy}>ทดสอบดึงข้อมูล / ดูตัวอย่าง</Button>
          {pv && (
            <div className="space-y-2">
              <p className="text-xs text-muted">พบ {pv.total.toLocaleString()} แถว · {pv.fields.length} ฟิลด์</p>
              <div className="max-h-48 overflow-auto rounded-lg border border-line text-xs">
                <table className="w-full"><thead className="sticky top-0 bg-surface"><tr>{pv.fields.map((f) => <th key={f} className="whitespace-nowrap px-2 py-1 text-left font-semibold">{f}</th>)}</tr></thead>
                  <tbody>{pv.rows.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-line">{pv.fields.map((f) => <td key={f} className="max-w-[12rem] truncate px-2 py-1">{String(r[f] ?? '')}</td>)}</tr>)}</tbody></table>
              </div>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">3) บันทึกลงตาราง</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="ไฟล์ปลายทาง"><FilePicker value={file} onChange={(f) => { setFile(f); setC({ ...c, targetSheetId: null, mapping: [], keyColumnId: null }); }} /></Field>
            <Field label="ชีตปลายทาง"><Select value={c.targetSheetId ?? ''} onChange={(e) => setC({ ...c, targetSheetId: e.target.value || null, mapping: [], keyColumnId: null })} disabled={!file && !c.targetSheetId}>
              <option value="">— เลือกชีต —</option>{c.targetSheetId && !sheets.length && <option value={c.targetSheetId}>(ชีตที่เลือกไว้เดิม)</option>}{sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          </div>
          {c.targetSheetId && (
            <>
              <div className="flex items-center justify-between"><p className="text-xs text-muted">เลือกว่าแต่ละคอลัมน์ในตารางรับค่าจากฟิลด์ไหนของต้นทาง (ค่าจะถูกตรวจตามชนิดคอลัมน์เหมือนพิมพ์เอง)</p><Button size="sm" variant="secondary" onClick={autoMap} disabled={!pv}>จับคู่ตามชื่ออัตโนมัติ</Button></div>
              <div className="grid gap-2 md:grid-cols-2">
                {cols.filter((x) => x.dataType !== 'image').map((col) => (
                  <div key={col.id} className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5"><span className="w-2/5 truncate text-sm" title={col.name}>{col.name}</span>
                    {pv ? <Select value={srcFor(col.id)} onChange={(e) => setSrc(col.id, e.target.value)}><option value="">— ไม่ดึง —</option>{pv.fields.map((f) => <option key={f}>{f}</option>)}</Select> : <TextInput value={srcFor(col.id)} onChange={(e) => setSrc(col.id, e.target.value)} placeholder="ชื่อฟิลด์ต้นทาง" />}</div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="คอลัมน์คีย์ (ถ้ามีแถวเดิมที่คีย์ตรงกัน → อัปเดต, ไม่ตรง → เพิ่มใหม่)"><Select value={c.keyColumnId ?? ''} onChange={(e) => setC({ ...c, keyColumnId: e.target.value || null })}><option value="">ไม่ใช้ — เพิ่มแถวใหม่ทุกครั้ง</option>{keyOptions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
                <Field label="ดึงอัตโนมัติ"><Select value={String(c.scheduleMin)} onChange={(e) => setC({ ...c, scheduleMin: Number(e.target.value) })}>{SCHEDULES.map((s) => <option key={s.v} value={s.v}>{s.t}</option>)}</Select></Field>
              </div>
              {!c.keyColumnId && c.scheduleMin > 0 && <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">ตั้งเวลาดึงอัตโนมัติโดยไม่มีคอลัมน์คีย์ → ทุกรอบจะเพิ่มแถวซ้ำ แนะนำให้เลือกคอลัมน์คีย์</p>}
            </>
          )}
        </section>
        {auth && <AuthDialog open connector={c} message={auth} onClose={() => setAuth(null)} onReady={(cred) => void doPreview(cred)} />}
      </div>
    </Modal>
  );
}
