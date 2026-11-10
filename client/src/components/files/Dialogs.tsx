import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, Check, ChevronRight, Copy, Folder, KeyRound, Link2, Lock, Share2, Tags, Trash2, UserPlus } from 'lucide-react';
import type { ApiErrorInfo } from '@/api/client';
import { accessApi, filesApi, foldersApi, requestsApi, tagsApi, usersApi } from '@/api/endpoints';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtDateTime, PERM_LABEL } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { toast } from '@/store/ui';
import { AccessGrant, FolderItem, LV, Perm, TagGrant, isBasicRole } from '@/types';
import { Button } from '../ui/Button';
import { Field, Segmented, Select, TextArea, TextInput, Toggle } from '../ui/Inputs';
import { Avatar, ColorInput, PermBadge, RoleBadge, Skeleton } from '../ui/misc';
import { Modal } from '../ui/Modal';
import { SearchSelect } from '../ui/SearchSelect';
import { TagChip } from '../ui/TagChip';

/* ---------------- Name / color / description ---------------- */
export function MetaModal({ open, onClose, title, initial, onSubmit, withDescription = true }: {
  open: boolean; onClose: () => void; title: string; initial: { name: string; color?: string | null; description?: string | null };
  onSubmit: (v: { name: string; color: string; description: string | null }) => Promise<void>; withDescription?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color ?? '#1552F0');
  const [desc, setDesc] = useState(initial.description ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setName(initial.name); setColor(initial.color ?? '#1552F0'); setDesc(initial.description ?? ''); }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try { await onSubmit({ name: name.trim(), color, description: desc.trim() || null }); onClose(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy} disabled={!name.trim()}>บันทึก</Button></>}>
      <div className="space-y-4">
        <Field label="ชื่อ" required><TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} maxLength={300} /></Field>
        <Field label="สี"><ColorInput value={color} onChange={(c) => setColor(c ?? '#1552F0')} /></Field>
        {withDescription && <Field label="คำอธิบาย"><TextArea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} /></Field>}
      </div>
    </Modal>
  );
}

/* ---------------- Folder picker ---------------- */
export function FolderPicker({ value, onChange, minLevel = LV.write, exclude }: { value: string | null; onChange: (id: string) => void; minLevel?: number; exclude?: string }) {
  const tree = useData((s) => s.tree);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const kids = useMemo(() => {
    const m = new Map<string | null, FolderItem[]>();
    const ids = new Set(tree.map((f) => f.id));
    tree.forEach((f) => { const p = f.parentId && ids.has(f.parentId) ? f.parentId : null; if (!m.has(p)) m.set(p, []); m.get(p)!.push(f); });
    return m;
  }, [tree]);
  const render = (p: string | null, depth: number): JSX.Element[] =>
    (kids.get(p) ?? []).filter((f) => f.id !== exclude).map((f) => {
      const ch = kids.get(f.id) ?? [];
      const ok = f.level >= minLevel;
      return (
        <div key={f.id}>
          <div className={cn('flex items-center gap-1 rounded-lg pr-2', value === f.id ? 'bg-primary/10 text-primary' : 'hover:bg-ink/5')} style={{ paddingLeft: 4 + depth * 16 }}>
            <button type="button" onClick={() => setOpen({ ...open, [f.id]: !open[f.id] })} className={cn('grid h-7 w-6 place-items-center', !ch.length && 'invisible')}>
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open[f.id] && 'rotate-90')} />
            </button>
            <button type="button" disabled={!ok} onClick={() => onChange(f.id)} className="flex h-8 min-w-0 flex-1 items-center gap-2 text-left text-sm disabled:opacity-40">
              <Folder className="h-4 w-4 shrink-0" style={{ color: f.color }} /><span className="truncate">{f.name}</span>
            </button>
          </div>
          {open[f.id] && render(f.id, depth + 1)}
        </div>
      );
    });
  return <div className="max-h-72 overflow-y-auto rounded-xl border border-line p-1.5">{tree.length ? render(null, 0) : <p className="p-4 text-center text-sm text-muted">ไม่มีโฟลเดอร์</p>}</div>;
}

