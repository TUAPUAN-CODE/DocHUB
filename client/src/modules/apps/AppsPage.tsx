import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppWindow, ExternalLink, EyeOff, FileSpreadsheet, Folder, Globe, ImagePlus, Info, LayoutDashboard, Plus, Search, Trash2, X } from 'lucide-react';
import { dashboardsApi, DashboardListItem, tagsApi, uploadsApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { FilePicker, PickedFile } from '@/components/files/FilePicker';
import { FolderPicker } from '@/components/files/Dialogs';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, Select, TextArea, TextInput, Toggle } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { ColorInput, EmptyState, PageHeader, PermBadge, RoleBadge, Skeleton } from '@/components/ui/misc';
import { TagChip, TagPicker } from '@/components/ui/TagChip';

import { cn } from '@/lib/cn';
import { ROLE_LABEL } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { confirmDialog, toast } from '@/store/ui';
import { LV, type TagRef } from '@/types';
import { AppDetails, AppEdit, AppItem, appsApi } from './api';

const KIND_ICON = { dashboard: LayoutDashboard, page: FileSpreadsheet, file: FileSpreadsheet, folder: Folder, url: Globe } as const;
const KIND_LABEL = { dashboard: 'แดชบอร์ด', page: 'หน้าในระบบ', file: 'ไฟล์', folder: 'โฟลเดอร์', url: 'ลิงก์เว็บ' } as const;
const ROLES = ['viewer', 'user', 'master', 'admin'] as const;

/** The square icon of an app: the uploaded picture, or the kind's symbol on the app's colour */
function AppIcon({ app, size = 64 }: { app: Pick<AppItem, 'iconUrl' | 'color' | 'kind' | 'name'>; size?: number }) {
  const Glyph = KIND_ICON[app.kind] ?? AppWindow;
  if (app.iconUrl) return <img src={app.iconUrl} alt="" className="shrink-0 rounded-[22%] object-cover shadow-sm" style={{ width: size, height: size }} />;
  return (
    <span className="grid shrink-0 place-items-center rounded-[22%] text-white shadow-sm" style={{ width: size, height: size, background: `linear-gradient(140deg, ${app.color}, ${app.color}cc)` }}>
      <Glyph style={{ width: size * 0.46, height: size * 0.46 }} strokeWidth={1.8} />
    </span>
  );
}

/**
 * "Application": every dashboard, the plan import (แผนผลิต) and the apps an admin added, as icons. Tap to open; ⓘ shows where the
 * app takes its data from and who can open it. Admins rename an app, upload its icon, hide it or limit it to roles / tags.
 */
