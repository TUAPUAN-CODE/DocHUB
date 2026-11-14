import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowDownAZ, CalendarDays, ChevronRight, FilePlus2, FolderOpen, FolderPlus, KeyRound, Layers, LayoutGrid, List, Lock, Plus, Search, Share2 } from 'lucide-react';
import { foldersApi } from '@/api/endpoints';
import { MetaModal, NoAccessView, RequestAccessDialog, RequestAccessForm, ShareDialog } from '@/components/files/Dialogs';
import { UnionDialog } from '@/components/files/UnionDialog';
import { FolderGlyph } from '@/components/files/icons';
import { Item, ItemCard, ItemRow } from '@/components/files/ItemViews';
import { useItemActions } from '@/components/files/useItemActions';
import { dropInto, DRAG_MIME } from '@/components/layout/FolderTree';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Segmented, Select, TextInput } from '@/components/ui/Inputs';
import { EmptyState, PermBadge, Skeleton, StarButton } from '@/components/ui/misc';
import { MenuList, Popover } from '@/components/ui/Popover';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { levelToPerm } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { DateTreeDialog } from '@/components/files/DateTreeDialog';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import { LV, isBasicRole } from '@/types';
import { useT } from '@/i18n';
import { PlanDropZone } from '@/modules/inkcode/PlanDropZone';

