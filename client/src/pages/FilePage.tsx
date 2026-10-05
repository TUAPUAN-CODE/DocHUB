import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ChevronRight, Columns3, Copy, Download, Expand, History, Lock, MoreHorizontal, Pencil, Pin, PinOff, Plus, Redo2, RotateCcw, Search, Share2, Shrink, Trash2, Undo2, Upload, ZoomIn, ZoomOut,
  ScanLine, Merge, Boxes, Cpu,
} from 'lucide-react';
import { apiError } from '@/api/client';
import { filesApi, pdfApi, requestsApi, rowsApi } from '@/api/endpoints';
import { defaultTemplate, PdfTemplate } from '@/lib/pdf/types';
import type { ExportValues } from '@/lib/pdf/build';
import { needsExportDialog, signersList } from '@/lib/pdf/exportValues';
import { ExportDialog } from '@/components/pdf/ExportDialog';
import { archiveApi } from '@/modules/exportArchive/api';
import { FlowsDialog } from '@/modules/approvals/FlowsDialog';
import { SignatureDialog } from '@/modules/approvals/SignatureDialog';
import { ArchiveDialog } from '@/modules/exportArchive/ArchiveDialog';
import { ArchiveOption, ArchiveOptionValue } from '@/modules/exportArchive/ArchiveOption';
import { ColumnManagerModal } from '@/components/builder/ColumnManagerModal';
import { DuplicateDialog, MetaModal, RequestAccessForm, ShareDialog } from '@/components/files/Dialogs';
import { FileGlyph } from '@/components/files/icons';
import { ColumnFilterMenu, FilterBar } from '@/components/sheet/ColumnFilterMenu';
import { SheetTabs } from '@/components/sheet/SheetTabs';
import { CellHistoryModal, RollbackModal, RowFormModal, RowHistoryModal, SheetTrashModal } from '@/components/sheet/SheetModals';
import { FilterBarSettings } from '@/components/sheet/FilterBarSettings';
import { ScanMixSettings } from '@/modules/scan/ScanMixSettings';
import { ScanDialog } from '@/modules/scan/ScanDialog';
import { MixDialog } from '@/modules/mix/MixDialog';
import { LinesDialog } from '@/modules/lines/LinesDialog';
import { DeviceBindingsDialog } from '@/modules/devices/DeviceBindingsDialog';
import { UnionBanner } from '@/components/sheet/UnionBanner';
import { ImportModal } from '@/components/sheet/ImportModal';
import { RowViewModal } from '@/components/sheet/RowViewModal';
import { SpreadsheetGrid } from '@/components/sheet/SpreadsheetGrid';
import { useSheetView } from '@/components/sheet/useSheetView';
import { Button, IconButton } from '@/components/ui/Button';
import { Select, TextInput } from '@/components/ui/Inputs';
import { AvatarStack, EmptyState, Pager, PermBadge, Skeleton, StarButton } from '@/components/ui/misc';
import { MenuList, Popover } from '@/components/ui/Popover';
import { isTyping, useDebounce, useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { downloadCsv, downloadXlsx } from '@/lib/csv';
import { fmtDateTime, levelToPerm } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import { Column, LV, Row, isBasicRole } from '@/types';

function NoAccessView({ info, onRetry }: { info: ReturnType<typeof apiError>; onRetry: () => void }) {
  const d = info.details ?? {};
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="ds-card ds-card-pad !p-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-warning/15 text-warning"><Lock className="h-8 w-8" /></span>
        <h1 className="mt-4 text-xl font-semibold">{info.code === 'NO_ACCESS' ? 'คุณยังไม่มีสิทธิ์เข้าถึงไฟล์นี้' : 'เปิดไฟล์ไม่ได้'}</h1>
        <p className="mt-1 text-sm text-muted">{d.name ? `“${d.name}”` : info.message}</p>
        {info.code === 'NO_ACCESS' && (d.pending ? (
          <div className="mt-6 rounded-2xl bg-primary/[.06] p-4 text-sm">
            <p className="font-medium text-primary">คำขอของคุณกำลังรอการอนุมัติ</p>
            <p className="mt-1 text-muted">ส่งเมื่อ {fmtDateTime(d.pending.createdAt)} · คุณจะได้รับการแจ้งเตือนเมื่อมีผลการพิจารณา</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={async () => { await requestsApi.cancel(d.pending.id); onRetry(); }}>ยกเลิกคำขอ</Button>
          </div>
        ) : <div className="mt-6"><RequestAccessForm target={{ type: 'file', id: d.targetId, name: d.name }} compact onDone={onRetry} /></div>)}
      </motion.div>
    </div>
  );
}

