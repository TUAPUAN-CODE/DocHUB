import { useEffect, useState } from 'react';
import { Pencil, Plus, Tags, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { tagsApi, usersApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Field, TextArea, TextInput } from '@/components/ui/Inputs';
import { Avatar, ColorInput, EmptyState, PageHeader, RoleBadge, Skeleton } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { SearchSelect } from '@/components/ui/SearchSelect';
import { TagChip } from '@/components/ui/TagChip';
import { useLoad } from '@/hooks';
import { confirmDialog, toast } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { isAdminRole, type Tag } from '@/types';
import { UsersTabs } from './UsersTabs';

function TagModal({ open, onClose, tag, onSaved }: { open: boolean; onClose: () => void; tag: Tag | null; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#1552F0');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(tag?.name ?? ''); setColor(tag?.color ?? '#1552F0'); setDesc(tag?.description ?? ''); } }, [open, tag]);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const b = { name: name.trim(), color, description: desc.trim() || null };
      if (tag) await tagsApi.update(tag.id, b); else await tagsApi.create(b);
      toast.success(tag ? 'บันทึก Tag แล้ว' : 'สร้าง Tag แล้ว');
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" icon={<Tags className="h-5 w-5" />} title={tag ? 'แก้ไข Tag' : 'สร้าง Tag'}
      description="ใช้จัดกลุ่มผู้ใช้ เช่น แผนก / ไลน์ผลิต / กะ — แชร์ไฟล์ให้ Tag แล้วทุกคนใน Tag เข้าถึงได้"
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy} disabled={!name.trim()}>{tag ? 'บันทึก' : 'สร้าง Tag'}</Button></>}>
      <div className="space-y-4">
        <Field label="ชื่อ Tag" required hint={tag?.isSystem ? 'Tag ของระบบ — เปลี่ยนชื่อไม่ได้' : undefined}><TextInput autoFocus value={name} disabled={!!tag?.isSystem} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="เช่น QC, ไลน์ PF1, กะดึก" /></Field>
        <Field label="สี"><ColorInput value={color} onChange={(c) => setColor(c ?? '#1552F0')} /></Field>
        <Field label="คำอธิบาย"><TextArea rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} /></Field>
        {name.trim() && <div className="text-sm text-muted">ตัวอย่าง: <TagChip tag={{ name: name.trim(), color }} size="md" /></div>}
      </div>
    </Modal>
  );
}

function MembersModal({ tag, onClose, onChanged }: { tag: Tag | null; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useLoad(() => (tag ? tagsApi.members(tag.id) : Promise.resolve([])), [tag?.id], { skip: !tag });
  const [pick, setPick] = useState<string | null>(null);
  const add = async (userId: string) => {
    if (!tag) return;
    try { await tagsApi.addMembers(tag.id, [userId]); setPick(null); void reload(true); onChanged(); } catch (e) { toast.error(e); }
  };
  const remove = async (userId: string) => {
    if (!tag) return;
    try { await tagsApi.removeMember(tag.id, userId); void reload(true); onChanged(); } catch (e) { toast.error(e); }
  };
  const members = data ?? [];
  return (
    <Modal open={!!tag} onClose={onClose} size="md" icon={<Users className="h-5 w-5" />} title={tag ? <span className="flex flex-wrap items-center gap-2">สมาชิก <TagChip tag={tag} size="md" /></span> : ''}
      description="ผู้ใช้ 1 คนอยู่ได้หลาย Tag · เพิ่ม/เอาออกแล้วมีผลกับสิทธิ์ที่แชร์ให้ Tag นี้ทันที"
      footer={<Button variant="secondary" onClick={onClose}>ปิด</Button>}>
      <div className="rounded-2xl bg-ink/[.03] p-3">
        <SearchSelect value={pick} onChange={(v) => { setPick(v); void add(v); }} placeholder="ค้นหาผู้ใช้เพื่อเพิ่มเข้า Tag…"
          load={async (q) => (await usersApi.lookup(q)).filter((u) => !members.some((m) => m.id === u.id)).map((u) => ({ value: u.id, label: u.displayName, sub: u.email ? `${u.username} · ${u.email}` : u.username }))} />
      </div>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {loading && !data ? <div className="space-y-2 py-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : !members.length ? <p className="py-6 text-center text-sm text-muted">ยังไม่มีสมาชิก</p>
          : <div className="divide-y divide-line">{members.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={u.displayName} src={u.avatarUrl} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate text-sm font-medium">{u.displayName}</span><RoleBadge role={u.role} /></div>
                <div className="truncate text-xs text-muted">@{u.username}{u.isActive === false && ' · ปิดการใช้งาน'}</div>
              </div>
              <button onClick={() => void remove(u.id)} className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger" aria-label={`เอา ${u.displayName} ออกจาก Tag`}><UserMinus className="h-4 w-4" /></button>
            </div>
          ))}</div>}
      </div>
    </Modal>
  );
}