export function MoveDialog({ open, onClose, item, onDone }: { open: boolean; onClose: () => void; item: { type: 'file' | 'folder'; id: string; name: string } | null; onDone: () => void }) {
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const role = useAuth((s) => s.user?.role);
  useEffect(() => setTarget(null), [open]);
  const submit = async (toRoot = false) => {
    if (!item) return;
    setBusy(true);
    try {
      if (item.type === 'file') await filesApi.move(item.id, target!);
      else await foldersApi.move(item.id, toRoot ? null : target);
      toast.success(`ย้าย "${item.name}" แล้ว`);
      void useData.getState().loadTree();
      onDone();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`ย้าย “${item?.name ?? ''}”`} description="เลือกโฟลเดอร์ปลายทางที่คุณมีสิทธิ์เขียน" size="sm"
      footer={<>
        {item?.type === 'folder' && !isBasicRole(role) && <Button variant="ghost" className="mr-auto" onClick={() => submit(true)} disabled={busy}>ย้ายไประดับบนสุด</Button>}
        <Button variant="secondary" onClick={onClose}>ยกเลิก</Button>
        <Button onClick={() => submit(false)} loading={busy} disabled={!target}>ย้ายมาที่นี่</Button>
      </>}>
      <FolderPicker value={target} onChange={setTarget} exclude={item?.type === 'folder' ? item.id : undefined} />
    </Modal>
  );
}

export function DuplicateDialog({ open, onClose, file, onDone }: { open: boolean; onClose: () => void; file: { id: string; name: string; folderId: string } | null; onDone: (id: string) => void }) {
  const [name, setName] = useState('');
  const [includeData, setInclude] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (file) { setName(`${file.name} (สำเนา)`); setFolder(file.folderId); setInclude(false); } }, [file, open]);
  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try { const r = await filesApi.duplicate(file.id, { name, folderId: folder ?? undefined, includeData }); toast.success('ทำสำเนาไฟล์แล้ว'); onDone(r.id); onClose(); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="ทำสำเนาไฟล์" description="ใช้เป็นเทมเพลตฟอร์มเอกสาร หรือคัดลอกทั้งข้อมูล" size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy} disabled={!name.trim() || !folder}>ทำสำเนา</Button></>}>
      <div className="space-y-4">
        <Field label="ชื่อไฟล์ใหม่" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="เก็บไว้ในโฟลเดอร์"><FolderPicker value={folder} onChange={setFolder} /></Field>
        <Toggle checked={includeData} onChange={setInclude} label="คัดลอกข้อมูลทุกแถวด้วย (ไม่เลือก = คัดลอกเฉพาะโครงสร้าง)" />
      </div>
    </Modal>
  );
}

import { copyText, ShareLinksSection } from './ShareLinks';

/* ---------------- Share ---------------- */
const EXPIRY = [
  { v: '', label: 'ไม่มีวันหมดอายุ' }, { v: '7', label: '7 วัน' }, { v: '30', label: '30 วัน' }, { v: '90', label: '90 วัน' }, { v: '365', label: '1 ปี' },
];
const expiryIso = (days: string) => (days ? new Date(Date.now() + Number(days) * 86400_000).toISOString() : null);

function GrantRow({ g, editable, onChange, onRemove }: { g: AccessGrant; editable?: boolean; onChange?: (p: Perm) => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar name={g.displayName} src={g.avatarUrl} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{g.displayName}</span><RoleBadge role={g.role} /></div>
        <div className="truncate text-xs text-muted">
          {g.source === 'owner' ? 'เจ้าของ' : g.source === 'folder_owner' ? `ผู้สร้างโฟลเดอร์ ${g.folderName}` : g.source === 'folder' ? `สืบทอดจากโฟลเดอร์ ${g.folderName}` : g.email}
          {g.expiresAt && <span className={cn('ml-2 inline-flex items-center gap-1', g.expired && 'text-danger')}><CalendarClock className="h-3 w-3" />{g.expired ? 'หมดอายุแล้ว' : `ถึง ${fmtDateTime(g.expiresAt)}`}</span>}
        </div>
      </div>
      {editable ? (
        <>
          <Select value={g.permission} onChange={(e) => onChange?.(e.target.value as Perm)} className="w-36">
            <option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option>
          </Select>
          <button onClick={onRemove} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label="ถอนสิทธิ์"><Trash2 className="h-4 w-4" /></button>
        </>
      ) : <PermBadge perm={g.permission} />}
    </div>
  );
}