export default function AppsPage() {
  const nav = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const title = useAuth((s) => s.user?.pageLabels?.apps) || 'Application';
  const admin = role === 'admin' || role === 'root';
  const [apps, setApps] = useState<AppItem[] | null>(null);
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  // type filter (e.g. QC): starts on the type an admin set as the default; '' = all
  const [type, setType] = useState<string | null>(null);
  const [defaultType, setDefaultTypeState] = useState('');
  useEffect(() => { appsApi.settings().then((s) => { setDefaultTypeState(s.defaultType); setType((t) => t ?? s.defaultType); }).catch(() => setType((t) => t ?? '')); }, []);
  // icon size: each viewer's own choice, kept in this browser
  const [size, setSizeState] = useState<number>(() => { try { return Number(localStorage.getItem('apps.iconSize')) || 64; } catch { return 64; } });
  const setSize = (v: string) => { const n = Number(v); setSizeState(n); try { localStorage.setItem('apps.iconSize', String(n)); } catch { /* private mode */ } };
  const [info, setInfo] = useState<AppItem | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () => appsApi.list().then(setApps).catch((e) => { toast.error(e, 'โหลดแอปไม่สำเร็จ'); setApps([]); });
  useEffect(() => { void load(); }, []);

  const types = useMemo(() => [...new Set((apps ?? []).filter((a) => showHidden || !a.hidden).map((a) => a.type).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'th')), [apps, showHidden]);
  const untyped = (apps ?? []).some((a) => (showHidden || !a.hidden) && !a.type);
  // a default type no app has (yet) shows everything
  const activeType = type && (types.includes(type) || type === '-') ? type : '';
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (apps ?? []).filter((a) => (s || !activeType || (activeType === '-' ? !a.type : a.type === activeType)) && (showHidden || !a.hidden) && (!s || a.name.toLowerCase().includes(s) || a.source.toLowerCase().includes(s) || a.defaultName.toLowerCase().includes(s)));
  }, [apps, q, showHidden, activeType]);
  const open = (a: AppItem) => { if (a.external) window.open(a.external, '_blank', 'noopener'); else if (a.to) nav(a.to, { state: { from: '/apps' } }); };
  const hiddenCount = (apps ?? []).filter((a) => a.hidden).length;

  return (
    <Page>
      <PageHeader icon={<AppWindow />} title={title} subtitle={apps ? `${apps.filter((a) => !a.hidden).length} แอปที่คุณเปิดได้` : 'กำลังโหลด…'}
        actions={admin ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>เพิ่ม App</Button> : undefined} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <TextInput icon={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาแอป…" className="!h-11 min-w-[220px] flex-1" />
        <Segmented size="sm" value={String(size)} onChange={setSize} options={[{ value: '48', label: 'เล็ก' }, { value: '64', label: 'กลาง' }, { value: '88', label: 'ใหญ่' }, { value: '120', label: 'ใหญ่มาก' }]} />
        {admin && hiddenCount > 0 && <Toggle checked={showHidden} onChange={setShowHidden} label={`แสดงแอปที่ซ่อน (${hiddenCount})`} />}
      </div>
      {(types.length > 0) && (
        <div className="-mt-3 mb-5 flex flex-wrap items-center gap-1.5">
          {[{ v: '', l: 'ทั้งหมด' }, ...types.map((t) => ({ v: t, l: t })), ...(untyped ? [{ v: '-', l: 'ไม่มีประเภท' }] : [])].map((o) => (
            <button key={o.v || 'all'} type="button" aria-pressed={activeType === o.v} onClick={() => setType(o.v)}
              className={cn('rounded-full border px-3 py-1 text-sm font-medium transition-colors', activeType === o.v ? 'border-primary bg-primary text-white' : 'border-line bg-surface text-ink/70 hover:bg-ink/5')}>
              {o.l}{o.v && o.v === defaultType ? ' ★' : ''}
            </button>
          ))}
          {admin && activeType !== defaultType && activeType !== '-' && (
            <button type="button" onClick={() => void appsApi.setDefaultType(activeType).then((r) => { setDefaultTypeState(r.defaultType); toast.success(r.defaultType ? `เปิดหน้า Application ที่ประเภท ${r.defaultType} ก่อน` : 'เปิดหน้า Application ที่ ทั้งหมด'); }).catch((e) => toast.error(e))}
              className="ml-1 text-xs font-medium text-primary hover:underline">★ ตั้ง “{activeType || 'ทั้งหมด'}” เป็นค่าเริ่มต้น</button>
          )}
        </div>
      )}
      {!apps ? <div className="grid grid-cols-3 gap-6 sm:grid-cols-5 lg:grid-cols-7">{Array.from({ length: 10 }, (_, i) => <Skeleton key={i} className="mx-auto h-24 w-20 rounded-2xl" />)}</div>
        : !list.length ? <div className="ds-card"><EmptyState icon={<AppWindow />} title={q ? 'ไม่พบแอปที่ค้นหา' : 'ยังไม่มีแอป'} description={admin && !q ? 'กด เพิ่ม App เพื่อสร้างไอคอนไปยังไฟล์ โฟลเดอร์ แดชบอร์ด หรือลิงก์เว็บ' : undefined} /></div>
        : (
          <div className="grid gap-x-3 gap-y-6" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 44}px, 1fr))` }}>
            {list.map((a) => (
              <div key={a.key} className={cn('group relative flex flex-col items-center', a.hidden && 'opacity-50')}>
                <button type="button" onClick={() => open(a)} className="flex w-full flex-col items-center gap-2 rounded-2xl p-2 transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" title={a.description ?? a.source}>
                  <AppIcon app={a} size={size} />
                  <span className="line-clamp-2 w-full break-words text-center font-medium leading-tight" style={{ fontSize: size >= 88 ? 15 : size <= 48 ? 12 : 13 }}>{a.name}</span>
                </button>
                <button type="button" onClick={() => setInfo(a)} aria-label={`รายละเอียด ${a.name}`} title="รายละเอียด"
                  className="absolute right-1 top-0 grid h-7 w-7 place-items-center rounded-full bg-surface text-muted shadow ring-1 ring-line hover:text-primary sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100">
                  <Info className="h-4 w-4" />
                </button>
                {a.hidden && <span className="absolute left-2 top-1 rounded-full bg-ink/70 p-1 text-white" title="ซ่อนอยู่"><EyeOff className="h-3 w-3" /></span>}
                {admin && (a.roles.length > 0 || a.tagIds.length > 0) && <span className="mt-0.5 text-[10px] text-muted">จำกัดผู้เห็น</span>}
              </div>
            ))}
          </div>
        )}
      <AppInfoDialog app={info} admin={admin} types={types} onClose={() => setInfo(null)} onChanged={() => { setInfo(null); void load(); }} onOpen={open} />
      {admin && <AddAppDialog types={types} open={adding} onClose={() => setAdding(false)} onDone={() => { setAdding(false); void load(); }} />}
    </Page>
  );
}

/** Settings an admin gives an app (also used when adding one) */
function AppSettings({ value, onChange, tags, defaultName, types = [] }: { value: AppEdit; onChange: (v: AppEdit) => void; tags: TagRef[]; defaultName: string; types?: string[] }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try { const r = await uploadsApi.image(f); onChange({ ...value, iconUrl: r.url }); } catch (e) { toast.error(e, 'อัปโหลดไอคอนไม่สำเร็จ'); } finally { setUploading(false); }
  };
  return (
    <div className="space-y-3">
      <Field label="ชื่อแอป" hint={`ว่าง = ${defaultName || 'ชื่อของสิ่งที่เปิด'}`}><TextInput value={value.name ?? ''} maxLength={100} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder={defaultName} /></Field>
      <Field group label="ไอคอน">
        <div className="flex flex-wrap items-center gap-3">
          {value.iconUrl ? <img src={value.iconUrl} alt="" className="h-14 w-14 rounded-[22%] object-cover ring-1 ring-line" /> : <span className="grid h-14 w-14 place-items-center rounded-[22%] text-white" style={{ background: value.color || '#1552F0' }}><AppWindow className="h-6 w-6" /></span>}
          <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm hover:border-primary', uploading && 'pointer-events-none opacity-60')}>
            <ImagePlus className="h-4 w-4" />{uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดรูปไอคอน'}
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {value.iconUrl && <Button size="sm" variant="secondary" icon={<X className="h-3.5 w-3.5" />} onClick={() => onChange({ ...value, iconUrl: null })}>ใช้ไอคอนเริ่มต้น</Button>}
        </div>
        <p className="mt-1 text-xs text-muted">รูปสี่เหลี่ยมจัตุรัส (เช่น 256×256) · ไม่มีรูป = ใช้สัญลักษณ์บนสีด้านล่าง</p>
      </Field>
      <Field group label="สี"><ColorInput value={value.color ?? null} onChange={(c) => onChange({ ...value, color: c })} allowEmpty /></Field>
      <Field label="คำอธิบาย"><TextArea rows={2} maxLength={500} value={value.description ?? ''} onChange={(e) => onChange({ ...value, description: e.target.value })} /></Field>
      <Field group label="ให้เห็นเฉพาะ role (ไม่เลือก = ทุก role ที่เปิดไฟล์ได้)">
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => {
            const on = value.roles.includes(r);
            return <button key={r} type="button" aria-pressed={on} onClick={() => onChange({ ...value, roles: on ? value.roles.filter((x) => x !== r) : [...value.roles, r] })}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:bg-ink/5')}>{ROLE_LABEL[r]}</button>;
          })}
        </div>
      </Field>
      <Field group label="ให้เห็นเฉพาะคนใน Tag (ไม่เลือก = ไม่จำกัด)"><TagPicker tags={tags} value={value.tagIds} onChange={(ids) => onChange({ ...value, tagIds: ids })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ประเภท (Type)" hint="ใช้กรอง/เรียงแอป เช่น QC · พิมพ์ใหม่ได้">
          <TextInput list="app-types" value={value.type ?? ''} maxLength={50} onChange={(e) => onChange({ ...value, type: e.target.value })} placeholder="เช่น QC" />
          <datalist id="app-types">{[...new Set(['QC', ...types])].map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="ลำดับ (น้อย = ก่อน)"><TextInput type="number" min={0} value={value.sortOrder ?? ''} onChange={(e) => onChange({ ...value, sortOrder: e.target.value === '' ? null : Number(e.target.value) })} placeholder="ตามชื่อ" /></Field>
        <div className="flex items-end pb-2"><Toggle checked={value.hidden} onChange={(h) => onChange({ ...value, hidden: h })} label="ซ่อนแอปนี้" /></div>
      </div>
      <p className="text-xs text-muted">Admin / Root เห็นทุกแอปเสมอ · การจำกัดนี้ไม่เปลี่ยนสิทธิ์ของไฟล์ (คนที่มีสิทธิ์ยังเปิดไฟล์จากเมนูไฟล์ได้)</p>
    </div>
  );
}

const editOf = (a: AppItem): AppEdit => ({ name: a.name === a.defaultName ? '' : a.name, iconUrl: a.iconUrl, color: a.color, description: a.description, roles: a.roles, tagIds: a.tagIds, hidden: a.hidden, sortOrder: a.sortOrder, type: a.type });

function useTags(on: boolean) {
  const [tags, setTags] = useState<TagRef[]>([]);
  useEffect(() => { if (on) void tagsApi.list().then((t) => setTags(t.filter((x) => !x.isSystem))).catch(() => setTags([])); }, [on]);
  return tags;
}

function AppInfoDialog({ app, admin, onClose, onChanged, onOpen, types }: { app: AppItem | null; admin: boolean; types: string[]; onClose: () => void; onChanged: () => void; onOpen: (a: AppItem) => void }) {
  const [d, setD] = useState<AppDetails | null>(null);
  const [tab, setTab] = useState<'info' | 'edit'>('info');
  const [edit, setEdit] = useState<AppEdit | null>(null);
  const [busy, setBusy] = useState(false);
  const tags = useTags(!!app && admin);
  useEffect(() => {
    setD(null); setTab('info');
    if (!app) return;
    setEdit(editOf(app));
    appsApi.details(app.key).then(setD).catch((e) => toast.error(e, 'โหลดรายละเอียดไม่สำเร็จ'));
  }, [app]);
  if (!app) return null;
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    try { await appsApi.update(app.key, { ...edit, name: edit.name?.trim() || null, description: edit.description?.trim() || null, type: edit.type?.trim() || null }); toast.success('บันทึกแอปแล้ว'); onChanged(); }
    catch (e) { toast.error(e, 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const remove = async () => {
    const custom = app.custom;
    if (!(await confirmDialog({ title: custom ? 'ลบแอปนี้?' : 'คืนค่าแอปนี้?', message: custom ? `ลบไอคอน "${app.name}" (ไฟล์/โฟลเดอร์ต้นทางไม่ถูกลบ)` : `ล้างชื่อ ไอคอน การซ่อน และการจำกัดของ "${app.name}" กลับเป็นค่าเริ่มต้น`, danger: custom }))) return;
    try { await appsApi.remove(app.key); toast.success(custom ? 'ลบแอปแล้ว' : 'คืนค่าแล้ว'); onChanged(); } catch (e) { toast.error(e); }
  };
  return (
    <Modal open onClose={onClose} size="lg" icon={<AppIcon app={app} size={28} />} title={app.name} description={`${KIND_LABEL[app.kind]}${app.description ? ` · ${app.description}` : ''}`}
      footer={<>
        {admin && tab === 'edit' && <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove()} className="mr-auto">{app.custom ? 'ลบแอป' : 'คืนค่าเริ่มต้น'}</Button>}
        <Button variant="secondary" onClick={onClose}>ปิด</Button>
        {tab === 'edit' ? <Button onClick={() => void save()} loading={busy}>บันทึก</Button> : <Button icon={app.external ? <ExternalLink className="h-4 w-4" /> : undefined} onClick={() => { onClose(); onOpen(app); }}>เปิดแอป</Button>}
      </>}>
      {admin && <div className="mb-4"><Segmented value={tab} onChange={setTab} options={[{ value: 'info', label: 'รายละเอียด' }, { value: 'edit', label: 'ตั้งค่าแอป' }]} /></div>}
      {tab === 'edit' && edit ? <AppSettings value={edit} onChange={setEdit} tags={tags} defaultName={app.defaultName} types={types} /> : !d ? <Skeleton className="h-40 rounded-xl" /> : (
        <div className="space-y-4 text-sm">
          <section>
            <p className="mb-1 text-xs font-semibold text-muted">ดึงข้อมูลจาก</p>
            <p className="break-words font-medium">{d.source.path || '—'}</p>
            {d.source.fileId && <a href={`/files/${d.source.fileId}`} className="text-xs text-primary hover:underline">เปิดไฟล์ต้นทาง</a>}
            {!d.source.fileId && d.source.folderId && <a href={`/folders/${d.source.folderId}`} className="text-xs text-primary hover:underline">เปิดโฟลเดอร์ต้นทาง</a>}
          </section>
          <section>
            <p className="mb-1 text-xs font-semibold text-muted">ใครเข้าถึงได้</p>
            <p className="mb-2 text-xs text-muted">{d.access.note}</p>
            {(d.access.limitRoles.length > 0 || d.access.limitTags.length > 0) && (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs dark:bg-amber-500/10">
                แอปนี้แสดงเฉพาะ{d.access.limitRoles.length ? ` role: ${d.access.limitRoles.map((r) => ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r).join(', ')}` : ''}
                {d.access.limitTags.length ? <> {d.access.limitRoles.length ? 'และ' : ''} คนใน Tag: {d.access.limitTags.map((t) => <TagChip key={t.name} tag={t} className="ml-1" />)}</> : null}
              </div>
            )}
            {!d.access.users.length && !d.access.tags.length ? <p className="text-xs text-muted">{app.kind === 'page' || app.kind === 'url' ? '' : 'ยังไม่ได้แชร์ให้ใคร — มีแค่เจ้าของและ Admin'}</p> : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {d.access.tags.map((t, i) => <li key={`t${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2"><TagChip tag={t} /><PermBadge perm={t.permission} /><span className="ml-auto text-xs text-muted">{t.via}</span></li>)}
                {d.access.users.map((u, i) => <li key={`u${i}`} className="flex flex-wrap items-center gap-2 px-3 py-2"><span className="font-medium">{u.name}</span><RoleBadge role={u.role} /><PermBadge perm={u.permission} /><span className="ml-auto text-xs text-muted">{u.via}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function AddAppDialog({ open, onClose, onDone, types }: { types: string[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<'file' | 'folder' | 'dashboard' | 'url'>('file');
  const [file, setFile] = useState<PickedFile | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [dash, setDash] = useState('');
  const [dashes, setDashes] = useState<DashboardListItem[]>([]);
  const [url, setUrl] = useState('');
  const [edit, setEdit] = useState<AppEdit>({ name: '', iconUrl: null, color: null, description: '', roles: [], tagIds: [], hidden: false, sortOrder: null });
  const [busy, setBusy] = useState(false);
  const tags = useTags(open);
  useEffect(() => { if (open) { setFile(null); setFolder(null); setDash(''); setUrl(''); setEdit({ name: '', iconUrl: null, color: null, description: '', roles: [], tagIds: [], hidden: false, sortOrder: null }); void dashboardsApi.all().then(setDashes).catch(() => setDashes([])); } }, [open]);
  const refId = kind === 'file' ? file?.id : kind === 'folder' ? folder : kind === 'dashboard' ? dash : null;
  const ready = kind === 'url' ? /^(https?:\/\/|\/)/i.test(url.trim()) : !!refId;
  const submit = async () => {
    setBusy(true);
    try {
      await appsApi.add({ ...edit, name: edit.name?.trim() || null, description: edit.description?.trim() || null, kind, refId: refId ?? null, url: kind === 'url' ? url.trim() : null });
      toast.success('เพิ่มแอปแล้ว'); onDone();
    } catch (e) { toast.error(e, 'เพิ่มแอปไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<Plus className="h-5 w-5" />} title="เพิ่ม App" description="ไอคอนลัดไปยังไฟล์ โฟลเดอร์ แดชบอร์ด หรือลิงก์เว็บ — ผู้ใช้เห็นเมื่อมีสิทธิ์เปิดสิ่งนั้น"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void submit()} loading={busy} disabled={!ready}>เพิ่ม</Button></>}>
      <div className="space-y-4">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'file', label: 'ไฟล์' }, { value: 'folder', label: 'โฟลเดอร์' }, { value: 'dashboard', label: 'แดชบอร์ด' }, { value: 'url', label: 'ลิงก์เว็บ' }]} />
        {kind === 'file' && <Field group label="ไฟล์"><FilePicker value={file} onChange={setFile} /></Field>}
        {kind === 'folder' && <Field group label="โฟลเดอร์"><FolderPicker value={folder} onChange={setFolder} minLevel={LV.read} /></Field>}
        {kind === 'dashboard' && (
          <Field label="แดชบอร์ด" hint="แดชบอร์ดทุกอันเป็นแอปอยู่แล้ว — เลือกที่นี่เพื่อตั้งชื่อ/ไอคอนให้">
            <Select value={dash} onChange={(e) => setDash(e.target.value)}>
              <option value="">— เลือก —</option>
              {dashes.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.fileName}</option>)}
            </Select>
          </Field>
        )}
        {kind === 'url' && <Field label="ลิงก์" hint="https://… หรือหน้าในระบบ เช่น /traceback?mode=ink"><TextInput value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></Field>}
        <AppSettings types={types} value={edit} onChange={setEdit} tags={tags} defaultName={kind === 'file' ? file?.name ?? '' : kind === 'dashboard' ? dashes.find((x) => x.id === dash)?.name ?? '' : ''} />
      </div>
    </Modal>
  );
}