/** Create / edit tags and their members — admin and master (the "จัดการ Tag" tab of /tags, and จัดการผู้ใช้ → Tag) */
export function TagManager() {
  const canDelete = useAuth((s) => isAdminRole(s.user?.role));
  const { data, loading, reload } = useLoad(() => tagsApi.list(), []);
  const [edit, setEdit] = useState<{ tag: Tag | null } | null>(null);
  const [members, setMembers] = useState<Tag | null>(null);
  const remove = async (t: Tag) => {
    if (!(await confirmDialog({
      title: `ลบ Tag “${t.name}”?`,
      message: `เอา Tag นี้ออกจากผู้ใช้ ${t.memberCount} คน และยกเลิกสิทธิ์ที่แชร์ให้ Tag นี้${t.grantCount ? ` (${t.grantCount} รายการ)` : ''} — ผู้ใช้ที่ได้สิทธิ์ผ่าน Tag นี้อย่างเดียวจะเข้าไม่ได้อีก`,
      danger: true, confirmText: 'ลบ Tag',
    }))) return;
    try { await tagsApi.remove(t.id); toast.success('ลบ Tag แล้ว'); void reload(true); } catch (e) { toast.error(e); }
  };
  const tags = data ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Tag ใช้จัดกลุ่มผู้ใช้ แล้วแชร์ไฟล์ / โฟลเดอร์ / ข่าว ให้ทั้งกลุ่มในครั้งเดียว · Tag <b>All</b> = ทุกคน</p>
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ tag: null })}>สร้าง Tag</Button>
      </div>
      {loading && !data ? <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-theme" />)}</div>
        : !tags.length ? (
          <div className="ds-card"><EmptyState icon={<Tags />} title="ยังไม่มี Tag" description="สร้าง Tag เช่น แผนก หรือไลน์ผลิต แล้วใส่ผู้ใช้เข้าไป จากนั้นเลือก Tag ตอนแชร์ไฟล์"
            action={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit({ tag: null })}>สร้าง Tag</Button>} /></div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {tags.map((t) => (
              <div key={t.id} className="ds-card ds-card-pad flex flex-col gap-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5"><TagChip tag={t} size="md" />{t.isSystem && <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] text-muted">Tag ของระบบ</span>}</span>
                    {t.description && <p className="mt-2 text-sm text-muted">{t.description}</p>}
                  </div>
                  <button onClick={() => setEdit({ tag: t })} className="rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink" aria-label={`แก้ไข ${t.name}`}><Pencil className="h-4 w-4" /></button>
                  {canDelete && !t.isSystem && <button onClick={() => void remove(t)} className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger" aria-label={`ลบ ${t.name}`}><Trash2 className="h-4 w-4" /></button>}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted">{t.isSystem ? `ทุกคน (${t.memberCount} คน)` : `สมาชิก ${t.memberCount} คน`}{t.grantCount ? ` · แชร์อยู่ ${t.grantCount} รายการ` : ''}</span>
                  {!t.isSystem && <Button size="sm" variant="secondary" icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setMembers(t)}>สมาชิก</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      <TagModal open={!!edit} onClose={() => setEdit(null)} tag={edit?.tag ?? null} onSaved={() => void reload(true)} />
      <MembersModal tag={members} onClose={() => setMembers(null)} onChanged={() => void reload(true)} />
    </>
  );
}

export default function TagsPage() {
  return (
    <Page>
      <PageHeader icon={<Users />} title="จัดการผู้ใช้" subtitle="Tag ใช้จัดกลุ่มผู้ใช้ แล้วแชร์ไฟล์/โฟลเดอร์ให้ทั้งกลุ่มในครั้งเดียว" />
      <UsersTabs />
      <TagManager />
    </Page>
  );
}