function TagGrantRow({ g, editable, onChange, onRemove }: { g: TagGrant; editable?: boolean; onChange?: (p: Perm) => void; onRemove?: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full" style={{ background: `${g.color}1f`, color: g.color }}><Tags className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><TagChip tag={g} /><span className="text-xs text-muted">{g.memberCount} คน</span></div>
        <div className="truncate text-xs text-muted">
          {g.source === 'folder' && g.folderName ? `สืบทอดจากโฟลเดอร์ ${g.folderName}` : 'ทุกคนที่มี Tag นี้'}
          {g.expiresAt && <span className={cn('ml-2 inline-flex items-center gap-1', g.expired && 'text-danger')}><CalendarClock className="h-3 w-3" />{g.expired ? 'หมดอายุแล้ว' : `ถึง ${fmtDateTime(g.expiresAt)}`}</span>}
        </div>
      </div>
      {editable ? (
        <>
          <Select value={g.permission} onChange={(e) => onChange?.(e.target.value as Perm)} className="w-36">
            <option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option>
          </Select>
          <button onClick={onRemove} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label={`ถอนสิทธิ์ Tag ${g.name}`}><Trash2 className="h-4 w-4" /></button>
        </>
      ) : <PermBadge perm={g.permission} />}
    </div>
  );
}