export default function FolderPage() {
  const t = useT();
  const { id = 'root' } = useParams();
  const nav = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const { data, loading, error, reload } = useLoad(() => foldersApi.contents(id), [id]);
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('dsp_view') as 'grid' | 'list') || 'grid');
  const [sort, setSort] = useState<'name' | 'updated'>('name');
  const [filter, setFilter] = useState('');
  /** ประเภทเอกสาร: '' = ทุกประเภท · general = ทั่วไป */
  const [docType, setDocType] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [union, setUnion] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [dateTree, setDateTree] = useState(false);
  const [share, setShare] = useState(false);
  const [askAccess, setAskAccess] = useState(false);
  const [dropCrumb, setDropCrumb] = useState<string | null>(null);
  const newBtn = useRef<HTMLButtonElement>(null);
  const actions = useItemActions(() => void reload(true));

  useEffect(() => {
    const on = () => void reload(true);
    window.addEventListener('dsp:moved', on);
    return () => window.removeEventListener('dsp:moved', on);
  }, [reload]);
  useEffect(() => localStorage.setItem('dsp_view', view), [view]);

  const items: Item[] = useMemo(() => {
    if (!data) return [];
    const s = filter.trim().toLowerCase();
    const folders = data.subfolders.filter((f) => !s || f.name.toLowerCase().includes(s));
    const files = data.files.filter((f) => (!s || f.name.toLowerCase().includes(s)) && (!docType || (f.docType ?? 'general') === docType));
    const cmp = (a: { name: string; updatedAt: string; lastActivityAt?: string | null }, b: typeof a) =>
      sort === 'name' ? a.name.localeCompare(b.name, 'th') : +new Date(b.lastActivityAt ?? b.updatedAt) - +new Date(a.lastActivityAt ?? a.updatedAt);
    return [...folders.sort(cmp).map((d) => ({ kind: 'folder' as const, data: d })), ...files.sort(cmp).map((d) => ({ kind: 'file' as const, data: d }))];
  }, [data, filter, sort, docType]);

  if (error?.code === 'NO_ACCESS') return <NoAccessView info={error} onRetry={() => void reload()} />;
  if (error)
    return <Page><div className="ds-card"><EmptyState icon={<Lock />} title={t('เปิดโฟลเดอร์ไม่ได้')} description={error.message} action={<Button onClick={() => nav('/browse')}>{t('กลับไปที่ไฟล์ทั้งหมด')}</Button>} /></div></Page>;

  const folder = data?.folder;
  const level = data?.level ?? 0;
  const canCreate = !isBasicRole(role) && (id === 'root' ? true : level >= LV.write);
  const crumbs = [{ id: 'root', name: t('ไฟล์ทั้งหมด') }, ...(data?.breadcrumb ?? [])];
  // plan folders: "แผนผลิต / ปี / เดือน" anywhere under "InkCode" accept the production plan (.xlsx) by drop
  const names = (data?.breadcrumb ?? []).map((c) => c.name);
  const planAt = names.indexOf('แผนผลิต');
  const isPlanMonth = !isBasicRole(role) && !!folder && level >= LV.write && planAt >= 1 && names[0]?.trim() === 'InkCode' && names.length >= planAt + 3;

  return (
    <Page>
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
        {crumbs.map((c, i) => (
          <span key={c.id} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
            <Link to={c.id === 'root' ? '/browse' : `/folders/${c.id}`}
              onDragOver={(e) => { if (c.id !== 'root' && e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setDropCrumb(c.id); } }}
              onDragLeave={() => setDropCrumb(null)}
              onDrop={async (e) => { e.preventDefault(); setDropCrumb(null); if (await dropInto(e, c.id)) void reload(true); }}
              className={cn('rounded-md px-1.5 py-0.5 hover:bg-ink/5 hover:text-ink', i === crumbs.length - 1 && 'font-medium text-ink', dropCrumb === c.id && 'bg-primary/10 text-primary')}>
              {c.name}
            </Link>
          </span>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {folder ? <FolderGlyph color={folder.color} size={44} /> : <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><FolderOpen className="h-5 w-5" /></span>}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[22px] font-semibold tracking-tight">{folder?.name ?? t('ไฟล์ทั้งหมด')}</h1>
              {folder && <StarButton active={folder.favorite} onToggle={async () => { await useData.getState().toggleFavorite('folder', folder.id); void reload(true); }} />}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
              {folder ? <><PermBadge perm={levelToPerm(level)} />{folder.description && <span className="truncate">{folder.description}</span>}</> : t('โฟลเดอร์ระดับบนสุดขององค์กร')}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {folder && level >= LV.manage && <Button variant="secondary" icon={<Share2 className="h-4 w-4" />} onClick={() => setShare(true)}>{t('แชร์')}</Button>}
          {folder && level === 0 && items.length > 0 && <Button variant="secondary" icon={<KeyRound className="h-4 w-4" />} onClick={() => setAskAccess(true)}>ขอสิทธิ์โฟลเดอร์นี้</Button>}
          {canCreate && (
            <>
              <Button ref={newBtn} icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>{t('สร้างใหม่')}</Button>
              <Popover open={newOpen} onClose={() => setNewOpen(false)} anchor={newBtn.current} placement="bottom-end" width={220}>
                <MenuList onClose={() => setNewOpen(false)} items={[
                  { label: t('โฟลเดอร์'), icon: <FolderPlus />, onClick: () => setNewFolder(true) },
                  ...(folder ? [{ label: t('โฟลเดอร์ ปี / เดือน / วัน'), icon: <CalendarDays />, onClick: () => setDateTree(true) }] : []),
                  ...(folder ? [{ label: t('ไฟล์ (ตัวสร้างฟอร์ม)'), icon: <FilePlus2 />, onClick: () => nav(`/files/new?folder=${folder.id}`) }, { label: t('ไฟล์รวมข้อมูลจากไฟล์อื่น'), icon: <Layers />, onClick: () => setUnion(true) }] : []),
                ]} />
              </Popover>
            </>
          )}
        </div>
      </div>

      {isPlanMonth && folder && <PlanDropZone folderId={folder.id} onDone={() => void reload(true)} />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TextInput icon={<Search />} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('กรองในโฟลเดอร์นี้')} className="w-full sm:w-72" />
        <div className="flex items-center gap-2 text-sm text-muted"><ArrowDownAZ className="h-4 w-4" />
          <Select value={docType} onChange={(e) => setDocType(e.target.value)} className="w-44" aria-label="ประเภทเอกสาร">
            <option value="">ทุกประเภทเอกสาร</option><option value="master_data">Master Data</option><option value="record">แบบฟอร์มบันทึก</option><option value="general">ทั่วไป</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'updated')} className="w-40">
            <option value="name">{t('ชื่อ ก-ฮ')}</option><option value="updated">{t('แก้ไขล่าสุด')}</option>
          </Select>
        </div>
        <div className="ml-auto"><Segmented value={view} onChange={setView} options={[{ value: 'grid', label: t('การ์ด'), icon: <LayoutGrid /> }, { value: 'list', label: t('รายการ'), icon: <List /> }]} /></div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-48 rounded-theme" />)}</div>
      ) : !items.length ? (
        <div className="ds-card">
          {folder && level === 0 ? (
            <div className="mx-auto max-w-md py-10"><EmptyState icon={<Lock />} title={t('คุณยังไม่มีสิทธิ์ในโฟลเดอร์นี้')} description={t('ส่งคำขอพร้อมเหตุผลเพื่อให้ผู้ดูแลอนุมัติ')} />
              <RequestAccessForm target={{ type: 'folder', id: folder.id, name: folder.name }} compact onDone={() => void reload(true)} /></div>
          ) : (
            <EmptyState icon={<FolderOpen />} title={filter ? t('ไม่พบรายการที่ตรงกับตัวกรอง') : t('โฟลเดอร์นี้ยังว่างอยู่')}
              description={canCreate ? t('สร้างโฟลเดอร์ย่อย หรือสร้างไฟล์ด้วยตัวสร้างฟอร์มเอกสาร') : undefined}
              action={canCreate && folder ? <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav(`/files/new?folder=${folder.id}`)}>{t('สร้างไฟล์')}</Button> : undefined} />
          )}
        </div>
      ) : view === 'grid' ? (
        <motion.div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-4" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.025 } } }}>
          {items.map((it) => (
            <motion.div key={it.kind + it.data.id} variants={{ h: { opacity: 0, y: 8 }, s: { opacity: 1, y: 0 } }}>
              <ItemCard item={it} onMenu={actions.openMenu} onStar={actions.star} draggable={it.data.level >= LV.manage} />
            </motion.div>
          ))}
        </motion.div>
      ) : (
        <div className="overflow-x-auto">
          <table className="row-table min-w-[720px]">
            <thead><tr><th>{t('ชื่อ')}</th><th>{t('แก้ไขล่าสุด')}</th><th>{t('แก้ไขโดย')}</th><th className="hidden md:table-cell">{t('ขนาด')}</th><th>{t('สิทธิ์ของคุณ')}</th><th /></tr></thead>
            <tbody>{items.map((it) => <ItemRow key={it.kind + it.data.id} item={it} onMenu={actions.openMenu} onStar={actions.star} draggable={it.data.level >= LV.manage} />)}</tbody>
          </table>
        </div>
      )}

      {actions.ui}
      {folder && <UnionDialog open={union} onClose={() => setUnion(false)} mode="file" folderId={folder.id} onDone={(r) => { void useData.getState().loadTree(); nav(`/files/${r.fileId}`); }} />}
      <DateTreeDialog folder={folder ?? null} open={dateTree} onClose={() => setDateTree(false)} onDone={() => { void useData.getState().loadTree(); void reload(true); }} />
      <MetaModal open={newFolder} onClose={() => setNewFolder(false)} title={folder ? `โฟลเดอร์ใหม่ใน “${folder.name}”` : t('โฟลเดอร์ใหม่')} initial={{ name: '', color: folder?.color ?? '#1552F0' }}
        onSubmit={async (v) => { await foldersApi.create({ ...v, parentId: folder?.id ?? null }); toast.success(t('สร้างโฟลเดอร์แล้ว')); void useData.getState().loadTree(); void reload(true); }} />
      {folder && <ShareDialog open={share} onClose={() => setShare(false)} target={{ type: 'folder', id: folder.id, name: folder.name }} />}
      {folder && <RequestAccessDialog open={askAccess} onClose={() => { setAskAccess(false); void reload(true); }} target={{ type: 'folder', id: folder.id, name: folder.name }} />}
    </Page>
  );
}
