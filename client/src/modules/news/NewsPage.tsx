import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ExternalLink, ImagePlus, Megaphone, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2, X } from 'lucide-react';
import { tagsApi, uploadsApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Lightbox } from '@/components/sheet/ImageCell';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput, Toggle } from '@/components/ui/Inputs';
import { Avatar, EmptyState, PageHeader, Pager, RoleBadge, Skeleton } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { MenuList, Popover } from '@/components/ui/Popover';
import { TagChip, TagPicker } from '@/components/ui/TagChip';
import { useDebounce, useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtDateTime, relTime } from '@/lib/format';
import { prepareImage } from '@/lib/imageCompress';
import { getSocket } from '@/lib/socket';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import type { Tag } from '@/types';
import { NewsBody, NewsPost, newsApi } from './api';

const MAX_IMAGES = 10;

/** text with clickable links, line breaks kept */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink/90">
      {parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={i} href={p} target="_blank" rel="noreferrer" className="text-primary underline">{p}</a> : p))}
    </p>
  );
}

function PostEditor({ open, onClose, post, tags, canPin, onSaved }: {
  open: boolean; onClose: () => void; post: NewsPost | null; tags: Tag[]; canPin: boolean; onSaved: () => void;
}) {
  const [f, setF] = useState<NewsBody>({ title: '', body: '', tagIds: [], images: [], linkUrl: null, pinned: false });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(post
      ? { title: post.title, body: post.body, tagIds: post.tags.map((t) => t.id), images: post.images, linkUrl: post.linkUrl, pinned: post.pinned }
      : { title: '', body: '', tagIds: [], images: [], linkUrl: null, pinned: false });
  }, [open, post]);
  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of [...files].slice(0, MAX_IMAGES - f.images.length)) urls.push((await uploadsApi.image(await prepareImage(file))).url);
      setF((x) => ({ ...x, images: [...x.images, ...urls].slice(0, MAX_IMAGES) }));
    } catch (e) { toast.error(e); } finally { setUploading(false); }
  };
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...f, title: f.title.trim(), body: f.body.trim(), linkUrl: f.linkUrl?.trim() || null };
      if (post) await newsApi.update(post.id, body); else await newsApi.create(body);
      toast.success(post ? 'บันทึกข่าวแล้ว' : 'โพสต์ข่าวแล้ว', post ? undefined : 'ผู้ที่มี Tag ที่เลือกจะเห็นข่าวนี้');
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const allTag = tags.find((t) => t.isSystem);
  const picked = tags.filter((t) => f.tagIds.includes(t.id));
  const ready = f.title.trim() && f.body.trim() && f.tagIds.length && !uploading;
  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<Megaphone className="h-5 w-5" />} title={post ? 'แก้ไขข่าว' : 'โพสต์ข่าว'}
      description="เลือก Tag ของผู้ที่ควรเห็นข่าวนี้ — Tag All = ทุกคนในระบบ"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy} disabled={!ready}>{post ? 'บันทึก' : 'โพสต์'}</Button></>}>
      <div className="space-y-4">
        <Field label="หัวข้อ" required><TextInput autoFocus value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="เช่น แจ้งหยุดไลน์ PF1 วันเสาร์นี้" /></Field>
        <Field label="รายละเอียด" required><TextArea rows={6} value={f.body} maxLength={20000} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="พิมพ์ข้อความ ลิงก์ที่ขึ้นต้นด้วย https:// จะกดได้" /></Field>
        <Field group label="ส่งถึง (Tag)" required hint={picked.length ? `เห็นได้: ${picked.map((t) => t.name).join(', ')}${picked.some((t) => t.isSystem) ? ' (ทุกคน)' : ''}` : 'เลือกอย่างน้อย 1 Tag'}>
          <div className="space-y-2">
            {allTag && !f.tagIds.includes(allTag.id) && (
              <button type="button" onClick={() => setF({ ...f, tagIds: [allTag.id] })} className="text-xs font-medium text-primary hover:underline">ส่งถึงทุกคน (เลือก All)</button>
            )}
            <TagPicker tags={tags} value={f.tagIds} onChange={(ids) => setF({ ...f, tagIds: ids })} />
          </div>
        </Field>
        <Field group label={`รูปภาพ (ไม่เกิน ${MAX_IMAGES} รูป)`}>
          <div className="flex flex-wrap gap-2">
            {f.images.map((u) => (
              <div key={u} className="relative h-20 w-20 overflow-hidden rounded-xl border border-line">
                <img src={u} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => setF({ ...f, images: f.images.filter((x) => x !== u) })} aria-label="ลบรูป"
                  className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {f.images.length < MAX_IMAGES && (
              <label className={cn('grid h-20 w-20 cursor-pointer place-items-center rounded-xl border border-dashed border-ink/25 text-muted hover:border-primary hover:text-primary', uploading && 'pointer-events-none opacity-50')}>
                <span className="flex flex-col items-center gap-1 text-[11px]"><ImagePlus className="h-5 w-5" />{uploading ? 'กำลังอัปโหลด…' : 'เพิ่มรูป'}</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addImages(e.target.files); e.target.value = ''; }} />
              </label>
            )}
          </div>
        </Field>
        <Field label="ลิงก์ (ไม่บังคับ)" hint="เช่น ลิงก์ไฟล์ใน DocHUB (คัดลอกจากปุ่มแชร์) หรือเว็บไซต์">
          <TextInput value={f.linkUrl ?? ''} maxLength={1000} onChange={(e) => setF({ ...f, linkUrl: e.target.value })} placeholder="https://… หรือ /files/…" />
        </Field>
        {canPin && <Toggle checked={f.pinned} onChange={(v) => setF({ ...f, pinned: v })} label="ปักหมุดไว้บนสุด" />}
      </div>
    </Modal>
  );
}