export function ShareDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: { type: 'file' | 'folder'; id: string; name: string } | null }) {
  const { data, loading, reload } = useLoad(() => (target ? accessApi.get(target.type, target.id) : Promise.resolve(null)), [target?.id, open], { skip: !open || !target });
  const { data: allTags } = useLoad(() => tagsApi.list(), [open], { skip: !open });
  const [mode, setMode] = useState<'user' | 'tag'>('user');
  const [userId, setUserId] = useState<string | null>(null);
  const [tagId, setTagId] = useState('');
  const [perm, setPerm] = useState<Perm>('write');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  if (!target) return null;

  const grantTag = async (tid: string, p: Perm, exp: string | null) => {
    try {
      const r = await accessApi.grantTag(target.type, target.id, { tagId: tid, permission: p, expiresAt: exp });
      toast.success(`แชร์ให้ Tag แล้ว (${r.members} คน)`, 'ผู้ใช้ระดับ User / Viewer ใช้สิทธิ์ได้ไม่เกินระดับของตัวเอง');
      void reload(true);
    } catch (e) { toast.error(e); }
  };
  const addTag = async () => {
    if (!tagId) return;
    setBusy(true);
    await grantTag(tagId, perm, expiryIso(expiry));
    setTagId('');
    setBusy(false);
  };
  const revokeTag = async (tid: string) => {
    try { await accessApi.revokeTag(target.type, target.id, tid); void reload(true); } catch (e) { toast.error(e); }
  };

  const grant = async (uid: string, p: Perm, exp: string | null) => {
    try {
      const r = await accessApi.grant(target.type, target.id, { userId: uid, permission: p, expiresAt: exp });
      if (r.cappedTo === 'write') toast.info('ผู้ใช้ระดับ User ใช้สิทธิ์ได้สูงสุด "แก้ไขข้อมูล"');
      if (r.cappedTo === 'read') toast.info('ผู้ใช้ระดับ Viewer ใช้สิทธิ์ได้สูงสุด "ดูข้อมูล"');
      void reload(true);
    } catch (e) { toast.error(e); }
  };
  const add = async () => {
    if (!userId) return;
    setBusy(true);
    await grant(userId, perm, expiryIso(expiry));
    setUserId(null);
    setBusy(false);
  };
  const revoke = async (uid: string) => {
    try { await accessApi.revoke(target.type, target.id, uid); void reload(true); } catch (e) { toast.error(e); }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" icon={<Share2 className="h-5 w-5" />} title={`แชร์ “${target.name}”`}
      description={target.type === 'folder' ? 'สิทธิ์ของโฟลเดอร์จะสืบทอดไปยังโฟลเดอร์ย่อยและไฟล์ทั้งหมดภายใน' : 'สิทธิ์รายไฟล์ ใช้ร่วมกับสิทธิ์ที่สืบทอดจากโฟลเดอร์ (ใช้ระดับที่สูงกว่า)'}>
      <ItemLink target={target} />
      {target.type === 'file' && <ShareLinksSection fileId={target.id} />}
      <div className="mb-2"><Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'user', label: 'แชร์ให้ผู้ใช้', icon: <UserPlus /> }, { value: 'tag', label: 'แชร์ให้ Tag', icon: <Tags /> }]} /></div>
      <div className="flex flex-col gap-2 rounded-2xl bg-ink/[.03] p-3 sm:flex-row">
        <div className="min-w-0 flex-1">
          {mode === 'user' ? (
            <SearchSelect value={userId} onChange={(v) => setUserId(v)} placeholder="ค้นหาผู้ใช้เพื่อเพิ่ม…"
              load={async (q) => (await usersApi.lookup(q)).map((u) => ({ value: u.id, label: u.displayName, sub: `${u.username} · ${u.email}` }))} />
          ) : (
            <Select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label="เลือก Tag">
              <option value="">{allTags?.length ? 'เลือก Tag…' : 'ยังไม่มี Tag (Admin สร้างได้ที่ จัดการผู้ใช้ → Tag)'}</option>
              {(allTags ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.memberCount} คน)</option>)}
            </Select>
          )}
        </div>
        <Select value={perm} onChange={(e) => setPerm(e.target.value as Perm)} className="sm:w-36">
          <option value="read">ดูข้อมูล</option><option value="write">แก้ไขข้อมูล</option><option value="manage">จัดการ</option>
        </Select>
        <Select value={expiry} onChange={(e) => setExpiry(e.target.value)} className="sm:w-40">
          {EXPIRY.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
        </Select>
        {mode === 'user'
          ? <Button icon={<UserPlus className="h-4 w-4" />} onClick={add} loading={busy} disabled={!userId}>เพิ่ม</Button>
          : <Button icon={<Tags className="h-4 w-4" />} onClick={addTag} loading={busy} disabled={!tagId}>เพิ่ม</Button>}
      </div>
      <div className="mt-4 max-h-[50vh] overflow-y-auto">
        {loading && !data ? <div className="space-y-3 py-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div> : data && (
          <>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">ผู้มีสิทธิ์โดยตรง</p>
            <div className="divide-y divide-line">
              {data.owner && <GrantRow g={data.owner} />}
              {data.direct.map((g) => <GrantRow key={g.userId} g={g} editable onChange={(p) => grant(g.userId, p, g.expiresAt)} onRemove={() => revoke(g.userId)} />)}
              {!data.direct.length && <p className="py-3 text-sm text-muted">ยังไม่ได้แชร์ให้ใครโดยตรง</p>}
            </div>
            {(!!data.tags?.length || !!data.inheritedTags?.length) && (
              <>
                <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">แชร์ให้ Tag</p>
                <div className="divide-y divide-line">
                  {(data.tags ?? []).map((g) => <TagGrantRow key={g.tagId} g={g} editable onChange={(p) => grantTag(g.tagId, p, g.expiresAt)} onRemove={() => revokeTag(g.tagId)} />)}
                  {(data.inheritedTags ?? []).map((g, i) => <TagGrantRow key={`${g.tagId}-${i}`} g={g} />)}
                </div>
              </>
            )}
            {data.inherited.length > 0 && (
              <>
                <p className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">สืบทอดจากโฟลเดอร์</p>
                <div className="divide-y divide-line">{data.inherited.map((g, i) => <GrantRow key={`${g.userId}-${i}`} g={g} />)}</div>
              </>
            )}
            <p className="mt-4 text-xs text-muted">Admin ทุกคนมีสิทธิ์จัดการทุกไฟล์โดยอัตโนมัติ</p>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Link to the folder / file itself: the receiver signs in first (then lands on it); without access they can ask for it there */
export const itemUrl = (t: { type: 'file' | 'folder'; id: string }) => `${window.location.origin}/${t.type === 'file' ? 'files' : 'folders'}/${t.id}`;

function ItemLink({ target }: { target: { type: 'file' | 'folder'; id: string } }) {
  const [copied, setCopied] = useState(false);
  const url = itemUrl(target);
  const copy = async () => {
    if (await copyText(url)) { setCopied(true); toast.success('คัดลอกลิงก์แล้ว'); setTimeout(() => setCopied(false), 1800); }
    else toast.error('คัดลอกไม่สำเร็จ กรุณาคัดลอกลิงก์ด้วยตัวเอง');
  };
  return (
    <div className="mb-4 rounded-2xl border border-line p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Link2 className="h-4 w-4 text-primary" />ลิงก์ของ{target.type === 'file' ? 'ไฟล์' : 'โฟลเดอร์'}นี้</div>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} className="ds-input h-9 min-w-0 flex-1 px-3 text-xs text-muted" aria-label="ลิงก์" />
        <Button size="sm" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} onClick={copy}>{copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</Button>
      </div>
      <p className="mt-1.5 text-xs text-muted">ผู้รับต้องเข้าสู่ระบบก่อน แล้วจะเปิด{target.type === 'file' ? 'ไฟล์' : 'โฟลเดอร์'}นี้ให้เอง · ใช้ได้กับคนที่มีสิทธิ์ (เพิ่มด้านล่าง) — คนที่ยังไม่มีสิทธิ์จะเห็นปุ่มขอสิทธิ์</p>
    </div>
  );
}

/* ---------------- No access (opened from a link) ---------------- */
export function NoAccessView({ info, onRetry }: { info: ApiErrorInfo; onRetry: () => void }) {
  const d = info.details ?? {};
  const type: 'file' | 'folder' = d.targetType === 'folder' ? 'folder' : 'file';
  const what = type === 'file' ? 'ไฟล์' : 'โฟลเดอร์';
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="ds-card ds-card-pad !p-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-warning/15 text-warning"><Lock className="h-8 w-8" /></span>
        <h1 className="mt-4 text-xl font-semibold">{info.code === 'NO_ACCESS' ? `คุณยังไม่มีสิทธิ์เข้าถึง${what}นี้` : `เปิด${what}ไม่ได้`}</h1>
        <p className="mt-1 text-sm text-muted">{d.name ? `“${d.name}”` : info.message}</p>
        {info.code === 'NO_ACCESS' && (d.pending ? (
          <div className="mt-6 rounded-2xl bg-primary/[.06] p-4 text-sm">
            <p className="font-medium text-primary">คำขอของคุณกำลังรอการอนุมัติ</p>
            <p className="mt-1 text-muted">ส่งเมื่อ {fmtDateTime(d.pending.createdAt)} · คุณจะได้รับการแจ้งเตือนเมื่อมีผลการพิจารณา</p>
            <Button variant="ghost" size="sm" className="mt-3" onClick={async () => { await requestsApi.cancel(d.pending.id); onRetry(); }}>ยกเลิกคำขอ</Button>
          </div>
        ) : <div className="mt-6"><RequestAccessForm target={{ type, id: d.targetId, name: d.name }} compact onDone={onRetry} /></div>)}
      </motion.div>
    </div>
  );
}

/* ---------------- Request access ---------------- */
export function RequestAccessForm({ target, onDone, compact }: { target: { type: 'file' | 'folder'; id: string; name: string }; onDone?: () => void; compact?: boolean }) {
  const role = useAuth((s) => s.user?.role);
  const [perm, setPerm] = useState<Perm>('write');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await requestsApi.create({ targetType: target.type, targetId: target.id, permission: perm, note: note.trim(), durationDays: days ? Number(days) : null });
      toast.success('ส่งคำขอแล้ว', 'ผู้ดูแลไฟล์จะได้รับการแจ้งเตือน');
      onDone?.();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const left = 10 - note.trim().length;
  return (
    <div className={cn('space-y-4', compact && 'text-left')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ระดับสิทธิ์ที่ขอ">
          <Select value={perm} onChange={(e) => setPerm(e.target.value as Perm)}>
            <option value="read">{PERM_LABEL.read}</option><option value="write">{PERM_LABEL.write}</option>
            {!isBasicRole(role) && <option value="manage">{PERM_LABEL.manage}</option>}
          </Select>
        </Field>
        <Field label="ระยะเวลา">
          <Select value={days} onChange={(e) => setDays(e.target.value)}>{EXPIRY.map((x) => <option key={x.v} value={x.v}>{x.v ? x.label : 'ถาวร'}</option>)}</Select>
        </Field>
      </div>
      <Field label="เหตุผลในการขอสิทธิ์" required error={note && left > 0 ? `พิมพ์เพิ่มอีก ${left} ตัวอักษร` : null} hint="ระบุงานที่ต้องใช้ไฟล์นี้ เพื่อให้ผู้อนุมัติพิจารณาได้เร็วขึ้น">
        <TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="เช่น ต้องบันทึกยอดผลิตกะดึกของไลน์ PF1 ตั้งแต่สัปดาห์นี้" />
      </Field>
      <Button icon={<KeyRound className="h-4 w-4" />} onClick={submit} loading={busy} disabled={left > 0} className={compact ? 'w-full' : ''}>ส่งคำขอสิทธิ์</Button>
    </div>
  );
}

export function RequestAccessDialog({ open, onClose, target }: { open: boolean; onClose: () => void; target: { type: 'file' | 'folder'; id: string; name: string } | null }) {
  return (
    <Modal open={open && !!target} onClose={onClose} title={`ขอสิทธิ์เข้าถึง “${target?.name ?? ''}”`} icon={<KeyRound className="h-5 w-5" />} size="md">
      {target && <RequestAccessForm target={target} onDone={onClose} />}
    </Modal>
  );
}
