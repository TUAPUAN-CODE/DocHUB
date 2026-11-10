import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileSpreadsheet, Folder, KeyRound, Search } from 'lucide-react';
import { searchApi } from '@/api/endpoints';
import { RequestAccessDialog } from '@/components/files/Dialogs';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Inputs';
import { EmptyState, PageHeader, PermBadge, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';
import { levelToPerm, relTime } from '@/lib/format';

function Highlight({ text, q }: { text: string; q: string }) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return <>{text}</>;
  const re = new RegExp(`(${tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(re).map((p, i) => (tokens.includes(p.toLowerCase()) ? <mark key={i} className="rounded bg-warning/30 px-0.5 text-ink">{p}</mark> : p))}</>;
}

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const [tab, setTab] = useState<'all' | 'files' | 'folders'>('all');
  const [req, setReq] = useState<{ type: 'file' | 'folder'; id: string; name: string } | null>(null);
  const { data, loading } = useLoad(() => searchApi.search(q, 100), [q]);
  const files = tab !== 'folders' ? data?.files ?? [] : [];
  const folders = tab !== 'files' ? data?.folders ?? [] : [];

  return (
    <Page>
      <PageHeader icon={<Search />} title={`ผลการค้นหา “${q}”`} subtitle={data ? `พบ ${data.files.length} ไฟล์ และ ${data.folders.length} โฟลเดอร์` : 'กำลังค้นหา…'}
        actions={<Segmented value={tab} onChange={setTab} options={[{ value: 'all', label: 'ทั้งหมด' }, { value: 'files', label: 'ไฟล์' }, { value: 'folders', label: 'โฟลเดอร์' }]} />} />
      {q.trim().length >= 2 && (
        <Link to={`/traceback?q=${encodeURIComponent(q.trim())}`} className="mb-4 flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/[.04] px-4 py-3 text-sm text-primary hover:bg-primary/[.08]">
          <Search className="h-4 w-4 shrink-0" /><span>หน้านี้ค้นจากชื่อไฟล์/โฟลเดอร์ — <b>ค้นหา “{q.trim()}” ในข้อมูลทุกชีต</b> (เมนู Search)</span>
        </Link>
      )}
      {loading ? <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-theme" />)}</div>
        : !files.length && !folders.length ? <div className="ds-card"><EmptyState icon={<Search />} title="ไม่พบผลลัพธ์" description="ลองใช้คำค้นที่สั้นลง หรือตรวจสอบการสะกด" /></div>
        : (
          <div className="space-y-2">
            {[...folders.map((f) => ({ ...f, kind: 'folder' as const, sub: f.path })), ...files.map((f) => ({ ...f, kind: 'file' as const, sub: `${f.path} · ${relTime(f.updatedAt)}` }))].map((r) => (
              <div key={r.kind + r.id} className="ds-card flex items-center gap-4 px-4 py-3">
                {r.kind === 'folder' ? <Folder className="h-5 w-5 shrink-0" style={{ color: r.color }} /> : <FileSpreadsheet className="h-5 w-5 shrink-0" style={{ color: r.color }} />}
                <Link to={r.kind === 'folder' ? `/folders/${r.id}` : `/files/${r.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium"><Highlight text={r.name} q={q} /></p>
                  <p className="truncate text-xs text-muted">{r.sub}</p>
                </Link>
                <PermBadge perm={levelToPerm(r.level)} />
                {r.level === 0 && <Button size="sm" variant="subtle" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setReq({ type: r.kind, id: r.id, name: r.name })}>ขอสิทธิ์</Button>}
              </div>
            ))}
          </div>
        )}
      <RequestAccessDialog open={!!req} onClose={() => setReq(null)} target={req} />
    </Page>
  );
}
