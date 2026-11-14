import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ImagePlus, KeyRound, Palette, Send, Settings, Type, Upload, UserCircle } from 'lucide-react';
import { authApi, tagsApi, uploadsApi, usersApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { ThemeCustomizer } from '@/components/settings/ThemeCustomizer';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, TextInput, Toggle } from '@/components/ui/Inputs';
import { AppLogo } from '@/components/layout/AppLogo';
import { cn } from '@/lib/cn';
import { Avatar, PageHeader, RoleBadge } from '@/components/ui/misc';
import { TagChip } from '@/components/ui/TagChip';
import { useLoad } from '@/hooks';
import { useAppInfo } from '@/store/appInfo';
import { useAuth } from '@/store/auth';
import { isAdminRole } from '@/types';
import { toast } from '@/store/ui';

function Profile() {
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [name, setName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? '');
  const [username, setUsername] = useState(user.username);
  const [avatar, setAvatar] = useState(user.avatarUrl);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { setUser(await usersApi.updateProfile({ displayName: name, username: username.trim(), email: email.trim() || null, avatarUrl: avatar })); toast.success('บันทึกโปรไฟล์แล้ว'); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="ds-card ds-card-pad max-w-2xl space-y-5">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={avatar} size={72} />
        <div className="space-y-2">
          <div className="flex items-center gap-2"><span className="text-lg font-semibold">@{user.username}</span><RoleBadge role={user.role} /></div>
          <div className="flex gap-2">
            <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-[13px] hover:border-primary/40">
              <Upload className="h-3.5 w-3.5" />เปลี่ยนรูป
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) try { setAvatar((await uploadsApi.image(f)).url); } catch (err) { toast.error(err); }
              }} />
            </label>
            {avatar && <Button size="sm" variant="ghost" onClick={() => setAvatar(null)}>เอารูปออก</Button>}
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="ชื่อที่แสดง" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)" required hint={username.trim() !== user.username ? 'เปลี่ยนแล้วครั้งต่อไปให้เข้าสู่ระบบด้วยชื่อใหม่' : 'a-z 0-9 . _ - อย่างน้อย 3 ตัว'}>
          <TextInput value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></Field>
        <Field label="อีเมล" hint="ไม่บังคับ — ไม่มีอีเมลเว้นว่างได้"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      </div>
      <Button onClick={save} loading={busy} disabled={!name.trim() || username.trim().length < 3}>บันทึกโปรไฟล์</Button>
    </div>
  );
}

/** my tags (with All) — ask for another one on คำขออนุมัติ → คำขอ Tag */
function MyTagsCard() {
  const { data } = useLoad(() => tagsApi.mine(), []);
  return (
    <div className="ds-card ds-card-pad mt-4 max-w-3xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Tag ของฉัน</h3>
        <Link to="/requests?tab=tags&box=mine&ask=1" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/90"><Send className="h-3.5 w-3.5" />ขอ Tag</Link>
      </div>
      <div className="flex flex-wrap gap-1.5">{(data ?? []).map((t) => <TagChip key={t.id} tag={t} size="md" />)}</div>
      <p className="mt-3 text-xs text-muted">ทุกคนมี Tag <b>All</b> · ได้ Tag แล้วจะเห็นไฟล์และข่าวที่แชร์ให้ Tag นั้น · ติดตามคำขอได้ที่ <Link to="/requests?tab=tags&box=mine" className="text-primary hover:underline">คำขออนุมัติ → คำขอ Tag</Link></p>
    </div>
  );
}

function Password() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const mismatch = !!confirm && next !== confirm;
  const submit = async () => {
    setBusy(true);
    try { await authApi.changePassword(cur, next); toast.success('เปลี่ยนรหัสผ่านแล้ว'); setCur(''); setNext(''); setConfirm(''); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="ds-card ds-card-pad max-w-md space-y-4">
      <Field label="รหัสผ่านปัจจุบัน"><TextInput type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="รหัสผ่านใหม่" hint="อย่างน้อย 8 ตัวอักษร"><TextInput type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></Field>
      <Field label="ยืนยันรหัสผ่านใหม่" error={mismatch ? 'รหัสผ่านไม่ตรงกัน' : null}><TextInput type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" invalid={mismatch} /></Field>
      <Button onClick={submit} loading={busy} disabled={!cur || next.length < 8 || next !== confirm}>เปลี่ยนรหัสผ่าน</Button>
    </div>
  );
}

/** admin: the app's name (left bar, sign-in page, browser tab, name under the phone icon) */
function SystemName() {
  const cur = useAppInfo((s) => s.name);
  const save = useAppInfo((s) => s.save);
  const [name, setName] = useState(cur);
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(cur), [cur]);
  const submit = async () => {
    setBusy(true);
    try { await save(name.trim()); toast.success('บันทึกชื่อระบบแล้ว', 'ทุกคนเห็นชื่อใหม่เมื่อเปิดหน้าเว็บครั้งถัดไป'); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="ds-card ds-card-pad max-w-md space-y-4">
      <Field label="ชื่อระบบ" required hint="แสดงที่เมนูด้านซ้าย หน้าเข้าสู่ระบบ แท็บของ browser และชื่อใต้ไอคอนบนมือถือ (ไม่เกิน 40 ตัวอักษร)">
        <TextInput value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Quality" />
      </Field>
      <p className="rounded-xl bg-ink/[.04] px-3 py-2 text-xs text-muted">ไอคอนบนมือถือที่ติดตั้งไว้แล้วจะใช้ชื่อเดิมจนกว่าจะลบไอคอนแล้วเพิ่มใหม่ (ข้อจำกัดของมือถือ)</p>
      <Button onClick={submit} loading={busy} disabled={!name.trim() || name.trim() === cur}>บันทึกชื่อระบบ</Button>
    </div>
  );
}

