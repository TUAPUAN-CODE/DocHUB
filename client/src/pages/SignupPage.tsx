import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, Eye, EyeOff, Lock, Mail, User as UserIcon, UserPlus } from 'lucide-react';
import { apiError, http } from '@/api/client';
import { accountRequestsApi, authApi } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextArea, TextInput } from '@/components/ui/Inputs';
import type { Role } from '@/types';
import { nextPath } from './LoginPage';
import { ROLE_HINT, ROLE_OPTIONS } from '@/lib/roles';

const PROVIDER = { microsoft: 'Microsoft', google: 'Google' } as const;

/** "ขอสร้างบัญชี": anyone can ask; an admin approves with the role they decide (users page → คำขอสร้างบัญชี) */
export default function SignupPage() {
  const sp = new URLSearchParams(window.location.search);
  const oauthToken = sp.get('oauth');
  const next = nextPath(window.location.search, '');
  const loginLink = next ? `/login?next=${encodeURIComponent(next)}` : '/login';
  const [oauth, setOauth] = useState<{ provider: 'microsoft' | 'google'; email: string; name: string } | null>(null);
  const [providers, setProviders] = useState<{ google: boolean; microsoft: boolean }>({ google: false, microsoft: false });
  const [f, setF] = useState({ displayName: '', email: '', username: '', password: '', confirm: '', requestedRole: 'user' as Role, note: '' });
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<false | 'created' | 'requested'>(false);

  useEffect(() => {
    authApi.providers().then(setProviders).catch(() => undefined);
    if (oauthToken)
      accountRequestsApi.oauthInfo(oauthToken)
        .then((o) => { setOauth(o); setF((x) => ({ ...x, displayName: o.name, email: o.email })); })
        .catch((e) => setErr(apiError(e).message));
  }, [oauthToken]);

  const social = (p: 'google' | 'microsoft') => {
    window.location.href = `${http.defaults.baseURL}/auth/oauth/${p}/start?from=${encodeURIComponent(next || '/')}`;
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!oauthToken && f.password !== f.confirm) return setErr('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    setBusy(true);
    try {
      const r = await accountRequestsApi.signup(oauthToken
        ? { displayName: f.displayName.trim(), requestedRole: f.requestedRole, note: f.note.trim() || undefined, oauthToken }
        : { displayName: f.displayName.trim(), email: f.email.trim(), username: f.username.trim(), password: f.password, requestedRole: f.requestedRole, note: f.note.trim() || undefined });
      setDone(r.created ? 'created' : 'requested');
    } catch (e2) {
      setErr(apiError(e2).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4 sm:p-6" style={{ background: 'rgb(var(--c-bg))' }}>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="ds-card ds-card-pad w-full max-w-md !p-6 sm:!p-8">
        {done ? (
          <div className="text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success"><CheckCircle2 className="h-8 w-8" /></span>
            <h1 className="mt-4 text-xl font-semibold">{done === 'created' ? 'สร้างบัญชีแล้ว' : 'ส่งคำขอสร้างบัญชีแล้ว'}</h1>
            <p className="mt-2 text-sm text-muted">
              {done === 'created' ? 'เข้าสู่ระบบ' : 'ผู้ดูแลระบบได้รับการแจ้งเตือนแล้ว เมื่ออนุมัติแล้วเข้าสู่ระบบ'}{oauth ? `ด้วย ${PROVIDER[oauth.provider]} (${oauth.email})` : `ด้วยชื่อผู้ใช้ “${f.username.trim()}” และรหัสผ่านที่ตั้งไว้`}ได้เลย
            </p>
            <Link to={loginLink} className="mt-6 inline-block"><Button>กลับไปหน้าเข้าสู่ระบบ</Button></Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><UserPlus className="h-5 w-5" /></span>
              <div><h1 className="text-xl font-semibold">ขอสร้างบัญชี</h1><p className="text-sm text-muted">User / Viewer ได้บัญชีทันที · Master / Admin รอผู้ดูแลอนุมัติ</p></div>
            </div>
            {oauth && (
              <div className="mt-5 rounded-xl bg-primary/[.06] px-3 py-2.5 text-sm">
                ขอบัญชีด้วย <b>{PROVIDER[oauth.provider]}</b><div className="break-all text-muted">{oauth.email}</div>
              </div>
            )}
            <div className="mt-5 space-y-4">
              <Field label="ชื่อ-นามสกุล" required><TextInput icon={<UserIcon />} value={f.displayName} onChange={set('displayName')} required maxLength={200} autoFocus={!oauthToken} /></Field>
              {!oauthToken && (
                <>
                  <Field label="อีเมล" hint="ไม่บังคับ — ไม่มีอีเมลเว้นว่างได้"><TextInput icon={<Mail />} type="email" value={f.email} onChange={set('email')} maxLength={255} autoComplete="email" /></Field>
                  <Field label="ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ)" required hint="a-z 0-9 . _ - อย่างน้อย 3 ตัว">
                    <TextInput icon={<UserIcon />} value={f.username} onChange={set('username')} required minLength={3} maxLength={100} pattern="[a-zA-Z0-9._\-]+" autoComplete="username" />
                  </Field>
                  <Field label="รหัสผ่าน" required hint="อย่างน้อย 8 ตัวอักษร">
                    <div className="ds-input flex h-10 items-center gap-2 px-3">
                      <Lock className="h-4 w-4 text-muted" />
                      <input type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} required minLength={8} maxLength={200} autoComplete="new-password"
                        className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
                      <button type="button" onClick={() => setShow(!show)} className="text-muted hover:text-ink" aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
                        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <Field label="ยืนยันรหัสผ่าน" required><TextInput icon={<Lock />} type={show ? 'text' : 'password'} value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>
                </>
              )}
              <Field label="ระดับที่ต้องการ" hint={`${ROLE_HINT[f.requestedRole]} — User / Viewer ได้บัญชีทันที, Master / Admin รอผู้ดูแลอนุมัติ`}>
                <Select value={f.requestedRole} onChange={set('requestedRole')}>{ROLE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</Select>
              </Field>
              <Field label="แผนก / เหตุผล"><TextArea rows={2} value={f.note} onChange={set('note')} maxLength={1000} placeholder="เช่น QC ไลน์ PF1 ต้องบันทึกผลตรวจ" /></Field>
              {err && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
              <Button type="submit" size="lg" className="w-full" loading={busy}>ส่งคำขอ</Button>
            </div>
            {!oauthToken && (providers.microsoft || providers.google) && (
              <div className="mt-5">
                <div className="mb-3 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />หรือขอด้วยบัญชี<span className="h-px flex-1 bg-line" /></div>
                <div className="space-y-2">
                  {providers.microsoft && (
                    <button type="button" onClick={() => social('microsoft')} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-sm font-medium transition-colors hover:bg-ink/5">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#F25022" d="M2 2h9.5v9.5H2z" /><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" /><path fill="#00A4EF" d="M2 12.5h9.5V22H2z" /><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" /></svg>
                      Microsoft (Outlook / Office 365)
                    </button>
                  )}
                  {providers.google && (
                    <button type="button" onClick={() => social('google')} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-sm font-medium transition-colors hover:bg-ink/5">Google / Gmail</button>
                  )}
                </div>
              </div>
            )}
            <p className="mt-6 text-center text-sm text-muted">มีบัญชีแล้ว? <Link to={loginLink} className="font-medium text-primary hover:underline">เข้าสู่ระบบ</Link></p>
          </form>
        )}
      </motion.div>
    </div>
  );
}
