import { useEffect, useState } from 'react';
import { KeyRound, MoreHorizontal, Pencil, Search, ShieldCheck, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { tagsApi, usersApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Select, TextInput } from '@/components/ui/Inputs';
import { Avatar, EmptyState, PageHeader, Pager, RoleBadge, Skeleton, StatusDot } from '@/components/ui/misc';
import { Modal } from '@/components/ui/Modal';
import { Anchor, MenuList, Popover } from '@/components/ui/Popover';
import { TagChip, TagPicker } from '@/components/ui/TagChip';
import { useDebounce, useLoad } from '@/hooks';
import { fmtDateTime, relTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { confirmDialog, toast } from '@/store/ui';
import { ROLE_HINT, ROLE_OPTIONS } from '@/lib/roles';
import type { Role, TagRef, User } from '@/types';
import { UsersTabs } from './users/UsersTabs';

function UserModal({ open, onClose, user, onSaved, tags }: { open: boolean; onClose: () => void; user: User | null; onSaved: () => void; tags: TagRef[] }) {
  const [f, setF] = useState({ username: '', email: '', displayName: '', password: '', role: 'user' as Role });
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF(user ? { username: user.username, email: user.email, displayName: user.displayName, password: '', role: user.role } : { username: '', email: '', displayName: '', password: '', role: 'user' });
    setTagIds((user?.tags ?? []).map((t) => t.id));
  }, [open, user]);
  const submit = async () => {
    setBusy(true);
    try {
      const before = (user?.tags ?? []).map((t) => t.id).sort().join();
      if (user) {
        await usersApi.update(user.id, { email: f.email, displayName: f.displayName, role: f.role });
        if ([...tagIds].sort().join() !== before) await tagsApi.setUserTags(user.id, tagIds);
      } else {
        const created = await usersApi.create(f);
        if (tagIds.length) await tagsApi.setUserTags(created.id, tagIds);
      }
      toast.success(user ? 'บันทึกแล้ว' : 'สร้างผู้ใช้แล้ว');
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={user ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} size="sm" icon={<UserPlus className="h-5 w-5" />}
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={submit} loading={busy}>{user ? 'บันทึก' : 'สร้างผู้ใช้'}</Button></>}>
      <div className="space-y-4">
        <Field label="ชื่อที่แสดง" required><TextInput value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} autoFocus /></Field>
        <Field label="ชื่อผู้ใช้" required hint="a-z 0-9 . _ - อย่างน้อย 3 ตัว"><TextInput value={f.username} disabled={!!user} onChange={(e) => setF({ ...f, username: e.target.value })} /></Field>
        <Field label="อีเมล" required><TextInput type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        {!user && <Field label="รหัสผ่านเริ่มต้น" required hint="อย่างน้อย 8 ตัวอักษร"><TextInput type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>}
        <Field label="บทบาท" hint={ROLE_HINT[f.role]}>
          <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>{ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</Select>
        </Field>
        <Field label="Tag" hint="เลือกได้หลาย Tag — ได้สิทธิ์ไฟล์/โฟลเดอร์ที่แชร์ให้ Tag นั้น"><TagPicker tags={tags} value={tagIds} onChange={setTagIds} /></Field>
      </div>
    </Modal>
  );
}

