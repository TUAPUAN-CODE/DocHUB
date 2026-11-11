import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Palette, Settings, Upload, UserCircle } from 'lucide-react';
import { authApi, uploadsApi, usersApi } from '@/api/endpoints';
import { Page } from '@/components/layout/AppShell';
import { ThemeCustomizer } from '@/components/settings/ThemeCustomizer';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, TextInput } from '@/components/ui/Inputs';
import { Avatar, PageHeader, RoleBadge } from '@/components/ui/misc';
import { useAuth } from '@/store/auth';
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

export default function SettingsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') ?? 'appearance') as 'profile' | 'password' | 'appearance';
  return (
    <Page>
      <PageHeader icon={<Settings />} title="ตั้งค่า" actions={
        <Segmented value={tab} onChange={(v) => setSp({ tab: v })} options={[{ value: 'appearance', label: 'ธีมและรูปแบบ', icon: <Palette /> }, { value: 'profile', label: 'โปรไฟล์', icon: <UserCircle /> }, { value: 'password', label: 'รหัสผ่าน', icon: <KeyRound /> }]} />
      } />
      {tab === 'profile' ? <Profile /> : tab === 'password' ? <Password /> : <ThemeCustomizer />}
    </Page>
  );
}