function PostCard({ post, canPin, onEdit, onChanged, highlight }: { post: NewsPost; canPin: boolean; onEdit: () => void; onChanged: () => void; highlight?: boolean }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [view, setView] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const long = post.body.length > 600 || post.body.split('\n').length > 10;
  const remove = async () => {
    if (!(await confirmDialog({ title: `ลบข่าว “${post.title}”?`, danger: true, confirmText: 'ลบข่าว' }))) return;
    try { await newsApi.remove(post.id); toast.success('ลบข่าวแล้ว'); onChanged(); } catch (e) { toast.error(e); }
  };
  const pin = async () => {
    try { await newsApi.pin(post.id, !post.pinned); onChanged(); } catch (e) { toast.error(e); }
  };
  const items = [
    ...(canPin ? [{ label: post.pinned ? 'เลิกปักหมุด' : 'ปักหมุดไว้บนสุด', icon: post.pinned ? <PinOff /> : <Pin />, onClick: () => void pin() }] : []),
    ...(post.canEdit ? [{ label: 'แก้ไข', icon: <Pencil />, onClick: onEdit }, { label: 'ลบ', icon: <Trash2 />, danger: true, onClick: () => void remove() }] : []),
  ];
  const internal = post.linkUrl?.startsWith('/');
  return (
    <article id={`post-${post.id}`} className={cn('ds-card ds-card-pad scroll-mt-20', post.pinned && 'border-primary/40', highlight && 'ring-2 ring-primary/50')}>
      <header className="flex items-start gap-3">
        <Avatar name={post.author.displayName} src={post.author.avatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <b>{post.author.displayName}</b><RoleBadge role={post.author.role} />
            <span className="text-xs text-muted" title={fmtDateTime(post.createdAt)}>{relTime(post.createdAt)}{post.updatedByName && post.updatedAt !== post.createdAt ? ' · แก้ไขแล้ว' : ''}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted">ถึง</span>{post.tags.map((t) => <TagChip key={t.id} tag={t} />)}
          </div>
        </div>
        {post.pinned && <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"><Pin className="h-3 w-3" />ปักหมุด</span>}
        {post.isNew && <span className="rounded-full bg-warning px-2 py-0.5 text-[11px] font-semibold text-white">ใหม่</span>}
        {!!items.length && <button onClick={(e) => setMenu(e.currentTarget)} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label="ตัวเลือกข่าว"><MoreHorizontal className="h-5 w-5" /></button>}
      </header>
      <h2 className="mt-3 text-lg font-semibold leading-snug">{post.title}</h2>
      <div className={cn('mt-1.5', long && !more && 'line-clamp-[10]')}><RichText text={post.body} /></div>
      {long && <button onClick={() => setMore(!more)} className="mt-1 text-sm font-medium text-primary">{more ? 'ย่อ' : 'อ่านต่อ'}</button>}
      {!!post.images.length && (
        <div className={cn('mt-3 grid gap-2', post.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3')}>
          {post.images.map((u, i) => (
            <button key={u} onClick={() => setView(i)} className={cn('overflow-hidden rounded-xl border border-line bg-ink/[.03]', post.images.length === 1 ? 'max-h-[420px]' : 'aspect-square')}>
              <img src={u} alt="" loading="lazy" className={cn('h-full w-full', post.images.length === 1 ? 'object-contain' : 'object-cover')} />
            </button>
          ))}
        </div>
      )}
      {post.linkUrl && (internal
        ? <Link to={post.linkUrl} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><ExternalLink className="h-4 w-4" />เปิดลิงก์</Link>
        : <a href={post.linkUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"><ExternalLink className="h-4 w-4" />{post.linkUrl}</a>)}
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={menu} placement="bottom-end" width={200}><MenuList onClose={() => setMenu(null)} items={items} /></Popover>
      {view !== null && <Lightbox urls={post.images} index={view} onIndex={setView} onClose={() => setView(null)} />}
    </article>
  );
}

/** ข่าวสาร: posts seen by the users of their tags (All = everyone) */
export default function NewsPage() {
  const [sp, setSp] = useSearchParams();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [mine, setMine] = useState(false);
  const dq = useDebounce(q, 300);
  const setUnread = useData((s) => s.setNewsUnread);
  const { data, loading, reload } = useLoad(() => newsApi.list({ page, q: dq || undefined, tag: tag || undefined, mine }), [page, dq, tag, mine]);
  const { data: tags } = useLoad(() => tagsApi.list(), []);
  const [edit, setEdit] = useState<{ post: NewsPost | null } | null>(null);
  const deepId = sp.get('post');
  const { data: deep } = useLoad(() => (deepId ? newsApi.get(deepId) : Promise.resolve(null)), [deepId], { skip: !deepId });

  // opening the board marks everything as read (the "ใหม่" marks stay until the page is left)
  const markSeen = useCallback(() => { void newsApi.seen().then(() => setUnread(0)).catch(() => undefined); }, [setUnread]);
  useEffect(() => { markSeen(); }, [markSeen]);
  useEffect(() => {
    const s = getSocket();
    const on = () => { void reload(true); markSeen(); };
    s?.on('news:changed', on);
    return () => { s?.off('news:changed', on); };
  }, [reload, markSeen]);
  useEffect(() => { setPage(1); }, [dq, tag, mine]);

  const items = data?.items ?? [];
  const changed = () => void reload(true);
  return (
    <Page>
      <PageHeader icon={<Megaphone />} title="ข่าวสาร" subtitle="ประกาศและข่าวของโรงงาน — เห็นเฉพาะข่าวที่ส่งถึง Tag ของคุณ (All = ทุกคน)"
        actions={data?.canPost && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ post: null })}>โพสต์ข่าว</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1"><TextInput icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาหัวข้อ / ข้อความ…" /></div>
        <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-44" aria-label="กรองตาม Tag">
          <option value="">ทุก Tag</option>
          {(tags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Toggle checked={mine} onChange={setMine} label="ข่าวที่ฉันโพสต์" />
      </div>
      {deep && (
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between text-xs text-muted"><span>ข่าวที่เปิดจากแจ้งเตือน</span><button onClick={() => setSp({}, { replace: true })} className="hover:text-ink">ปิด</button></div>
          <PostCard post={deep} canPin={!!data?.canPin} onEdit={() => setEdit({ post: deep })} onChanged={changed} highlight />
        </div>
      )}
      {loading && !data ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 rounded-theme" />)}</div>
        : !items.length ? (
          <div className="ds-card"><EmptyState icon={<Megaphone />} title={q || tag || mine ? 'ไม่พบข่าวที่ตรงกับตัวกรอง' : 'ยังไม่มีข่าว'}
            description={data?.canPost ? 'กด “โพสต์ข่าว” แล้วเลือก Tag ของผู้ที่ควรเห็น' : 'เมื่อมีข่าวส่งถึง Tag ของคุณจะแสดงที่นี่'}
            action={data?.canPost && !q && !tag && !mine ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ post: null })}>โพสต์ข่าว</Button> : undefined} /></div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-3">
            {items.map((p) => <PostCard key={p.id} post={p} canPin={!!data?.canPin} onEdit={() => setEdit({ post: p })} onChanged={changed} />)}
            {data && data.total > data.pageSize && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </div>
        )}
      <PostEditor open={!!edit} onClose={() => setEdit(null)} post={edit?.post ?? null} tags={tags ?? []} canPin={!!data?.canPin} onSaved={changed} />
    </Page>
  );
}