/** square PNG of `size` px: the picture fitted inside (with a little margin) on the chosen background */
function squarePng(img: HTMLImageElement, size: number, bg: string | null, pad: number): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d')!;
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); }
  const room = size * (1 - 2 * pad), k = Math.min(room / img.naturalWidth, room / img.naturalHeight);
  const w = img.naturalWidth * k, h = img.naturalHeight * k;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('แปลงรูปไม่สำเร็จ'))), 'image/png'));
}

function SystemIcon() {
  const cur = useAppInfo((s) => s.icon);
  const saveIcon = useAppInfo((s) => s.saveIcon);
  const [busy, setBusy] = useState(false);
  const [bg, setBg] = useState('#FFFFFF');
  const [pad, setPad] = useState(true);
  const pick = async (f?: File) => {
    if (!f) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(f.type)) return void toast.error('ใช้ไฟล์รูป PNG, JPG, WEBP หรือ GIF');
    setBusy(true);
    try {
      const url = URL.createObjectURL(f);
      const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('อ่านรูปไม่ได้')); i.src = url; });
      const make = async (size: number) => {
        const blob = await squarePng(img, size, bg, pad ? 0.08 : 0);
        return (await uploadsApi.image(new File([blob], `app-icon-${size}.png`, { type: 'image/png' }))).url;
      };
      const icons = { '512': await make(512), '192': await make(192), '180': await make(180) };
      URL.revokeObjectURL(url);
      await saveIcon(icons);
      toast.success('เปลี่ยนไอคอนระบบแล้ว', 'แท็บ browser เมนูซ้าย หน้าเข้าสู่ระบบ และไอคอนที่เพิ่มลงหน้าจอมือถือใหม่');
    } catch (e) { toast.error(e, 'อัปโหลดไอคอนไม่สำเร็จ'); } finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await saveIcon(null); toast.success('ใช้ไอคอนเดิมของระบบแล้ว'); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="ds-card ds-card-pad mt-4 max-w-md space-y-4">
      <div>
        <p className="font-medium">ไอคอนระบบ</p>
        <p className="text-xs text-muted">แสดงที่แท็บของ browser เมนูด้านซ้าย หน้าเข้าสู่ระบบ และไอคอนบนหน้าจอมือถือ · ใช้รูปสี่เหลี่ยมจัตุรัสจะสวยที่สุด (ระบบย่อ/ใส่ขอบให้เอง)</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="grid h-20 w-20 place-items-center rounded-2xl bg-primary"><AppLogo className="h-16 w-16 rounded-2xl" /></div>
        <div className="flex flex-col gap-2">
          <label className={cn('inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm hover:border-primary', busy && 'pointer-events-none opacity-60')}>
            <ImagePlus className="h-4 w-4" />{busy ? 'กำลังอัปโหลด…' : 'อัปโหลดไอคอน'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {cur && <Button size="sm" variant="secondary" onClick={() => void reset()} disabled={busy}>ใช้ไอคอนเดิมของระบบ</Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">สีพื้นหลัง <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-line" /></label>
        <Toggle checked={pad} onChange={setPad} label="เว้นขอบรอบรูป" />
      </div>
      <p className="rounded-xl bg-ink/[.04] px-3 py-2 text-xs text-muted">ตั้งสี/ขอบก่อนเลือกไฟล์ · ไอคอนบนมือถือที่ติดตั้งไว้แล้วจะเปลี่ยนเมื่อลบไอคอนแล้วเพิ่มลงหน้าจอใหม่ (ข้อจำกัดของมือถือ)</p>
    </div>
  );
}

export default function SettingsPage() {
  const [sp, setSp] = useSearchParams();
  const admin = useAuth((s) => isAdminRole(s.user?.role));
  const asked = (sp.get('tab') ?? 'appearance') as 'profile' | 'password' | 'appearance' | 'system';
  const tab = asked === 'system' && !admin ? 'appearance' : asked;
  return (
    <Page>
      <PageHeader icon={<Settings />} title="ตั้งค่า" actions={
        <Segmented value={tab} onChange={(v) => setSp({ tab: v })} options={[{ value: 'appearance', label: 'ธีมและรูปแบบ', icon: <Palette /> }, { value: 'profile', label: 'โปรไฟล์', icon: <UserCircle /> }, { value: 'password', label: 'รหัสผ่าน', icon: <KeyRound /> },
          ...(admin ? [{ value: 'system' as const, label: 'ชื่อและไอคอนระบบ', icon: <Type /> }] : [])]} />
      } />
      {tab === 'profile' ? <><Profile /><MyTagsCard /></> : tab === 'password' ? <Password /> : tab === 'system' ? <><SystemName /><SystemIcon /></> : <ThemeCustomizer />}
    </Page>
  );
}
