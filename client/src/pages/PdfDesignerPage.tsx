import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, FileDown, FileJson, FilePlus2, FileUp, Files, Loader2, Share2, Plus, RefreshCw, Save, Settings2, Trash2 } from 'lucide-react';
import { apiError } from '@/api/client';
import { filesApi, foldersApi, pdfApi, rowsApi } from '@/api/endpoints';
import { FilePicker } from '@/components/files/FilePicker';
import { BLOCK_TYPES_BODY, BLOCK_TYPES_SIDE, ColumnsForm, FieldsForm, Group, ImageForm, LineForm, Num, PDF_SWATCHES, SpacerForm, SpacingForm, TableForm, TextForm } from '@/components/pdf/BlockForms';
import { WatermarkImage } from '@/components/pdf/WatermarkImage';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Inputs';
import { ColorInput, EmptyState, Skeleton } from '@/components/ui/misc';
import { MenuList, Popover } from '@/components/ui/Popover';
import { Modal } from '@/components/ui/Modal';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { loadCols } from '@/lib/dashCols';
import { generatePdf } from '@/lib/pdf/build';
import { Block, blockLabel, BlockType, defaultTemplate, newBlock, newTemplate, PDF_FONTS, PdfFont, PdfTemplate, uid } from '@/lib/pdf/types';
import { defaultExportValues } from '@/lib/pdf/exportValues';
import { getBlockModule, listBlockModules } from '@/lib/pdf/registry';
import '@/lib/pdf/blocks';
import '@/components/pdf/blocks';
import { getBlockForm } from '@/components/pdf/formRegistry';
import { PromptsEditor } from '@/components/pdf/PromptsEditor';
import { useAuth } from '@/store/auth';
import { confirmDialog, toast } from '@/store/ui';
import { Column, LV } from '@/types';

type Scope = 'body' | 'header' | 'footer';
type Sel = { kind: 'block'; scope: Scope; id: string } | { kind: 'page' };

const blockSummary = (b: Block) => {
  if (b.type === 'text') return b.text.replace(/\s+/g, ' ').slice(0, 34) || '(ว่าง)';
  if (b.type === 'table') return b.sheetName ? `${b.sheetName} · ${b.columns.length} คอลัมน์${b.rowsPerPage ? ` · ${b.rowsPerPage} แถว/หน้า` : ''}` : '(ยังไม่เลือกชีต)';
  if (b.type === 'image') return b.source === 'column' ? `รูปจากคอลัมน์ ${b.columnName ?? ''}` : b.url ? b.url.split('/').pop() ?? '' : '(ยังไม่มีรูป)';
  if (b.type === 'fields') return `${b.columns.length} ฟิลด์ · ${b.perRow} ช่อง/บรรทัด`;
  if (b.type === 'columns') return `${b.cols.length} คอลัมน์`;
  if (b.type === 'spacer') return `${b.height} mm`;
  return getBlockModule(b.type)?.summary?.(b) ?? '';
};

