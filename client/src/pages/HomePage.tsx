import { Link, useNavigate } from 'react-router-dom';
import { isBasicRole } from '@/types';
import { motion } from 'framer-motion';
import { Clock, FilePlus2, FolderPlus, Star } from 'lucide-react';
import { useState } from 'react';
import { activityApi, foldersApi } from '@/api/endpoints';
import { ActivityCard } from '@/components/files/ItemViews';
import { FileGlyph, FolderGlyph } from '@/components/files/icons';
import { MetaModal } from '@/components/files/Dialogs';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';
import { relTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import { useT } from '@/i18n';

export default function HomePage() {
  const t = useT();
  const nav = useNavigate();
  const user = useAuth((s) => s.user)!;
  const favorites = useData((s) => s.favorites);
  const tree = useData((s) => s.tree);
  const feed = useLoad(() => activityApi.feed(), []);
  const recent = useLoad(() => activityApi.recent(), []);
  const [newFolder, setNewFolder] = useState(false);
  const roots = tree.filter((f) => !f.parentId).slice(0, 8);
  const canCreate = !isBasicRole(user.role);

  return (
    <Page>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          <h1 className="text-[26px] font-semibold tracking-tight">{t('กิจกรรมล่าสุด')}</h1>
        </div>
        {canCreate && (
          <div className="flex gap-2">
            <Button variant="secondary" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setNewFolder(true)}>{t('โฟลเดอร์ใหม่')}</Button>
            <Button icon={<FilePlus2 className="h-4 w-4" />} onClick={() => nav('/files/new')}>{t('สร้างไฟล์')}</Button>
          </div>
        )}
      </div>

      {roots.length > 0 && (
        <div className="mb-7 flex gap-3 overflow-x-auto pb-1">
          {roots.map((f) => (
            <Link key={f.id} to={`/folders/${f.id}`} className="ds-card flex min-w-[200px] items-center gap-3 px-3.5 py-3 transition-colors hover:border-primary/40">
              <FolderGlyph color={f.color} size={34} locked={f.level === 0} />
              <span className="min-w-0"><span className="block truncate text-sm font-semibold">{f.name}</span><span className="text-xs text-muted">{f.fileCount} ไฟล์ · {f.folderCount} โฟลเดอร์</span></span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[1fr_320px]">
        <section>
          {feed.loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-64 rounded-theme" />)}</div>
          ) : !feed.data?.length ? (
            <div className="ds-card"><EmptyState icon={<Clock />} title={t('ยังไม่มีกิจกรรม')} description={t('เมื่อมีการสร้างหรือแก้ไขไฟล์ที่คุณมีสิทธิ์ จะแสดงที่นี่')} /></div>
          ) : (
            <motion.div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.04 } } }}>
              {feed.data.map((f) => (
                <motion.div key={f.id} variants={{ h: { opacity: 0, y: 10 }, s: { opacity: 1, y: 0 } }}><ActivityCard file={f} /></motion.div>
              ))}
            </motion.div>
          )}
        </section>

        <aside className="space-y-6">
          <div className="ds-card">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold"><Clock className="h-4 w-4 text-primary" /> {t('เปิดล่าสุด')}</div>
            <div className="p-2">
              {recent.loading && <div className="space-y-2 p-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>}
              {!recent.loading && !recent.data?.length && <p className="px-3 py-6 text-center text-sm text-muted">{t('ยังไม่มีไฟล์ที่เปิดล่าสุด')}</p>}
              {recent.data?.map((f) => (
                <Link key={f.id} to={`/files/${f.id}`} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-ink/5">
                  <FileGlyph color={f.color} size={28} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{f.name}</span><span className="block truncate text-xs text-muted">เปิด{relTime(f.viewedAt)}</span></span>
                </Link>
              ))}
            </div>
          </div>
          <div className="ds-card">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3 text-sm font-semibold"><Star className="h-4 w-4 text-warning" /> {t('รายการโปรด')}</div>
            <div className="p-2">
              {!favorites.length && <p className="px-3 py-6 text-center text-sm text-muted">{t('กดดาวเพื่อเพิ่มไฟล์หรือโฟลเดอร์ที่ใช้บ่อย')}</p>}
              {favorites.map((f) => (
                <Link key={`${f.type}${f.id}`} to={f.type === 'file' ? `/files/${f.id}` : `/folders/${f.id}`} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-ink/5">
                  {f.type === 'file' ? <FileGlyph color={f.color} size={28} /> : <FolderGlyph color={f.color} size={28} />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{f.name}</span><span className="block truncate text-xs text-muted">{f.path}</span></span>
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <MetaModal open={newFolder} onClose={() => setNewFolder(false)} title={t('สร้างโฟลเดอร์ระดับบนสุด')} initial={{ name: '', color: '#1552F0' }}
        onSubmit={async (v) => { const f = await foldersApi.create({ ...v, parentId: null }); toast.success(t('สร้างโฟลเดอร์แล้ว')); void useData.getState().loadTree(); nav(`/folders/${f.id}`); }} />
    </Page>
  );
}