export default function FilePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const role = useAuth((s) => s.user?.role);
  const file = useLoad(() => filesApi.get(id), [id]);
  const sheets = file.data?.sheets ?? [];
  const sheetId = sheets.find((s) => s.id === sp.get('sheet'))?.id ?? sheets[0]?.id ?? null;
  const view = useSheetView(sheetId);
  const level = file.data?.level ?? 0;
  const union = view.detail?.union ?? null;
  const canWrite = level >= LV.write && !union; // a union sheet mirrors other sheets: edit them at the source
  const canManage = level >= LV.manage;

  const [search, setSearch] = useState('');
  const dsearch = useDebounce(search, 350);
  const [filterFor, setFilterFor] = useState<{ colId: string; el: HTMLElement } | null>(null);
  const [rowForm, setRowForm] = useState<{ row: Row | null } | null>(null);
  const [cellHist, setCellHist] = useState<{ row: Row; col: Column } | null>(null);
  const [rowHist, setRowHist] = useState<Row | null>(null);
  const [selRows, setSelRows] = useState<string[]>([]);
  const [rowView, setRowView] = useState<Row | null>(null);
  const [modal, setModal] = useState<'columns' | 'trash' | 'rollback' | 'import' | 'filterbar' | 'share' | 'rename' | 'dup' | 'scanmix' | 'scan' | 'mix' | 'lines' | 'devices' | null>(null);
  const [more, setMore] = useState(false);
  const [freeze, setFreeze] = useState(false);
  const [full, setFull] = useState(false);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const exportBtn = useRef<HTMLButtonElement>(null);
  const [exportMenu, setExportMenu] = useState(false);
  const freezeBtn = useRef<HTMLButtonElement>(null);
  const workspace = useRef<HTMLDivElement>(null);

  useEffect(() => { setSearch(''); }, [sheetId]);
  useEffect(() => { if (view.query.search !== dsearch) view.setQuery({ search: dsearch }); }, [dsearch]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e)) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(0.1); }
      else if (e.key === '-') { e.preventDefault(); zoom(-0.1); }
      else if (e.key === '0') { e.preventDefault(); view.setPrefs({ zoom: 1 }); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const zoom = (d: number) => view.setPrefs((p) => ({ zoom: Math.round(Math.min(2, Math.max(0.5, p.zoom + d)) * 10) / 10 }));
  const toggleFull = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await workspace.current?.requestFullscreen(); } catch { toast.info('เบราว์เซอร์ไม่รองรับโหมดเต็มจอ'); }
  };
  const exportRows = async (format: 'csv' | 'xlsx') => {
    if (!sheetId || !view.detail) return;
    try {
      const all: Row[] = [];
      for (let p = 1; p <= 200; p++) {
        const r = await rowsApi.query(sheetId, { page: p, pageSize: 1000, sorts: view.query.sorts, filters: view.query.filters, search: view.query.search || undefined });
        all.push(...r.rows);
        if (all.length >= r.total) break;
      }
      const name = `${file.data?.file.name ?? 'export'} - ${view.detail.sheet.name}`;
      if (format === 'xlsx') await downloadXlsx(name, view.detail.sheet.name, view.columns, all);
      else downloadCsv(name, view.columns, all);
      toast.success(`ส่งออก ${all.length.toLocaleString()} แถวแล้ว`);
    } catch (e) { toast.error(e); }
  };
  const exportCsv = () => exportRows('csv');
  const [pdfTpls, setPdfTpls] = useState<PdfTemplate[] | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  useEffect(() => { if (exportMenu && !pdfTpls) pdfApi.get(id).then((r) => setPdfTpls(r.templates as PdfTemplate[])).catch(() => setPdfTpls([])); }, [exportMenu]); // eslint-disable-line react-hooks/exhaustive-deps
  const [exportDlg, setExportDlg] = useState<PdfTemplate | null>(null);
  const [archiveOpt, setArchiveOpt] = useState<ArchiveOptionValue>({ enabled: false, note: '' });
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [flowsOpen, setFlowsOpen] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  /** a layout that asks questions / needs signer names opens the dialog first; the others export straight away */
  const startPdf = (t: PdfTemplate | null) => {
    if (t && needsExportDialog(t)) { setArchiveOpt({ enabled: false, note: '' }); setExportDlg(t); } else void exportPdf(t);
  };
  const exportPdf = async (t: PdfTemplate | null, values?: ExportValues, archive?: ArchiveOptionValue) => {
    if (!sheetId || !view.detail) return;
    setPdfBusy(true);
    const tid = toast.info('กำลังสร้าง PDF…', 'ไฟล์ใหญ่อาจใช้เวลาสักครู่');
    void tid;
    try {
      const { generatePdf } = await import('@/lib/pdf/build');
      const tpl = t ?? defaultTemplate(file.data?.file.name ?? 'export', { id: sheetId, name: view.detail.sheet.name, columns: view.columns });
      const { blob, truncated } = await generatePdf(tpl, {
        fileName: file.data?.file.name ?? '', user: useAuth.getState().user?.displayName ?? '', values,
        current: { sheetId, filters: view.query.filters, sorts: view.query.sorts, search: view.query.search || undefined, selectedRowIds: selRows },
      });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${file.data?.file.name ?? 'export'} - ${view.detail.sheet.name}${t ? ` - ${t.name}` : ''}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast.success('สร้าง PDF แล้ว', truncated ? 'ส่งออกเฉพาะ 50,000 แถวแรก' : undefined);
      if (archive?.enabled && t) {
        try {
          await archiveApi.create(id, blob, {
            title: `${file.data?.file.name ?? 'export'} - ${t.name}`, sheetId, templateId: t.id, templateName: t.name,
            filters: { filters: view.query.filters, sorts: view.query.sorts, search: view.query.search || null },
            prompts: values?.prompts, signers: signersList(t, values ?? {}), note: archive.note || null,
          });
          toast.success('บันทึกสำเนาเก็บเข้าระบบแล้ว', 'ดูได้ในเมนู “เอกสารที่ออกแล้ว”');
        } catch (e) { toast.error(apiError(e).message, 'สร้าง PDF แล้ว แต่บันทึกสำเนาเก็บเข้าระบบไม่สำเร็จ'); }
      }
    } catch (e) { toast.error((e as Error).message || 'สร้าง PDF ไม่สำเร็จ'); } finally { setPdfBusy(false); }
  };
  const deleteRows = async (ids: string[]) => {
    if (await confirmDialog({ title: `ลบ ${ids.length} แถว?`, message: 'แถวจะถูกย้ายไปถังขยะของชีตและกู้คืนได้', danger: true, confirmText: 'ลบ' })) await view.deleteRows(ids);
  };

  if (file.error) return <NoAccessView info={file.error} onRetry={() => void file.reload()} />;
  if (!file.data) return <div className="space-y-4 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-10 w-full" /><Skeleton className="h-[60vh] w-full rounded-theme" /></div>;
  const f = file.data.file;
  const filterCol = filterFor ? view.allColumns.find((c) => c.id === filterFor.colId) ?? null : null;
  const hidden = view.prefs.hiddenCols.length;
  // sheet setting: only some columns get a filter / sort button (always keep the ones in use)
  const barSel = view.detail?.settings?.filterColumns;
  const barColumns = barSel ? view.columns.filter((c) => barSel.includes(c.id) || view.query.filters.some((f) => f.columnId === c.id) || view.query.sorts.some((s) => s.columnId === c.id)) : view.columns;

  return (
    <div className="flex h-[calc(100dvh-4rem)] flex-col px-3 pb-3 sm:px-6">
      <div className="flex shrink-0 flex-wrap items-center gap-3 pb-2 pt-1">
        <FileGlyph color={f.color} size={40} />
        <div className="min-w-0 flex-1">
          <nav className="flex flex-wrap items-center gap-1 text-xs text-muted">
            <Link to="/browse" className="hover:text-ink">ไฟล์ทั้งหมด</Link>
            {file.data.breadcrumb.map((c) => <span key={c.id} className="flex items-center gap-1"><ChevronRight className="h-3 w-3" /><Link to={`/folders/${c.id}`} className="hover:text-ink">{c.name}</Link></span>)}
          </nav>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{f.name}</h1>
            <StarButton active={f.favorite} onToggle={async () => { await useData.getState().toggleFavorite('file', f.id); void file.reload(true); }} />
            <PermBadge perm={levelToPerm(level)} />
          </div>
        </div>
        {view.presence.length > 1 && <div className="flex items-center gap-2 text-xs text-muted"><AvatarStack users={view.presence} /><span className="hidden sm:inline">กำลังดูอยู่</span></div>}
        {canManage && <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={() => setModal('share')}>แชร์</Button>}
        <IconButton ref={moreBtn} label="ตัวเลือกไฟล์" onClick={() => setMore(true)}><MoreHorizontal className="h-5 w-5" /></IconButton>
        <Popover open={more} onClose={() => setMore(false)} anchor={moreBtn.current} placement="bottom-end" width={240}>
          <MenuList onClose={() => setMore(false)} items={[
            ...(canManage ? [{ label: 'เปลี่ยนชื่อ / สี', icon: <Pencil />, onClick: () => setModal('rename') }, { label: 'ออกแบบรูปแบบ PDF', icon: <Download />, onClick: () => nav(`/files/${f.id}/pdf`) }] : []),
            ...(!isBasicRole(role) ? [{ label: 'ทำสำเนาไฟล์', icon: <Copy />, onClick: () => setModal('dup') }] : []),
            ...(canManage ? [{ label: 'ประวัติการแก้ไขของไฟล์', icon: <History />, onClick: () => nav(`/audit?fileId=${f.id}`) }] : []),
            { label: 'ส่งออก Excel (.xlsx)', icon: <Download />, onClick: () => void exportRows('xlsx') },
            { label: 'ส่งออก CSV', icon: <Download />, onClick: () => void exportCsv() },
            ...(canManage ? [{ divider: true }, { label: 'ลบไฟล์', icon: <Trash2 />, danger: true, onClick: async () => {
              if (!(await confirmDialog({ title: `ลบไฟล์ “${f.name}”?`, message: 'ไฟล์จะถูกย้ายไปถังขยะ', danger: true, confirmText: 'ลบไฟล์' }))) return;
              try { await filesApi.remove(f.id); toast.success('ย้ายไปถังขยะแล้ว'); nav(`/folders/${f.folderId}`); } catch (e) { toast.error(e); }
            } }] : []),
          ]} />
        </Popover>
      </div>

      <SheetTabs fileId={f.id} sheets={sheets} activeId={sheetId} dashboards={file.data.dashboards} canManage={canManage}
        onSelect={(sid) => setSp({ sheet: sid }, { replace: true })}
        onChanged={async (sid) => { await file.reload(true); if (sid) setSp({ sheet: sid }, { replace: true }); void view.loadDetail(); }} />

      <div ref={workspace} className={cn('ds-card flex min-h-0 flex-1 flex-col overflow-hidden !rounded-tl-none', full && '!rounded-none bg-app p-2')}>
        {!sheetId ? <EmptyState title="ไฟล์นี้ยังไม่มีชีต" /> : (
          <>
            {union && sheetId && <UnionBanner sheetId={sheetId} union={union} canManage={canManage} onSynced={() => { void view.loadDetail(); void view.loadRows(true); void file.reload(true); }} />}
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
              <TextInput icon={<Search />} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาในชีต…" className="!h-9 w-full sm:w-64" />
              {canWrite && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setRowForm({ row: null })}>เพิ่มแถว</Button>}
              {canWrite && selRows.length > 0 && <Button size="sm" variant="secondary" className="!text-danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void deleteRows(selRows)}>{selRows.length > 1 ? `ลบ ${selRows.length} แถวที่เลือก` : 'ลบแถวที่เลือก'}</Button>}
              {canWrite && <Button size="sm" variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setModal('import')}>นำเข้า</Button>}
              {canWrite && !!view.detail?.settings?.scanProfiles?.length && <Button size="sm" variant="secondary" icon={<ScanLine className="h-4 w-4" />} onClick={() => setModal('scan')}>สแกน</Button>}
              {canWrite && !!view.detail?.settings?.mix && <Button size="sm" variant="secondary" icon={<Merge className="h-4 w-4" />} onClick={() => setModal('mix')}>ผสม</Button>}
              {!!view.detail?.settings?.lines && selRows.length === 1 && <Button size="sm" variant="secondary" icon={<Boxes className="h-4 w-4" />} onClick={() => setModal('lines')}>รายการในแถว</Button>}
              {canManage && !union && <Button size="sm" variant="secondary" icon={<Columns3 className="h-4 w-4" />} onClick={() => setModal('columns')}>คอลัมน์</Button>}
              {canManage && !union && <Button size="sm" variant="secondary" icon={<Cpu className="h-4 w-4" />} onClick={() => setModal('devices')}>อุปกรณ์</Button>}
              {canManage && !union && <Button size="sm" variant="secondary" icon={<ScanLine className="h-4 w-4" />} onClick={() => setModal('scanmix')}>ตั้งค่าสแกน/ผสม</Button>}
              <div className="mx-1 hidden h-6 w-px bg-line sm:block" />
              <IconButton label="ย้อนกลับ (Ctrl+Z)" onClick={() => void view.undo()} disabled={!view.canUndo}><Undo2 className="h-4 w-4" /></IconButton>
              <IconButton label="ทำซ้ำ (Ctrl+Y)" onClick={() => void view.redo()} disabled={!view.canRedo}><Redo2 className="h-4 w-4" /></IconButton>
              <IconButton ref={freezeBtn} label="ตรึงแถว/คอลัมน์" active={!!(view.prefs.frozenCols || view.prefs.frozenRows)} onClick={() => setFreeze(true)}><Pin className="h-4 w-4" /></IconButton>
              <Popover open={freeze} onClose={() => setFreeze(false)} anchor={freezeBtn.current} width={230}>
                <MenuList onClose={() => setFreeze(false)} items={[
                  { label: 'ตรึงคอลัมน์แรก', icon: <Pin />, active: view.prefs.frozenCols === 1, onClick: () => view.setPrefs({ frozenCols: 1 }) },
                  { label: 'ตรึง 2 คอลัมน์แรก', icon: <Pin />, active: view.prefs.frozenCols === 2, onClick: () => view.setPrefs({ frozenCols: 2 }) },
                  { label: 'ตรึงแถวแรก', icon: <Pin />, active: view.prefs.frozenRows === 1, onClick: () => view.setPrefs({ frozenRows: 1 }) },
                  { divider: true },
                  { label: 'เลิกตรึงทั้งหมด', icon: <PinOff />, onClick: () => view.setPrefs({ frozenCols: 0, frozenRows: 0 }) },
                  ...(hidden ? [{ label: `แสดงคอลัมน์ที่ซ่อน (${hidden})`, icon: <Columns3 />, onClick: () => view.setPrefs({ hiddenCols: [] }) }] : []),
                  { label: 'รีเซ็ตความกว้าง/สูง', icon: <RotateCcw />, onClick: () => view.setPrefs({ colWidths: {}, rowHeights: {} }) },
                ]} />
              </Popover>
              <div className="ml-auto flex items-center gap-1">
                {canWrite && <IconButton label="แถวที่ถูกลบ" onClick={() => setModal('trash')}><Trash2 className="h-4 w-4" /></IconButton>}
                {role === 'admin' && <IconButton label="ย้อนข้อมูลทั้งชีต" onClick={() => setModal('rollback')}><RotateCcw className="h-4 w-4" /></IconButton>}
                <IconButton ref={exportBtn} label="ส่งออกไฟล์" onClick={() => setExportMenu(true)}><Download className="h-4 w-4" /></IconButton>
                <Popover open={exportMenu} onClose={() => setExportMenu(false)} anchor={exportBtn.current} placement="bottom-end" width={280}>
                  <MenuList onClose={() => setExportMenu(false)} items={[
                    { label: 'Excel (.xlsx)', icon: <Download />, onClick: () => void exportRows('xlsx') },
                    { label: 'CSV (.csv)', icon: <Download />, onClick: () => void exportRows('csv') },
                    { divider: true },
                    ...(pdfTpls === null ? [{ label: 'กำลังโหลดรูปแบบ PDF…', disabled: true }] : [
                      { label: 'PDF — รายงานมาตรฐาน', icon: <Download />, disabled: pdfBusy, onClick: () => startPdf(null) },
                      ...pdfTpls.map((t) => ({ label: `PDF — ${t.name}${t.mode === 'perRow' ? ' (ฟอร์มต่อแถว)' : ''}`, icon: <Download />, disabled: pdfBusy, onClick: () => startPdf(t) })),
                    ]),
                    { divider: true },
                    { label: 'เอกสารที่ออกแล้ว…', icon: <Download />, onClick: () => setArchiveOpen(true) },
                    { label: 'ลายเซ็นของฉัน…', icon: <Pencil />, onClick: () => setSigOpen(true) },
                    ...(canManage ? [{ label: 'สายอนุมัติเอกสาร…', icon: <Pencil />, onClick: () => setFlowsOpen(true) }] : []),
                    ...(canManage ? [{ label: 'ออกแบบรูปแบบ PDF…', icon: <Pencil />, onClick: () => nav(`/files/${id}/pdf`) }] : []),
                  ]} />
                </Popover>
                <div className="mx-1 h-6 w-px bg-line" />
                <IconButton label="ซูมออก (Ctrl -)" onClick={() => zoom(-0.1)}><ZoomOut className="h-4 w-4" /></IconButton>
                <button onClick={() => view.setPrefs({ zoom: 1 })} className="w-12 rounded-md py-1 text-center text-xs font-medium tabular-nums hover:bg-ink/5" title="รีเซ็ตซูม (Ctrl 0)">{Math.round(view.prefs.zoom * 100)}%</button>
                <IconButton label="ซูมเข้า (Ctrl +)" onClick={() => zoom(0.1)}><ZoomIn className="h-4 w-4" /></IconButton>
                <IconButton label={full ? 'ออกจากเต็มจอ' : 'เต็มจอ'} onClick={() => void toggleFull()}>{full ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</IconButton>
              </div>
            </div>
            <FilterBar columns={barColumns} allColumns={view.columns} filters={view.query.filters} sorts={view.query.sorts} onConfigure={canManage ? () => setModal('filterbar') : undefined}
              onOpen={(colId, el) => setFilterFor({ colId, el })} onClearFilters={() => view.setQuery({ filters: [] })}
              onRemoveSort={(cid) => view.setQuery({ sorts: view.query.sorts.filter((s) => s.columnId !== cid) })} />
            <div className="relative min-h-0 flex-1">
              {(!view.detail || (view.loadingRows && !view.rows.length)) ? (
                <div className="space-y-1.5 p-3">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
              ) : (
                <SpreadsheetGrid view={view} canWrite={canWrite} canManage={canManage && !union} onOpenRow={(row) => setRowForm({ row })} onCellHistory={(row, col) => setCellHist({ row, col })}
                  onRowHistory={setRowHist} onFilterColumn={(colId, el) => setFilterFor({ colId, el })} onColumnSettings={() => setModal('columns')} onDeleteRows={deleteRows} onSelectRows={setSelRows} onViewRow={setRowView} />
              )}
              {view.loadingRows && view.rows.length > 0 && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-primary" />}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-3 py-2">
              <Pager page={view.query.page} pageSize={view.prefs.pageSize} total={view.total} onPage={(p) => view.setQuery({ page: p })} />
              <Select value={view.prefs.pageSize} onChange={(e) => { view.setPrefs({ pageSize: Number(e.target.value) }); view.setQuery({ page: 1 }); }} className="ml-auto w-32 [&>select]:!h-8 [&>select]:text-xs">
                {[50, 100, 200, 500, 1000].map((n) => <option key={n} value={n}>{n} แถว/หน้า</option>)}
              </Select>
            </div>
          </>
        )}
      </div>

      {view.detail && sheetId && (
        <>
          <ColumnFilterMenu open={!!filterFor} onClose={() => setFilterFor(null)} anchor={filterFor?.el ?? null} sheetId={sheetId} column={filterCol}
            filters={view.query.filters} sorts={view.query.sorts} search={view.query.search}
            onApply={(flt) => filterCol && view.setQuery({ filters: [...view.query.filters.filter((x) => x.columnId !== filterCol.id), ...(flt ? [flt] : [])] })}
            onSort={(sorts) => view.setQuery({ sorts })} />
          <RowFormModal open={!!rowForm} onClose={() => setRowForm(null)} columns={view.allColumns} row={rowForm?.row ?? null} users={view.users} canWrite={canWrite}
            sheetId={sheetId} settings={view.detail.settings} canManage={canManage && !union} onLayoutSaved={() => void view.loadDetail()}
            onCreate={(values) => view.addRow(values)}
            onSave={(changes) => view.commit(changes.map((c) => ({ ...c, rowId: rowForm!.row!.id })), { partial: true })} />
          <RowViewModal row={rowView} rows={view.rows} columns={view.columns} users={view.users} onClose={() => setRowView(null)} onNavigate={setRowView}
            onEdit={canWrite ? (r) => { setRowView(null); setRowForm({ row: r }); } : undefined} />
          <CellHistoryModal target={cellHist} onClose={() => setCellHist(null)} onChanged={() => void view.loadRows(true)} />
          <RowHistoryModal row={rowHist} columns={view.allColumns} canRollback={canManage} onClose={() => setRowHist(null)} onChanged={() => void view.loadRows(true)} />
          <ColumnManagerModal open={modal === 'columns'} onClose={() => setModal(null)} sheetId={sheetId} fileId={f.id} fileName={f.name} columns={view.detail.columns} deleted={view.detail.deletedColumns}
            onSaved={() => { void view.loadDetail(); void view.loadRows(true); }} />
          <ScanMixSettings open={modal === 'scanmix'} onClose={() => setModal(null)} sheetId={sheetId} columns={view.columns} settings={view.detail.settings} fileId={f.id} fileName={f.name} onSaved={() => void view.loadDetail()} />
          <ScanDialog open={modal === 'scan'} onClose={() => setModal(null)} sheetId={sheetId} profiles={view.detail.settings?.scanProfiles ?? []} onDone={() => void view.loadRows(true)} />
          {view.detail.settings?.mix && <MixDialog open={modal === 'mix'} onClose={() => setModal(null)} sheetId={sheetId} cfg={view.detail.settings.mix} columns={view.columns} selectedRows={view.rows.filter((r) => selRows.includes(r.id))} onDone={() => void view.loadRows(true)} />}
          {view.detail.settings?.lines && <LinesDialog open={modal === 'lines'} onClose={() => setModal(null)} sheetId={sheetId} headerRow={view.rows.find((r) => r.id === selRows[0]) ?? null} headerLabel="" cfg={view.detail.settings.lines} canWrite={canWrite} onDone={() => void view.loadRows(true)} />}
          <DeviceBindingsDialog open={modal === 'devices'} onClose={() => setModal(null)} sheetId={sheetId} profiles={view.detail.settings?.scanProfiles ?? []} columns={view.allColumns} />
          <FilterBarSettings open={modal === 'filterbar'} onClose={() => setModal(null)} sheetId={sheetId} columns={view.columns} selected={barSel} onSaved={() => void view.loadDetail()} />
          <ImportModal open={modal === 'import'} onClose={() => setModal(null)} sheetId={sheetId} sheetName={view.detail.sheet.name} fileName={f.name} columns={view.detail.columns}
            onDone={() => void view.loadRows(true)} />
          <SheetTrashModal open={modal === 'trash'} onClose={() => setModal(null)} sheetId={sheetId} columns={view.allColumns} onRestored={() => void view.loadRows(true)} />
          {exportDlg && (
            <ExportDialog open onClose={() => setExportDlg(null)} template={exportDlg} user={useAuth.getState().user?.displayName ?? ''} memoryKey={`${id}:${exportDlg.id}`} busy={pdfBusy}
              extra={<ArchiveOption value={archiveOpt} onChange={setArchiveOpt} />}
              onConfirm={async (values) => { const t = exportDlg; await exportPdf(t, values, archiveOpt); setExportDlg(null); }} />
          )}
          <FlowsDialog open={flowsOpen} onClose={() => setFlowsOpen(false)} fileId={id} />
          <SignatureDialog open={sigOpen} onClose={() => setSigOpen(false)} />
          <ArchiveDialog open={archiveOpen} onClose={() => setArchiveOpen(false)} fileId={id} />
          <RollbackModal open={modal === 'rollback'} onClose={() => setModal(null)} sheetId={sheetId} sheetName={view.detail.sheet.name} onDone={() => void view.loadRows(true)} />
        </>
      )}
      <ShareDialog open={modal === 'share'} onClose={() => setModal(null)} target={{ type: 'file', id: f.id, name: f.name }} />
      <MetaModal open={modal === 'rename'} onClose={() => setModal(null)} title="แก้ไขไฟล์" initial={{ name: f.name, color: f.color, description: f.description }}
        onSubmit={async (v) => { await filesApi.update(f.id, v); toast.success('บันทึกแล้ว'); void file.reload(true); }} />
      <DuplicateDialog open={modal === 'dup'} onClose={() => setModal(null)} file={{ id: f.id, name: f.name, folderId: f.folderId }} onDone={(nid) => nav(`/files/${nid}`)} />
    </div>
  );
}