export default function PdfDesignerPage() {
  const { fileId = '' } = useParams();
  const me = useAuth((s) => s.user);
  const file = useLoad(() => filesApi.get(fileId), [fileId]);
  const saved = useLoad(() => pdfApi.get(fileId), [fileId]);
  const sheets = file.data?.sheets ?? [];
  const fileName = file.data?.file.name ?? '';

  const [templates, setTemplates] = useState<PdfTemplate[]>([]);
  const [tid, setTid] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>({ kind: 'page' });
  const [scope, setScope] = useState<Scope>('body');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [add, setAdd] = useState(false);
  const addBtn = useRef<HTMLButtonElement>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareFolder, setShareFolder] = useState('');
  const [folders, setFolders] = useState<{ id: string; label: string }[]>([]);
  const openShare = async () => {
    setShareOpen(true);
    if (folders.length) return;
    try {
      const tree = await foldersApi.tree();
      const byId = new Map(tree.map((f) => [f.id, f]));
      const label = (id: string): string => { const f = byId.get(id); return f ? (f.parentId && byId.has(f.parentId) ? `${label(f.parentId)} › ${f.name}` : f.name) : ''; };
      setFolders(tree.map((f) => ({ id: f.id, label: label(f.id) })).sort((a, b) => a.label.localeCompare(b.label, 'th')));
    } catch (e) { toast.error(apiError(e).message); }
  };
  const applyShare = async () => {
    if (!shareFolder) return;
    try {
      if (dirty) await pdfApi.save(fileId, templates);
      setDirty(false);
      const r = await pdfApi.setFolderMaster(shareFolder, fileId);
      setShareOpen(false); toast.success(`ตั้งรูปแบบกลางให้ ${r.files.toLocaleString()} ไฟล์แล้ว`, 'แก้รูปแบบในไฟล์นี้ครั้งเดียว ทุกไฟล์จะเปลี่ยนตาม');
    } catch (e) { toast.error(apiError(e).message, 'ตั้งรูปแบบกลางไม่สำเร็จ'); }
  };
  const detachMaster = async () => {
    if (!(await confirmDialog({ title: 'เลิกใช้รูปแบบกลาง?', message: 'ไฟล์นี้จะได้สำเนารูปแบบปัจจุบันไว้แก้เอง และไม่เปลี่ยนตามไฟล์กลางอีก', confirmText: 'เลิกใช้' }))) return;
    try { await pdfApi.setMaster(fileId, null); saved.reload?.(); toast.success('เลิกใช้รูปแบบกลางแล้ว'); } catch (e) { toast.error(apiError(e).message); }
  };
  const [copyFile, setCopyFile] = useState<{ id: string; name: string; path: string } | null>(null);
  const [colsBySheet, setColsBySheet] = useState<Record<string, Column[]>>({});

  useEffect(() => {
    if (!saved.data || !file.data) return;
    const list = (saved.data.templates as PdfTemplate[]) ?? [];
    setTemplates(list);
    setTid(list[0]?.id ?? null);
    setDirty(false);
  }, [saved.data, file.data?.file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const tpl = templates.find((t) => t.id === tid) ?? null;
  const patch = useCallback((p: Partial<PdfTemplate> | ((t: PdfTemplate) => PdfTemplate)) => {
    setTemplates((ts) => ts.map((t) => (t.id === tid ? (typeof p === 'function' ? p(t) : { ...t, ...p }) : t)));
    setDirty(true);
  }, [tid]);

  // columns of every sheet (for forms)
  useEffect(() => { for (const s of sheets) if (!colsBySheet[s.id]) void loadCols(s.id).then((c) => setColsBySheet((m) => ({ ...m, [s.id]: c }))); }, [sheets]); // eslint-disable-line react-hooks/exhaustive-deps
  const perRowSheet = tpl?.mode === 'perRow' ? tpl.perRow?.sheetId ?? '' : '';
  const perRowColumns = colsBySheet[perRowSheet] ?? [];

  /* ---------- preview ---------- */
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ver, setVer] = useState(0);
  const prev = useRef<string | null>(null);
  const tplKey = useMemo(() => JSON.stringify(tpl), [tpl]);
  // a layout that follows the sheet being printed (every day file) is previewed with the first sheet of this file that has rows
  const [prevSheet, setPrevSheet] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!tpl?.followSheet || !sheets.length) { setPrevSheet(null); return; }
    let live = true;
    void (async () => {
      for (const sh of sheets) {
        try { const r = await rowsApi.query(sh.id, { page: 1, pageSize: 1, sorts: [], filters: [] }); if (r.total > 0) { if (live) setPrevSheet({ id: sh.id, name: sh.name }); return; } } catch (e) { console.error('preview sheet:', e); }
      }
      if (live) setPrevSheet(null);
    })();
    return () => { live = false; };
  }, [tpl?.followSheet, file.data?.file.id, ver]); // eslint-disable-line react-hooks/exhaustive-deps
  const previewCurrent = useMemo(() => (prevSheet ? { sheetId: prevSheet.id, sheetName: prevSheet.name, filters: [], sorts: [] } : null), [prevSheet]);
  useEffect(() => {
    if (!tpl || !file.data) { setUrl(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const { blob } = await generatePdf(tpl, { fileName, user: me?.displayName ?? '', current: previewCurrent, previewLimit: 40, values: defaultExportValues(tpl, me?.displayName ?? '') });
        if (!live) return;
        const u = URL.createObjectURL(blob);
        if (prev.current) URL.revokeObjectURL(prev.current);
        prev.current = u; setUrl(`${u}#toolbar=0&navpanes=0`);
      } catch (e) { if (live) setErr((e as Error).message || 'สร้างตัวอย่างไม่สำเร็จ'); } finally { if (live) setBusy(false); }
    }, 700);
    return () => { live = false; clearTimeout(t); };
  }, [tplKey, ver, file.data?.file.id, previewCurrent]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (prev.current) URL.revokeObjectURL(prev.current); }, []);

  /* ---------- template ops ---------- */
  const firstSheet = sheets[0];
  const addTemplate = async (mode: 'table' | 'perRow') => {
    const name = mode === 'table' ? 'รายงานใหม่' : 'แบบฟอร์มต่อแถว';
    let t = newTemplate(name, mode);
    if (firstSheet) {
      const cols = colsBySheet[firstSheet.id] ?? (await loadCols(firstSheet.id));
      const info = { id: firstSheet.id, name: firstSheet.name, columns: cols };
      if (mode === 'table') t = { ...defaultTemplate(fileName, info), id: t.id, name };
      else { t.perRow = { sheetId: firstSheet.id, sheetName: firstSheet.name, onlySelected: true }; t.blocks = [newBlock('text'), newBlock('fields', info)]; (t.blocks[0] as any).text = '{{file}}'; (t.blocks[0] as any).style = { fontSize: 18, bold: true, color: '#1552F0' }; }
    }
    setTemplates((ts) => [...ts, t]); setTid(t.id); setSel({ kind: 'page' }); setDirty(true);
  };
  const dupTemplate = () => { if (!tpl) return; const n = { ...JSON.parse(JSON.stringify(tpl)), id: uid(), name: `${tpl.name} (สำเนา)` }; setTemplates((ts) => [...ts, n]); setTid(n.id); setDirty(true); };
  const delTemplate = async () => {
    if (!tpl || !(await confirmDialog({ title: `ลบรูปแบบ “${tpl.name}”?`, danger: true, confirmText: 'ลบ' }))) return;
    const rest = templates.filter((t) => t.id !== tpl.id); setTemplates(rest); setTid(rest[0]?.id ?? null); setDirty(true);
  };
  const save = async () => {
    setSaving(true);
    try { await pdfApi.save(fileId, templates); setDirty(false); toast.success('บันทึกรูปแบบ PDF แล้ว', 'ทำสำเนาไฟล์แล้วรูปแบบจะถูกคัดลอกไปด้วย'); } catch (e) { toast.error(e); } finally { setSaving(false); }
  };
  const download = async () => {
    if (!tpl) return;
    setBusy(true);
    try { const { blob, truncated } = await generatePdf(tpl, { fileName, user: me?.displayName ?? '', current: previewCurrent, values: defaultExportValues(tpl, me?.displayName ?? '') }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${fileName} - ${tpl.name}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); if (truncated) toast.info('ข้อมูลเกินกำหนด', 'ส่งออกเฉพาะ 50,000 แถวแรก'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const exportJson = () => {
    if (!tpl) return;
    const blob = new Blob([JSON.stringify({ kind: 'datasheet-pdf-template', version: 1, template: tpl }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `pdf-template - ${tpl.name}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.kind !== 'datasheet-pdf-template' || !j.template) throw new Error('ไม่ใช่ไฟล์รูปแบบ PDF ของระบบนี้');
      const t = j.template as PdfTemplate;
      const remap = (node: any): any => {
        if (Array.isArray(node)) return node.map(remap);
        if (node && typeof node === 'object') {
          const o: any = {}; for (const k of Object.keys(node)) o[k] = remap(node[k]);
          if ('sheetId' in o) { const s = sheets.find((x) => x.name.trim().toLowerCase() === String(o.sheetName ?? '').trim().toLowerCase()) ?? sheets[0]; if (s) { o.sheetId = s.id; o.sheetName = s.name; } }
          return o;
        }
        return node;
      };
      const n = { ...remap(t), id: uid(), name: `${t.name} (นำเข้า)` } as PdfTemplate;
      setTemplates((ts) => [...ts, n]); setTid(n.id); setDirty(true); toast.success('นำเข้ารูปแบบแล้ว', 'ตารางจะจับคู่ชีต/คอลัมน์ตามชื่อ');
    } catch (e) { toast.error((e as Error).message, 'นำเข้าไม่สำเร็จ'); }
  };
  const copyFrom = async () => {
    if (!copyFile) return;
    try {
      if (dirty && !(await confirmDialog({ title: 'มีการแก้ไขที่ยังไม่บันทึก', message: 'การคัดลอกจะบันทึกรูปแบบปัจจุบันก่อน', confirmText: 'บันทึกและคัดลอก' }))) return;
      if (dirty) await pdfApi.save(fileId, templates);
      const r = await pdfApi.copyFrom(fileId, copyFile.id);
      setTemplates(r.templates as PdfTemplate[]); setDirty(false); setCopyOpen(false); toast.success('คัดลอกรูปแบบ PDF แล้ว', 'ชีตและคอลัมน์ถูกจับคู่ตามชื่อ');
    } catch (e) { toast.error(apiError(e).message, 'คัดลอกไม่สำเร็จ'); }
  };

  /* ---------- blocks ---------- */
  const listOf = (t: PdfTemplate, s: Scope): Block[] => (s === 'body' ? t.blocks : s === 'header' ? t.header.blocks : t.footer.blocks) as Block[];
  const setList = (s: Scope, blocks: Block[]) => patch((t) => (s === 'body' ? { ...t, blocks } : s === 'header' ? { ...t, header: { ...t.header, blocks: blocks as any } } : { ...t, footer: { ...t.footer, blocks: blocks as any } }));
  const addBlock = async (type: BlockType) => {
    if (!tpl) return;
    let sheet: { id: string; name: string; columns: Column[] } | null = null;
    const sid = tpl.mode === 'perRow' ? tpl.perRow?.sheetId : firstSheet?.id;
    const s = sheets.find((x) => x.id === sid) ?? firstSheet;
    if (s) sheet = { id: s.id, name: s.name, columns: colsBySheet[s.id] ?? (await loadCols(s.id)) };
    const b = newBlock(type, sheet);
    setList(scope, [...listOf(tpl, scope), b]); setSel({ kind: 'block', scope, id: b.id });
  };
  const move = (i: number, d: number) => { if (!tpl) return; const l = [...listOf(tpl, scope)]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; setList(scope, l); };
  const dupBlock = (i: number) => { if (!tpl) return; const l = [...listOf(tpl, scope)]; const c = { ...JSON.parse(JSON.stringify(l[i])), id: uid() }; l.splice(i + 1, 0, c); setList(scope, l); setSel({ kind: 'block', scope, id: c.id }); };
  const delBlock = (i: number) => { if (!tpl) return; const l = listOf(tpl, scope).filter((_, j) => j !== i); setList(scope, l); setSel({ kind: 'page' }); };
  const updBlock = (s: Scope, id: string, p: Partial<Block>) => { if (!tpl) return; setList(s, listOf(tpl, s).map((b) => (b.id === id ? ({ ...b, ...p } as Block) : b))); };

  const selBlock = tpl && sel.kind === 'block' ? listOf(tpl, sel.scope).find((b) => b.id === sel.id) ?? null : null;
  const allowedMe = (file.data?.level ?? 0) >= LV.manage;

  if (file.loading || saved.loading) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-[70vh] w-full" /></div>;
  if (file.error || !file.data) return <div className="p-6"><div className="ds-card"><EmptyState title="เปิดไฟล์ไม่ได้" description={file.error?.message} /></div></div>;
  const master = saved.data?.master;
  if (master) {
    return (
      <div className="p-6"><div className="ds-card">
        <EmptyState title={`ไฟล์นี้ใช้รูปแบบ PDF กลางจาก “${master.name}”`} description="แก้รูปแบบที่ไฟล์ต้นทางครั้งเดียว ทุกไฟล์ที่ใช้รูปแบบกลางจะเปลี่ยนตามทันที"
          action={<div className="flex gap-2"><Link to={`/files/${master.id}/pdf`}><Button>ไปแก้ที่ไฟล์ต้นทาง</Button></Link><Button variant="secondary" onClick={detachMaster}>เลิกใช้รูปแบบกลาง (คัดลอกมาแก้เอง)</Button><Link to={`/files/${fileId}`}><Button variant="secondary">กลับไปที่ไฟล์</Button></Link></div>} />
      </div></div>
    );
  }
  if (!allowedMe) return <div className="p-6"><div className="ds-card"><EmptyState title="ออกแบบรูปแบบ PDF ได้เฉพาะเจ้าของไฟล์ / ผู้จัดการ / Admin" action={<Link to={`/files/${fileId}`}><Button>กลับไปที่ไฟล์</Button></Link>} /></div></div>;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col px-3 pb-3 sm:px-6">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <Link to={`/files/${fileId}`} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-ink/5" aria-label="กลับ"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0"><p className="truncate text-xs text-muted">{fileName}</p><h1 className="text-lg font-semibold">ออกแบบรูปแบบ PDF</h1></div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" icon={<Share2 className="h-4 w-4" />} onClick={() => void openShare()} disabled={!templates.length}>ใช้เป็นรูปแบบกลาง</Button>
          <Button variant="secondary" size="sm" icon={<Files className="h-4 w-4" />} onClick={() => setCopyOpen(true)}>คัดลอกจากไฟล์อื่น</Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium hover:border-primary/40"><FileUp className="h-4 w-4" />นำเข้า (.json)<input type="file" accept=".json,application/json" className="hidden" onChange={(e) => { void importJson(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <Button variant="secondary" size="sm" icon={<FileJson className="h-4 w-4" />} onClick={exportJson} disabled={!tpl}>ส่งออก (.json)</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={download} disabled={!tpl || busy}>ดาวน์โหลด PDF</Button>
          <Button size="sm" icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!dirty}>{dirty ? 'บันทึก' : 'บันทึกแล้ว'}</Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        {/* left: templates + structure */}
        <aside className="ds-card hidden w-[300px] shrink-0 flex-col overflow-hidden md:flex">
          <div className="space-y-2 border-b border-line p-3">
            <div className="flex gap-1.5">
              <Select value={tid ?? ''} onChange={(e) => { setTid(e.target.value); setSel({ kind: 'page' }); }} className="min-w-0 flex-1">
                {!templates.length && <option value="">— ยังไม่มีรูปแบบ —</option>}
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
              <IconButton label="ทำสำเนารูปแบบ" onClick={dupTemplate} disabled={!tpl}><Copy className="h-4 w-4" /></IconButton>
              <IconButton label="ลบรูปแบบ" onClick={delTemplate} disabled={!tpl}><Trash2 className="h-4 w-4" /></IconButton>
            </div>
            {tpl && <TextInput value={tpl.name} onChange={(e) => patch({ name: e.target.value })} className="!h-9" placeholder="ชื่อรูปแบบ" />}
            <div className="grid grid-cols-2 gap-1.5"><Button size="sm" variant="secondary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => void addTemplate('table')}>รายงานตาราง</Button><Button size="sm" variant="secondary" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => void addTemplate('perRow')}>ฟอร์มต่อแถว</Button></div>
          </div>
          {tpl ? (
            <>
              <button onClick={() => setSel({ kind: 'page' })} className={cn('flex items-center gap-2 border-b border-line px-3 py-2.5 text-left text-sm font-medium hover:bg-ink/5', sel.kind === 'page' && 'bg-primary/10 text-primary')}>
                <Settings2 className="h-4 w-4" />ตั้งค่ากระดาษ / ฟอนต์ / ลายน้ำ
              </button>
              <div className="flex border-b border-line p-1.5 text-xs">
                {(['header', 'body', 'footer'] as Scope[]).map((s) => (
                  <button key={s} onClick={() => setScope(s)} className={cn('flex-1 rounded-lg py-1.5 font-medium', scope === s ? 'bg-primary/10 text-primary' : 'text-muted hover:text-ink')}>{s === 'header' ? 'หัวกระดาษ' : s === 'body' ? 'เนื้อหา' : 'ท้ายกระดาษ'}</button>
                ))}
              </div>
              {scope !== 'body' && <div className="border-b border-line px-3 py-2"><Toggle checked={scope === 'header' ? tpl.header.enabled : tpl.footer.enabled} onChange={(v) => patch((t) => (scope === 'header' ? { ...t, header: { ...t.header, enabled: v } } : { ...t, footer: { ...t.footer, enabled: v } }))} label={<span className="text-sm">แสดง{scope === 'header' ? 'หัว' : 'ท้าย'}กระดาษทุกหน้า</span>} /></div>}
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
                {listOf(tpl, scope).map((b, i, arr) => (
                  <div key={b.id} onClick={() => setSel({ kind: 'block', scope, id: b.id })} className={cn('group flex cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1.5', sel.kind === 'block' && sel.id === b.id ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-ink/5')}>
                    <div className="min-w-0 flex-1"><p className="text-sm font-medium">{blockLabel(b.type)}</p><p className="truncate text-[11px] text-muted">{blockSummary(b)}</p></div>
                    <span className="hidden items-center group-hover:flex">
                      <button title="ขึ้น" disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(i, -1); }} className="rounded p-0.5 text-muted hover:bg-ink/10 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button title="ลง" disabled={i === arr.length - 1} onClick={(e) => { e.stopPropagation(); move(i, 1); }} className="rounded p-0.5 text-muted hover:bg-ink/10 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button title="ทำซ้ำ" onClick={(e) => { e.stopPropagation(); dupBlock(i); }} className="rounded p-0.5 text-muted hover:bg-ink/10"><Copy className="h-3.5 w-3.5" /></button>
                      <button title="ลบ" onClick={(e) => { e.stopPropagation(); delBlock(i); }} className="rounded p-0.5 text-muted hover:bg-danger/10 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                ))}
                {!listOf(tpl, scope).length && <p className="p-4 text-center text-xs text-muted">ยังไม่มีบล็อก กด “เพิ่มบล็อก” ด้านล่าง</p>}
              </div>
              <div className="border-t border-line p-2">
                <Button ref={addBtn} className="w-full" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setAdd(true)}>เพิ่มบล็อก</Button>
                <Popover open={add} onClose={() => setAdd(false)} anchor={addBtn.current} width={240}>
                  <MenuList onClose={() => setAdd(false)} items={[...(scope === 'body' ? BLOCK_TYPES_BODY.filter((t) => (tpl.mode === 'perRow' ? t !== 'table' : t !== 'fields')) : BLOCK_TYPES_SIDE).map((t) => ({ label: blockLabel(t), onClick: () => void addBlock(t) })),
                    ...listBlockModules(scope, tpl.mode).map((m) => ({ label: m.label, onClick: () => void addBlock(m.type as BlockType) }))]} />
                </Popover>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-4 text-center text-sm text-muted">เริ่มจากกด “รายงานตาราง” หรือ “ฟอร์มต่อแถว” ด้านบน</div>
          )}
        </aside>

        {/* center: live preview */}
        <section className="ds-card relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs text-muted">
            ตัวอย่างสด (ใช้ข้อมูลจริง 40 แถวแรกของแต่ละตาราง{prevSheet ? ` · ชีต ${prevSheet.name}` : ''}) {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <button onClick={() => setVer((v) => v + 1)} className="ml-auto inline-flex items-center gap-1 hover:text-primary"><RefreshCw className="h-3.5 w-3.5" />รีเฟรช</button>
          </div>
          <div className="relative min-h-0 flex-1 bg-ink/[.06]">
            {err && <p className="absolute inset-x-4 top-4 z-10 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
            {url ? <iframe title="ตัวอย่าง PDF" src={url} className="h-full w-full border-0" /> : <div className="grid h-full place-items-center text-sm text-muted">{tpl ? 'กำลังสร้างตัวอย่าง…' : 'ยังไม่มีรูปแบบ'}</div>}
          </div>
        </section>

        {/* right: properties */}
        <aside className="ds-card hidden w-[360px] shrink-0 overflow-y-auto p-4 lg:block">
          {!tpl ? <p className="text-sm text-muted">เลือกหรือสร้างรูปแบบทางซ้าย</p>
            : sel.kind === 'page' ? <PageSettings t={tpl} patch={patch} sheets={sheets} colsBySheet={colsBySheet} />
            : selBlock ? (
              <div className="space-y-4">
                <p className="text-sm font-semibold text-primary">{blockLabel(selBlock.type)}</p>
                {selBlock.type === 'text' && <TextForm b={selBlock} prompts={tpl.prompts} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'image' && <ImageForm b={selBlock} perRow={tpl.mode === 'perRow'} columns={perRowColumns} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'line' && <LineForm b={selBlock} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'spacer' && <SpacerForm b={selBlock} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'columns' && <ColumnsForm b={selBlock} perRow={tpl.mode === 'perRow'} columns={perRowColumns} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'table' && <TableForm b={selBlock} sheets={sheets} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'fields' && <FieldsForm b={selBlock} columns={perRowColumns} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {(() => { const Form = getBlockForm(selBlock.type); return Form ? <Form block={selBlock} template={tpl} onChange={(p: any) => updBlock(sel.scope, selBlock.id, p)} /> : null; })()}
                {selBlock.type !== 'pageBreak' && <SpacingForm b={selBlock} onChange={(p) => updBlock(sel.scope, selBlock.id, p)} />}
                {selBlock.type === 'pageBreak' && <p className="text-sm text-muted">เนื้อหาถัดจากบล็อกนี้จะขึ้นหน้าใหม่</p>}
              </div>
            ) : <p className="text-sm text-muted">เลือกบล็อกทางซ้ายเพื่อแก้ไข</p>}
        </aside>
      </div>

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} size="md" icon={<Share2 className="h-5 w-5" />} title="ใช้รูปแบบ PDF ของไฟล์นี้เป็นรูปแบบกลาง"
        description="ทุกไฟล์ในโฟลเดอร์ที่เลือก (รวมโฟลเดอร์ย่อย) จะใช้รูปแบบของไฟล์นี้ — แก้ที่นี่ที่เดียว ทุกไฟล์เปลี่ยนตาม (ไฟล์เหล่านั้นจะไม่มีรูปแบบของตัวเองอีก ยกเลิกได้ภายหลัง) · เปิด “ใช้กับชีตที่กำลังพิมพ์” ในรูปแบบนี้ เพื่อให้ใช้ได้กับทุกชีตรายวัน"
        footer={<><Button variant="secondary" onClick={() => setShareOpen(false)}>ยกเลิก</Button><Button onClick={applyShare} disabled={!shareFolder}>ตั้งเป็นรูปแบบกลาง</Button></>}>
        <Field label="โฟลเดอร์"><Select value={shareFolder} onChange={(e) => setShareFolder(e.target.value)}><option value="">— เลือกโฟลเดอร์ —</option>{folders.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</Select></Field>
      </Modal>
      <Modal open={copyOpen} onClose={() => setCopyOpen(false)} size="md" icon={<Files className="h-5 w-5" />} title="คัดลอกรูปแบบ PDF จากไฟล์อื่น"
        description="รูปแบบทั้งหมดของไฟล์ต้นทางจะถูกเพิ่มเข้าไฟล์นี้ โดยจับคู่ชีตและคอลัมน์ตามชื่อ"
        footer={<><Button variant="secondary" onClick={() => setCopyOpen(false)}>ยกเลิก</Button><Button icon={<FileDown className="h-4 w-4" />} onClick={copyFrom} disabled={!copyFile}>คัดลอก</Button></>}>
        <Field label="ไฟล์ต้นทาง"><FilePicker value={copyFile} onChange={setCopyFile} placeholder="เลือกไฟล์ที่ตั้งรูปแบบ PDF ไว้แล้ว" /></Field>
      </Modal>
    </div>
  );
}

function PageSettings({ t, patch, sheets, colsBySheet }: { t: PdfTemplate; patch: (p: Partial<PdfTemplate>) => void; sheets: { id: string; name: string }[]; colsBySheet: Record<string, Column[]> }) {
  const m = t.page.margins;
  const setPage = (p: Partial<PdfTemplate['page']>) => patch({ page: { ...t.page, ...p } });
  return (
    <div className="space-y-4">
      <Group title="โหมดเอกสาร">
        <Field label="รูปแบบ"><Select value={t.mode} onChange={(e) => patch({ mode: e.target.value as PdfTemplate['mode'], perRow: e.target.value === 'perRow' ? t.perRow ?? { sheetId: sheets[0]?.id ?? '', sheetName: sheets[0]?.name ?? '', onlySelected: true } : t.perRow })}><option value="table">รายงานตาราง (หลายแถวในตาราง)</option><option value="perRow">แบบฟอร์มต่อแถว (1 แถว = 1 หน้า)</option></Select></Field>
        <Toggle checked={!!t.followSheet} onChange={(v) => patch({ followSheet: v || undefined })} label="ใช้กับชีตที่กำลังพิมพ์ (ใช้รูปแบบเดียวกับทุกชีตรายวัน/ทุกไฟล์ที่มีคอลัมน์ชื่อเหมือนกัน)" />
        {t.mode === 'perRow' && t.perRow && (
          <>
            <Field label="ชีตที่ใช้พิมพ์"><Select value={t.perRow.sheetId} onChange={(e) => patch({ perRow: { ...t.perRow!, sheetId: e.target.value, sheetName: sheets.find((s) => s.id === e.target.value)?.name ?? '' } })}>{sheets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Toggle checked={t.perRow.onlySelected} onChange={(v) => patch({ perRow: { ...t.perRow!, onlySelected: v } })} label="พิมพ์เฉพาะแถวที่เลือกในตาราง (ถ้าไม่ได้เลือก = ทุกแถวตามตัวกรอง)" />
            <div className="max-w-[12rem]"><Num label="จำนวนฟอร์ม (แถว) ต่อ 1 หน้า" value={t.perRow.rowsPerPage ?? 1} onChange={(v) => patch({ perRow: { ...t.perRow!, rowsPerPage: Math.max(1, Math.round(v ?? 1)) } })} min={1} max={20} /></div>
            <Field label="จัดกลุ่มตามคอลัมน์ (เช่น Market / ลูกค้า — แต่ละกลุ่มขึ้นหน้าใหม่ และใช้ {{group}} ในข้อความได้)">
              <Select value={t.perRow.groupBy ?? ''} onChange={(e) => patch({ perRow: { ...t.perRow!, groupBy: e.target.value || undefined } })}>
                <option value="">ไม่จัดกลุ่ม</option>
                {(colsBySheet[t.perRow.sheetId] ?? []).map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
              </Select>
            </Field>
            <p className="text-[11px] text-muted">1 = แถวละหน้า · 4 = วาง 4 แถวต่อหน้า (คั่นเส้นประ) เช่น กระดาษ A3 แนวนอน</p>
            <Toggle checked={!!t.copies?.labels?.length} onChange={(v) => patch({ copies: v ? { labels: ['ฉบับที่ 1', 'ฉบับที่ 2'], separator: 'line' } : undefined })} label="พิมพ์ซ้ำหลายสำเนาต่อ 1 แถว (เช่น ใบ 4 ส่วน)" />
            {t.copies?.labels?.length ? (
              <div className="space-y-2 rounded-xl border border-line p-2.5">
                <Field label="ชื่อของแต่ละสำเนา (บรรทัดละ 1 สำเนา) — ใช้ {{copy}} และ {{copyLabel}} ในข้อความได้">
                  <TextArea rows={4} value={t.copies.labels.join('\n')} onChange={(e) => patch({ copies: { ...t.copies!, labels: e.target.value.split('\n').slice(0, 10) } })} />
                </Field>
                <Field label="คั่นระหว่างสำเนา"><Select value={t.copies.separator} onChange={(e) => patch({ copies: { ...t.copies!, separator: e.target.value as 'line' | 'pageBreak' | 'none' } })}><option value="line">เส้นประ (ต่อกันในหน้าเดียว)</option><option value="pageBreak">ขึ้นหน้าใหม่ทุกสำเนา</option><option value="none">ไม่คั่น</option></Select></Field>
              </div>
            ) : null}
          </>
        )}
      </Group>
      <Group title="กระดาษ">
        <div className="grid grid-cols-2 gap-2">
          <Field label="ขนาด"><Select value={t.page.size} onChange={(e) => setPage({ size: e.target.value as PdfTemplate['page']['size'] })}>{['A3', 'A4', 'A5', 'LETTER', 'LEGAL'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
          <Field label="ทิศทาง"><Select value={t.page.orientation} onChange={(e) => setPage({ orientation: e.target.value as 'portrait' | 'landscape' })}><option value="portrait">แนวตั้ง</option><option value="landscape">แนวนอน</option></Select></Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {(['top', 'bottom', 'left', 'right'] as const).map((k) => <Num key={k} label={`ขอบ${{ top: 'บน', bottom: 'ล่าง', left: 'ซ้าย', right: 'ขวา' }[k]}`} value={m[k]} onChange={(v) => setPage({ margins: { ...m, [k]: v ?? 10 } })} min={0} max={80} suffix="mm" />)}
        </div>
      </Group>
      <Group title="ฟอนต์พื้นฐาน">
        <div className="grid grid-cols-2 gap-2"><Field label="ฟอนต์"><Select value={t.base.font} onChange={(e) => patch({ base: { ...t.base, font: e.target.value as PdfFont } })}>{PDF_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}</Select></Field><Num label="ขนาด" value={t.base.fontSize} onChange={(v) => patch({ base: { ...t.base, fontSize: v ?? 11 } })} min={6} max={40} step={0.5} suffix="pt" /></div>
        <Field label="สีตัวอักษร"><ColorInput value={t.base.color} swatches={PDF_SWATCHES} onChange={(v) => patch({ base: { ...t.base, color: v ?? '#111827' } })} /></Field>
      </Group>
      <Group title="ลายน้ำ">
        <Toggle checked={t.watermark.enabled} onChange={(v) => patch({ watermark: { ...t.watermark, enabled: v } })} label="แสดงลายน้ำทุกหน้า" />
        {t.watermark.enabled && (
          <>
            <Field label="รูปลายน้ำ (ถ้าใส่ จะใช้รูปแทนข้อความ)"><WatermarkImage url={t.watermark.imageUrl} onChange={(u) => patch({ watermark: { ...t.watermark, imageUrl: u } })} /></Field>
            {t.watermark.imageUrl && <Num label="กว้างรูป" value={t.watermark.imageWidthMm ?? 120} onChange={(v) => patch({ watermark: { ...t.watermark, imageWidthMm: v ?? 120 } })} min={10} max={400} suffix="mm" />}
            <Field label="ข้อความ"><TextInput value={t.watermark.text} onChange={(e) => patch({ watermark: { ...t.watermark, text: e.target.value } })} /></Field>
            <div className="grid grid-cols-3 gap-2"><Num label="ขนาด" value={t.watermark.size} onChange={(v) => patch({ watermark: { ...t.watermark, size: v ?? 90 } })} min={10} max={300} /><Num label="จางมาก (0-1)" value={t.watermark.opacity} onChange={(v) => patch({ watermark: { ...t.watermark, opacity: v ?? 0.15 } })} min={0.02} max={1} step={0.01} /><Num label="องศา" value={t.watermark.angle} onChange={(v) => patch({ watermark: { ...t.watermark, angle: v ?? 0 } })} min={-90} max={90} /></div>
            <Field label="สี"><ColorInput value={t.watermark.color} swatches={PDF_SWATCHES} onChange={(v) => patch({ watermark: { ...t.watermark, color: v ?? '#9CA3AF' } })} /></Field>
          </>
        )}
      </Group>
      <Group title="คำถามก่อน export (ตัวแปรหัวเอกสาร)">
        <p className="text-[11px] text-muted">เช่น Line, Plant — ตอน export ระบบจะถามก่อน แล้วนำคำตอบไปใส่ในเอกสารที่ตัวแปร {'{{ชื่อตัวแปร}}'}</p>
        <PromptsEditor prompts={t.prompts ?? []} onChange={(prompts) => patch({ prompts })} />
        <Toggle checked={!!t.askOnExport} onChange={(v) => patch({ askOnExport: v })} label="ถามก่อน export ทุกครั้ง (เช่น เพื่อบันทึกเก็บเข้าระบบ)" />
      </Group>
      <Group title="กะทำงาน (ตัวแปร {{shift}})">
        <div className="grid grid-cols-2 gap-2">
          <Field label="กะเช้าเริ่ม"><TextInput value={t.settings?.shift?.dayStart ?? '06:00'} onChange={(e) => patch({ settings: { ...t.settings, shift: { ...t.settings?.shift, dayStart: e.target.value } } })} placeholder="06:00" className="!h-9" /></Field>
          <Field label="กะดึกเริ่ม"><TextInput value={t.settings?.shift?.nightStart ?? '18:00'} onChange={(e) => patch({ settings: { ...t.settings, shift: { ...t.settings?.shift, nightStart: e.target.value } } })} placeholder="18:00" className="!h-9" /></Field>
          <Field label="ชื่อกะเช้า"><TextInput value={t.settings?.shift?.dayLabel ?? 'DS'} onChange={(e) => patch({ settings: { ...t.settings, shift: { ...t.settings?.shift, dayLabel: e.target.value } } })} className="!h-9" /></Field>
          <Field label="ชื่อกะดึก"><TextInput value={t.settings?.shift?.nightLabel ?? 'NS'} onChange={(e) => patch({ settings: { ...t.settings, shift: { ...t.settings?.shift, nightLabel: e.target.value } } })} className="!h-9" /></Field>
        </div>
      </Group>
      <Group title="ความปลอดภัย"><Toggle checked={t.lockEditing} onChange={(v) => patch({ lockEditing: v })} label="ห้ามคัดลอก/แก้ไขเนื้อหาใน PDF (เปิดอ่านและพิมพ์ได้)" /></Group>
    </div>
  );
}