export default function UsersPage() {
  const me = useAuth((s) => s.user);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const dq = useDebounce(q, 300);
  const { data, loading, reload } = useLoad(() => usersApi.list({ page, pageSize: 20, search: dq || undefined, role: role || undefined, status: status || undefined, tag: tag || undefined }), [page, dq, role, status, tag]);
  const { data: tags } = useLoad(() => tagsApi.list(), []);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ user: User | null } | null>(null);
  const [menu, setMenu] = useState<{ anchor: Anchor; user: User } | null>(null);
  const [reset, setReset] = useState<User | null>(null);
  const [pw, setPw] = useState('');

  const bulk = async (action: 'activate' | 'deactivate' | 'set_role', r?: Role) => {
    try { await usersApi.bulk([...picked], action, r); toast.success('อัปเดตผู้ใช้แล้ว'); setPicked(new Set()); void reload(true); } catch (e) { toast.error(e); }
  };
  const toggleActive = async (u: User) => {
    if (u.isActive && !(await confirmDialog({ title: `ปิดการใช้งาน ${u.displayName}?`, message: 'ผู้ใช้จะออกจากระบบทันทีและเข้าสู่ระบบไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง', danger: true, confirmText: 'ปิดการใช้งาน' }))) return;
    try { await usersApi.update(u.id, { isActive: !u.isActive }); void reload(true); } catch (e) { toast.error(e); }
  };
  const items = data?.items ?? [];
  const allPicked = items.length > 0 && items.every((u) => picked.has(u.id));

  return (
    <Page>
      <PageHeader icon={<Users />} title="จัดการผู้ใช้" subtitle={data ? `ทั้งหมด ${data.stats.total} คน · ใช้งานอยู่ ${data.stats.active} คน` : ''}
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setEdit({ user: null })}>เพิ่มผู้ใช้</Button>} />
      <UsersTabs />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TextInput icon={<Search />} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล" className="w-full sm:w-72" />
        <Select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="w-40"><option value="">ทุกบทบาท</option><option value="admin">Admin</option><option value="master">Master</option><option value="user">User</option><option value="viewer">Viewer</option></Select>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="w-40"><option value="">ทุกสถานะ</option><option value="active">ใช้งานอยู่</option><option value="inactive">ปิดการใช้งาน</option></Select>
        {!!tags?.length && (
          <Select value={tag} onChange={(e) => { setTag(e.target.value); setPage(1); }} className="w-40"><option value="">ทุก Tag</option>{tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        )}
        {picked.size > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 rounded-xl bg-primary/10 px-2 py-1">
            <span className="px-1 text-sm font-medium text-primary">เลือก {picked.size}</span>
            <Button size="sm" variant="ghost" icon={<UserCheck className="h-3.5 w-3.5" />} onClick={() => bulk('activate')}>เปิดใช้งาน</Button>
            <Button size="sm" variant="ghost" icon={<UserX className="h-3.5 w-3.5" />} onClick={() => bulk('deactivate')}>ปิดใช้งาน</Button>
            <Select className="w-36 [&>select]:!h-8 [&>select]:text-xs" value="" onChange={(e) => e.target.value && bulk('set_role', e.target.value as Role)}>
              <option value="">เปลี่ยนบทบาท…</option><option value="viewer">Viewer</option><option value="user">User</option><option value="master">Master</option><option value="admin">Admin</option>
            </Select>
          </div>
        )}
      </div>
      {loading && !data ? <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-theme" />)}</div>
        : !items.length ? <div className="ds-card"><EmptyState icon={<Users />} title="ไม่พบผู้ใช้" /></div>
        : (
          <>
            <div className="overflow-x-auto">
              <table className="row-table min-w-[900px]">
                <thead><tr>
                  <th className="w-10"><Checkbox checked={allPicked} onChange={(v) => setPicked(v ? new Set(items.filter((u) => u.id !== me?.id).map((u) => u.id)) : new Set())} /></th>
                  <th>ผู้ใช้ / Tag</th><th>อีเมล</th><th>บทบาท</th><th>สถานะ</th><th>เข้าใช้ล่าสุด</th><th>สร้างเมื่อ</th><th />
                </tr></thead>
                <tbody>
                  {items.map((u) => (
                    <tr key={u.id}>
                      <td>{u.id !== me?.id && <Checkbox checked={picked.has(u.id)} onChange={(v) => { const n = new Set(picked); if (v) n.add(u.id); else n.delete(u.id); setPicked(n); }} />}</td>
                      <td><div className="flex items-center gap-3"><Avatar name={u.displayName} src={u.avatarUrl} size={36} />
                        <span className="min-w-0"><span className="block truncate font-medium">{u.displayName}{u.id === me?.id && <span className="ml-1.5 text-xs text-muted">(คุณ)</span>}</span><span className="block text-xs text-muted">@{u.username}</span>
                          {!!u.tags?.length && <span className="mt-1 flex max-w-[260px] flex-wrap gap-1">{u.tags.map((t) => <TagChip key={t.id} tag={t} />)}</span>}</span></div></td>
                      <td className="text-[13px]">{u.email}</td>
                      <td><RoleBadge role={u.role} /></td>
                      <td><StatusDot tone={u.isActive ? 'green' : 'gray'} label={u.isActive ? 'ใช้งานอยู่' : 'ปิดการใช้งาน'} /></td>
                      <td className="text-[13px] text-muted" title={fmtDateTime(u.lastLoginAt)}>{u.lastLoginAt ? relTime(u.lastLoginAt) : 'ยังไม่เคย'}</td>
                      <td className="text-[13px] text-muted">{fmtDateTime(u.createdAt).slice(0, 10)}</td>
                      <td className="text-right"><button onClick={(e) => setMenu({ anchor: e.currentTarget, user: u })} className="rounded-lg p-1.5 text-muted hover:bg-ink/5" aria-label="ตัวเลือก"><MoreHorizontal className="h-4 w-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4"><Pager page={page} pageSize={20} total={data?.total ?? 0} onPage={setPage} /></div>
          </>
        )}
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} placement="bottom-end" width={210}>
        {menu && <MenuList onClose={() => setMenu(null)} items={[
          { label: 'แก้ไข', icon: <Pencil />, onClick: () => setEdit({ user: menu.user }) },
          { label: 'รีเซ็ตรหัสผ่าน', icon: <KeyRound />, onClick: () => { setReset(menu.user); setPw(''); } },
          ...(menu.user.id !== me?.id ? [{ label: menu.user.isActive ? 'ปิดการใช้งาน' : 'เปิดใช้งาน', icon: menu.user.isActive ? <UserX /> : <ShieldCheck />, danger: menu.user.isActive, onClick: () => void toggleActive(menu.user) }] : []),
        ]} />}
      </Popover>
      <UserModal open={!!edit} onClose={() => setEdit(null)} user={edit?.user ?? null} onSaved={() => void reload(true)} tags={tags ?? []} />
      <Modal open={!!reset} onClose={() => setReset(null)} size="sm" title={`รีเซ็ตรหัสผ่าน ${reset?.displayName ?? ''}`} description="ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์"
        footer={<><Button variant="secondary" onClick={() => setReset(null)}>ยกเลิก</Button><Button disabled={pw.length < 8} onClick={async () => {
          try { await usersApi.resetPassword(reset!.id, pw); toast.success('รีเซ็ตรหัสผ่านแล้ว'); setReset(null); } catch (e) { toast.error(e); }
        }}>รีเซ็ต</Button></>}>
        <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร"><TextInput type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
      </Modal>
    </Page>
  );
}
