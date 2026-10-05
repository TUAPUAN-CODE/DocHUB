import { DragEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Rnd } from 'react-rnd';
import { motion } from 'framer-motion';
import { ArrowLeft, Eye, Expand, Grid3x3, Layers, Maximize, Pencil, RefreshCw, Save, Settings2, Shrink, SlidersHorizontal, Trash2, Upload, ZoomIn, ZoomOut } from 'lucide-react';
import { dashboardsApi, uploadsApi } from '@/api/endpoints';
import { DashCtx } from '@/components/dashboard/dashContext';
import { LayersPanel } from '@/components/dashboard/LayersPanel';
import { newWidget, WIDGET_GROUPS, WIDGETS, WidgetView } from '@/components/dashboard/widgets';
import { WidgetConfigPanel } from '@/components/dashboard/WidgetConfigPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Field, Segmented, TextInput, Toggle } from '@/components/ui/Inputs';
import { ColorInput, EmptyState, Skeleton } from '@/components/ui/misc';
import { Popover } from '@/components/ui/Popover';
import { AI_DASH_EVENT } from '@/modules/ai/useAiPanel';
import { isTyping, useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { confirmDialog, toast } from '@/store/ui';
import { ColumnFilter, DashboardMeta, LV, Widget, WidgetType } from '@/types';

const PRESETS = [
  { label: 'HD 1280×720', w: 1280, h: 720 }, { label: 'FHD 1600×900', w: 1600, h: 900 }, { label: 'Full HD 1920×1080', w: 1920, h: 1080 },
  { label: 'A4 แนวนอน', w: 1123, h: 794 }, { label: 'แนวตั้ง 1080×1920', w: 1080, h: 1920 },
];
const WMIME = 'application/x-dsp-widget';

export default function DashboardPage() {
  const { fileId = '', dashId = '' } = useParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { data, loading, error, reload } = useLoad(() => dashboardsApi.get(dashId), [dashId]);
  const [meta, setMeta] = useState<DashboardMeta | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settings, setSettings] = useState(false);
  const [slicers, setSlicers] = useState<Record<string, ColumnFilter | null>>({});
  const [full, setFull] = useState(false);
  const [panel, setPanel] = useState<'props' | 'layers'>('props');
  const page = useRef<HTMLDivElement>(null);
  const settingsBtn = useRef<HTMLButtonElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canManage = (data?.level ?? 0) >= LV.manage;

  useEffect(() => {
    if (!data) return;
    setMeta(data.dashboard);
    setWidgets(data.widgets);
    setEdit(sp.get('edit') === '1' && data.level >= LV.manage);
    setDirty(false);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // the AI assistant (right bar) added widgets: reload, unless there are unsaved edits that would be lost
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.dashboardId !== dashId) return;
      if (dirty) toast.info('AI เพิ่มกราฟแล้ว', 'คุณมีการแก้ไขที่ยังไม่บันทึก — บันทึกแล้วรีเฟรชหน้าเพื่อดูกราฟใหม่');
      else void reload(true);
    };
    window.addEventListener(AI_DASH_EVENT, on);
    return () => window.removeEventListener(AI_DASH_EVENT, on);
  }, [dashId, dirty, reload]);

  const fitZoom = useCallback(() => {
    if (!viewport.current || !meta) return;
    const pad = full ? 0 : 48;
    const w = viewport.current.clientWidth - pad;
    let z = w / meta.canvas.width;
    setZoom(Math.max(0.2, Math.min(full ? 4 : 1.5, Math.round(z * 1000) / 1000)));
  }, [meta, full]);
  useLayoutEffect(() => {
    if (!fit) return;
    fitZoom();
    const ro = new ResizeObserver(fitZoom);
    if (viewport.current) ro.observe(viewport.current);
    return () => ro.disconnect();
  }, [fit, fitZoom, edit, selected, full]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    const on = () => { const f = document.fullscreenElement === page.current; setFull(f); if (f) { setFit(true); setSelected(null); } };
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => { if (selected) setPanel('props'); }, [selected]);
  const toggleFull = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else { setEdit(false); await page.current?.requestFullscreen(); } }
    catch { toast.info('เบราว์เซอร์ไม่รองรับโหมดเต็มจอ'); }
  };

  const change = (fn: (ws: Widget[]) => Widget[]) => { setWidgets(fn); setDirty(true); };
  const update = (id: string, p: Partial<Widget>) => change((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const maxZ = () => widgets.reduce((m, w) => Math.max(m, w.z), 0);
  const snap = (v: number) => (meta?.canvas.snap ? Math.round(v / meta.canvas.gridSize) * meta.canvas.gridSize : Math.round(v));

  const add = (type: WidgetType, x?: number, y?: number) => {
    if (!meta) return;
    const el = viewport.current;
    const cx = x ?? ((el?.scrollLeft ?? 0) + (el?.clientWidth ?? 800) / 2) / zoom - 200;
    const cy = y ?? ((el?.scrollTop ?? 0) + (el?.clientHeight ?? 600) / 2) / zoom - 120;
    const w = newWidget(type, snap(Math.max(0, cx)), snap(Math.max(0, cy)), maxZ() + 1, data?.sheets[0]?.id ?? null);
    w.x = Math.min(w.x, Math.max(0, meta.canvas.width - w.w));
    w.y = Math.min(w.y, Math.max(0, meta.canvas.height - w.h));
    change((ws) => [...ws, w]);
    setSelected(w.id);
  };
  const duplicate = (id: string) => {
    const src = widgets.find((w) => w.id === id);
    if (!src) return;
    const copy = { ...newWidget(src.type, 0, 0, maxZ() + 1, null), ...JSON.parse(JSON.stringify(src)) };
    copy.id = newWidget(src.type, 0, 0, 0, null).id;
    copy.x = src.x + 24; copy.y = src.y + 24; copy.z = maxZ() + 1; copy.locked = false;
    change((ws) => [...ws, copy]);
    setSelected(copy.id);
  };
  const remove = (id: string) => { change((ws) => ws.filter((w) => w.id !== id)); setSelected(null); };
  const layer = (id: string, op: 'front' | 'back' | 'up' | 'down') => change((ws) => {
    const sorted = [...ws].sort((a, b) => a.z - b.z);
    const i = sorted.findIndex((w) => w.id === id);
    const [it] = sorted.splice(i, 1);
    const j = op === 'front' ? sorted.length : op === 'back' ? 0 : op === 'up' ? Math.min(sorted.length, i + 1) : Math.max(0, i - 1);
    sorted.splice(j, 0, it);
    return sorted.map((w, k) => ({ ...w, z: k + 1 }));
  });

  const reorder = (idsTopFirst: string[]) => change((ws) => {
    const zOf = new Map(idsTopFirst.map((id, i) => [id, idsTopFirst.length - i]));
    return ws.map((w) => ({ ...w, z: zOf.get(w.id) ?? w.z }));
  });
  const setSlicer = useCallback((id: string, f: ColumnFilter | null) => setSlicers((s) => ({ ...s, [id]: f })), []);

  const save = async () => {
    if (!meta) return;
    setSaving(true);
    try { await dashboardsApi.save(dashId, { name: meta.name, canvas: meta.canvas, background: meta.background, widgets }); setDirty(false); toast.success('บันทึกแดชบอร์ดแล้ว'); }
    catch (e) { toast.error(e, 'บันทึกไม่สำเร็จ'); } finally { setSaving(false); }
  };

  useEffect(() => {
    if (!edit) return;
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
      if (isTyping(e) || !selected) return;
      const w = widgets.find((x) => x.id === selected);
      if (!w) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(w.id); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(w.id); }
      else if (e.key === 'Escape') setSelected(null);
      else if (e.key.startsWith('Arrow') && !w.locked) {
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        update(w.id, { x: w.x + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0), y: w.y + (e.key === 'ArrowDown' ? d : e.key === 'ArrowUp' ? -d : 0) });
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  const onDrop = (e: DragEvent) => {
    const type = e.dataTransfer.getData(WMIME) as WidgetType;
    if (!type) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    add(type, (e.clientX - rect.left) / zoom - 100, (e.clientY - rect.top) / zoom - 60);
  };

  if (error) return <div className="p-6"><div className="ds-card"><EmptyState title="เปิดแดชบอร์ดไม่ได้" description={error.message} action={<Button onClick={() => nav(`/files/${fileId}`)}>กลับไปที่ไฟล์</Button>} /></div></div>;
  if (loading || !meta || !data) return <div className="space-y-4 p-6"><Skeleton className="h-10 w-80" /><Skeleton className="h-[70vh] w-full rounded-theme" /></div>;
  const sel = widgets.find((w) => w.id === selected) ?? null;
  const bg = meta.background ?? {};
  const g = meta.canvas.gridSize;

  const pad = full ? 0 : 48;
  return (
    <DashCtx.Provider value={{ slicers, setSlicer, widgets }}>
    <div ref={page} className={cn('flex flex-col bg-app', full ? 'h-screen' : 'h-[calc(100dvh-4rem)]')}>
      {full && <button onClick={() => void toggleFull()} className="absolute right-3 top-3 z-[60] inline-flex items-center gap-1.5 rounded-full bg-ink/70 px-3 py-1.5 text-xs font-medium text-white opacity-0 backdrop-blur transition-opacity hover:opacity-100 focus:opacity-100"><Shrink className="h-3.5 w-3.5" />ออกจากเต็มจอ (Esc)</button>}
      <div className={cn('shrink-0 flex-wrap items-center gap-2 px-4 pb-3 sm:px-6', full ? 'hidden' : 'flex')}>
        <Link to={`/files/${fileId}`} className="grid h-9 w-9 place-items-center rounded-xl hover:bg-ink/5" aria-label="กลับไปที่ไฟล์"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted">{data.file.name}</p>
          {edit ? <input value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} className="w-full min-w-[200px] rounded-lg bg-transparent px-1 text-lg font-semibold outline-none hover:bg-ink/5 focus:bg-surface" />
            : <h1 className="truncate text-lg font-semibold">{meta.name}</h1>}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <IconButton label="รีเฟรชข้อมูล" onClick={() => setRefreshKey((k) => k + 1)}><RefreshCw className="h-4 w-4" /></IconButton>
          <IconButton label="ซูมออก" onClick={() => { setFit(false); setZoom((z) => Math.max(0.2, Math.round((z - 0.1) * 10) / 10)); }}><ZoomOut className="h-4 w-4" /></IconButton>
          <span className="w-12 text-center text-xs font-medium tabular-nums">{Math.round(zoom * 100)}%</span>
          <IconButton label="ซูมเข้า" onClick={() => { setFit(false); setZoom((z) => Math.min(2, Math.round((z + 0.1) * 10) / 10)); }}><ZoomIn className="h-4 w-4" /></IconButton>
          <IconButton label="พอดีหน้าจอ" active={fit} onClick={() => setFit(true)}><Maximize className="h-4 w-4" /></IconButton>
          <IconButton label="เต็มจอ (Full screen)" onClick={() => void toggleFull()}><Expand className="h-4 w-4" /></IconButton>
          {canManage && (
            <>
              <div className="mx-1 h-6 w-px bg-line" />
              <Segmented value={edit ? 'edit' : 'view'} onChange={(v) => { setEdit(v === 'edit'); setSelected(null); }} options={[{ value: 'view', label: 'ดู', icon: <Eye /> }, { value: 'edit', label: 'แก้ไข', icon: <Pencil /> }]} />
              {edit && (
                <>
                  <IconButton ref={settingsBtn} label="ตั้งค่าผืนผ้าใบ" onClick={() => setSettings(true)}><Settings2 className="h-4 w-4" /></IconButton>
                  <IconButton label="ลบแดชบอร์ด" onClick={async () => {
                    if (!(await confirmDialog({ title: `ลบแดชบอร์ด “${meta.name}”?`, danger: true, confirmText: 'ลบ' }))) return;
                    try { await dashboardsApi.remove(dashId); toast.success('ลบแดชบอร์ดแล้ว'); nav(`/files/${fileId}`); } catch (e) { toast.error(e); }
                  }}><Trash2 className="h-4 w-4" /></IconButton>
                  <Button icon={<Save className="h-4 w-4" />} onClick={save} loading={saving} disabled={!dirty}>{dirty ? 'บันทึก' : 'บันทึกแล้ว'}</Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className={cn('flex min-h-0 flex-1 gap-3', full ? 'p-0' : 'px-3 pb-3 sm:px-6')}>
        {edit && !full && (
          <motion.aside initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="ds-card hidden w-[92px] shrink-0 flex-col gap-1 overflow-y-auto p-2 md:flex">
            {WIDGET_GROUPS.map((g) => (
              <div key={g.label} className="mb-1">
                <p className="px-1 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted/70">{g.label}</p>
                {g.types.map((t) => {
                  const w = WIDGETS.find((x) => x.type === t)!;
                  return (
                    <button key={w.type} draggable onDragStart={(e) => e.dataTransfer.setData(WMIME, w.type)} onClick={() => add(w.type)}
                      className="flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] text-muted transition-colors hover:bg-primary/10 hover:text-primary" title={`${w.hint ? `${w.hint}\n` : ''}เพิ่ม${w.label} (คลิกหรือลากลงผืนผ้าใบ)`}>
                      <span className="[&>svg]:h-5 [&>svg]:w-5">{w.icon}</span><span className="text-center leading-tight">{w.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </motion.aside>
        )}

        <div ref={viewport} className={cn('relative min-w-0 flex-1 overflow-auto', full ? 'bg-black' : 'rounded-theme border border-line bg-ink/[.035]')} style={full ? { scrollbarGutter: 'stable' } : undefined} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className={cn(full ? 'mx-auto' : 'p-6')} style={{ width: meta.canvas.width * zoom + pad, height: meta.canvas.height * zoom + pad }}>
            <div style={{ width: meta.canvas.width * zoom, height: meta.canvas.height * zoom }} className="relative">
              <div onDragOver={(e) => { if (e.dataTransfer.types.includes(WMIME)) e.preventDefault(); }} onDrop={onDrop}
                onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}
                className={cn('absolute left-0 top-0 origin-top-left overflow-hidden', full ? '' : 'rounded-[6px] shadow-[0_8px_30px_-12px_rgb(16_24_40/.35)]')}
                style={{
                  width: meta.canvas.width, height: meta.canvas.height, transform: `scale(${zoom})`,
                  backgroundColor: bg.color ?? '#F4F6FB',
                  backgroundImage: [edit && meta.canvas.snap ? `radial-gradient(circle, rgb(var(--c-muted) / .28) 1px, transparent 1px)` : '', bg.imageUrl ? `url("${bg.imageUrl}")` : ''].filter(Boolean).join(', ') || undefined,
                  backgroundSize: [edit && meta.canvas.snap ? `${g * 2}px ${g * 2}px` : '', bg.imageUrl ? (bg.fit === 'repeat' ? 'auto' : bg.fit ?? 'cover') : ''].filter(Boolean).join(', ') || undefined,
                  backgroundRepeat: bg.fit === 'repeat' ? 'repeat' : edit && meta.canvas.snap ? 'repeat, no-repeat' : 'no-repeat',
                  backgroundPosition: 'center',
                }}>
                {[...widgets].sort((a, b) => a.z - b.z).map((w) =>
                  edit ? (
                    <Rnd key={w.id} size={{ width: w.w, height: w.h }} position={{ x: w.x, y: w.y }} scale={zoom} bounds="parent"
                      dragGrid={meta.canvas.snap ? [g, g] : undefined} resizeGrid={meta.canvas.snap ? [g, g] : undefined}
                      disableDragging={w.locked} enableResizing={!w.locked && selected === w.id} style={{ zIndex: w.z }}
                      onMouseDown={() => setSelected(w.id)} onDragStart={() => setSelected(w.id)}
                      onDragStop={(_, d) => { if (d.x !== w.x || d.y !== w.y) update(w.id, { x: d.x, y: d.y }); }}
                      onResizeStop={(_, __, ref, ___, pos) => update(w.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y })}
                      className={cn('group', selected === w.id ? 'outline outline-2 outline-offset-2 outline-primary' : 'hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-primary/40')}
                      resizeHandleComponent={selected === w.id && !w.locked ? {
                        topLeft: <span className="block h-2.5 w-2.5 rounded-sm border-2 border-primary bg-white" />, topRight: <span className="block h-2.5 w-2.5 rounded-sm border-2 border-primary bg-white" />,
                        bottomLeft: <span className="block h-2.5 w-2.5 rounded-sm border-2 border-primary bg-white" />, bottomRight: <span className="block h-2.5 w-2.5 rounded-sm border-2 border-primary bg-white" />,
                      } : undefined}>
                      <div className={cn('h-full w-full', w.locked ? 'cursor-default' : 'cursor-move')}><WidgetView w={w} refreshKey={refreshKey} editing /></div>
                    </Rnd>
                  ) : (
                    <motion.div key={w.id} className="absolute" style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z }}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.4, w.z * 0.03) }}>
                      <WidgetView w={w} refreshKey={refreshKey} />
                    </motion.div>
                  ),
                )}
                {!widgets.length && (
                  <div className="absolute inset-0 grid place-items-center text-center text-muted">
                    <div><p className="text-lg font-semibold text-ink/70">ผืนผ้าใบว่าง</p><p className="mt-1 text-sm">{edit ? 'คลิกหรือลากวิดเจ็ตจากแถบด้านซ้ายมาวาง' : canManage ? 'สลับเป็นโหมด “แก้ไข” เพื่อเพิ่มกราฟ' : 'ยังไม่มีวิดเจ็ต'}</p></div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {edit && !full && (
          <motion.aside key="cfg" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="ds-card hidden w-[320px] shrink-0 flex-col overflow-hidden lg:flex">
            <div className="flex border-b border-line p-2">
              <Segmented size="sm" value={sel ? panel : 'layers'} onChange={setPanel}
                options={[{ value: 'props', label: 'คุณสมบัติ', icon: <SlidersHorizontal /> }, { value: 'layers', label: 'เลเยอร์', icon: <Layers /> }]} />
            </div>
            <div className="min-h-0 flex-1">
              {sel && panel === 'props' ? (
                <WidgetConfigPanel key={sel.id} w={sel} fileId={fileId} fileName={data.file.name} sheets={data.sheets} onChange={(p) => update(sel.id, p)} onRemove={() => remove(sel.id)}
                  onDuplicate={() => duplicate(sel.id)} onLayer={(op) => layer(sel.id, op)} />
              ) : (
                <LayersPanel widgets={widgets} selected={selected} onSelect={(id) => { setSelected(id); setPanel('props'); }} onReorder={reorder} onUpdate={update} />
              )}
            </div>
          </motion.aside>
        )}
      </div>

      <Popover open={settings} onClose={() => setSettings(false)} anchor={settingsBtn.current} placement="bottom-end" width={320}>
        <div className="space-y-4 p-4">
          <Field label="ขนาดผืนผ้าใบ">
            <div className="mb-2 flex flex-wrap gap-1.5">{PRESETS.map((p) => (
              <button key={p.label} onClick={() => { setMeta({ ...meta, canvas: { ...meta.canvas, width: p.w, height: p.h } }); setDirty(true); }}
                className={cn('rounded-lg border px-2 py-1 text-xs', meta.canvas.width === p.w && meta.canvas.height === p.h ? 'border-primary bg-primary/10 text-primary' : 'border-line hover:border-primary/40')}>{p.label}</button>
            ))}</div>
            <div className="grid grid-cols-2 gap-2">
              <TextInput inputMode="numeric" value={meta.canvas.width} onChange={(e) => { setMeta({ ...meta, canvas: { ...meta.canvas, width: Math.max(320, Number(e.target.value) || 320) } }); setDirty(true); }} className="!h-9" />
              <TextInput inputMode="numeric" value={meta.canvas.height} onChange={(e) => { setMeta({ ...meta, canvas: { ...meta.canvas, height: Math.max(240, Number(e.target.value) || 240) } }); setDirty(true); }} className="!h-9" />
            </div>
          </Field>
          <Field label="สีพื้นหลัง"><ColorInput value={bg.color} onChange={(c) => { setMeta({ ...meta, background: { ...bg, color: c ?? '#F4F6FB' } }); setDirty(true); }} swatches={['#FFFFFF', '#F4F6FB', '#0E1320', '#1552F0', '#F8FAF5', '#FFF7ED']} /></Field>
          <Field label="ภาพพื้นหลัง">
            <div className="flex items-center gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm hover:border-primary/40">
                <Upload className="h-4 w-4" />อัปโหลด
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try { const r = await uploadsApi.image(f); setMeta({ ...meta, background: { ...bg, imageUrl: r.url } }); setDirty(true); } catch (err) { toast.error(err); }
                }} />
              </label>
              {bg.imageUrl && <Button size="sm" variant="ghost" onClick={() => { setMeta({ ...meta, background: { ...bg, imageUrl: null } }); setDirty(true); }}>เอาออก</Button>}
            </div>
            {bg.imageUrl && <div className="mt-2"><Segmented size="sm" value={bg.fit ?? 'cover'} onChange={(v) => { setMeta({ ...meta, background: { ...bg, fit: v } }); setDirty(true); }} options={[{ value: 'cover', label: 'เต็ม' }, { value: 'contain', label: 'พอดี' }, { value: 'repeat', label: 'ซ้ำ' }]} /></div>}
          </Field>
          <div className="flex items-center justify-between">
            <Toggle checked={meta.canvas.snap} onChange={(v) => { setMeta({ ...meta, canvas: { ...meta.canvas, snap: v } }); setDirty(true); }} label={<span className="inline-flex items-center gap-1.5"><Grid3x3 className="h-4 w-4" />จัดชิดกริด</span>} />
            <TextInput inputMode="numeric" value={meta.canvas.gridSize} onChange={(e) => { setMeta({ ...meta, canvas: { ...meta.canvas, gridSize: Math.max(2, Math.min(100, Number(e.target.value) || 10)) } }); setDirty(true); }} className="!h-8 !w-16" />
          </div>
        </div>
      </Popover>
    </div>
    </DashCtx.Provider>
  );
}
