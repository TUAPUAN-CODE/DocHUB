import { FormEvent, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Lock, User as UserIcon } from 'lucide-react';
import { apiError, http } from '@/api/client';
import { authApi } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Inputs';
import { useAuth } from '@/store/auth';
import { useT } from '@/i18n';
import { LangSwitcher } from '@/i18n/LangSwitcher';

export default function LoginPage() {
  const t = useT();
  const login = useAuth((s) => s.login);
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<{ google: boolean; microsoft: boolean }>({ google: false, microsoft: false });
  useEffect(() => {
    authApi.providers().then(setProviders).catch(() => undefined);
    const e = new URLSearchParams(window.location.search).get('oauth_error');
    if (e) { setErr(e); window.history.replaceState(null, '', '/login'); }
  }, []);
  const social = (p: 'google' | 'microsoft') => {
    const from = loc.state?.from ?? '/';
    window.location.href = `${http.defaults.baseURL}/auth/oauth/${p}/start?from=${encodeURIComponent(from)}`;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(username.trim(), password);
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (e2) {
      setErr(apiError(e2).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative grid min-h-full lg:grid-cols-[1.1fr_1fr]" style={{ background: 'rgb(var(--c-bg))' }}>
      <div className="absolute right-4 top-4 z-20"><LangSwitcher /></div>
      <div className="relative hidden overflow-hidden bg-primary p-12 text-white lg:flex lg:flex-col">
        <svg className="absolute inset-0 h-full w-full opacity-[.12]" aria-hidden>
          <defs><pattern id="g" width="56" height="36" patternUnits="userSpaceOnUse"><path d="M56 0H0V36" fill="none" stroke="white" strokeWidth="1" /></pattern></defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>
        <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-primary">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9M10 4v16" /></svg>
          </span>
          <span className="text-lg font-semibold">DataSheet Pro</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl font-semibold leading-tight">{t('ข้อมูลทั้งทีม')}<br />{t('อยู่ในตารางเดียว')}</h1>
          <p className="mt-4 text-white/80">{t('ออกแบบฟอร์มเอกสาร กำหนดชนิดข้อมูลทุกคอลัมน์ ควบคุมสิทธิ์รายไฟล์ ย้อนดูได้ทุกการแก้ไข และสร้างแดชบอร์ดจากข้อมูลจริง')}</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <motion.form onSubmit={submit} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="ds-card ds-card-pad w-full max-w-sm !p-8">
          <h2 className="text-2xl font-semibold">{t('เข้าสู่ระบบ')}</h2>
          <p className="mt-1 text-sm text-muted">{t('ใช้ชื่อผู้ใช้หรืออีเมลขององค์กร')}</p>
          <div className="mt-6 space-y-4">
            <Field label={t('ชื่อผู้ใช้หรืออีเมล')}>
              <TextInput icon={<UserIcon />} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
            </Field>
            <Field label={t('รหัสผ่าน')}>
              <div className="ds-input flex h-10 items-center gap-2 px-3">
                <Lock className="h-4 w-4 text-muted" />
                <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required
                  className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none" />
                <button type="button" onClick={() => setShow(!show)} className="text-muted hover:text-ink" aria-label={show ? t('ซ่อนรหัสผ่าน') : t('แสดงรหัสผ่าน')}>
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            {err && <motion.p initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</motion.p>}
            <Button type="submit" size="lg" className="w-full" loading={busy}>{t('เข้าสู่ระบบ')}</Button>
          </div>
          {(providers.google || providers.microsoft) && (
            <div className="mt-5">
              <div className="mb-4 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />{t('หรือเข้าสู่ระบบด้วย')}<span className="h-px flex-1 bg-line" /></div>
              <div className="space-y-2.5">
                {providers.google && (
                  <button type="button" onClick={() => social('google')} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-sm font-medium transition-colors hover:bg-ink/5">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12s4.3 9.6 9.6 9.6c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" /></svg>
                    Google / Gmail
                  </button>
                )}
                {providers.microsoft && (
                  <button type="button" onClick={() => social('microsoft')} className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface text-sm font-medium transition-colors hover:bg-ink/5">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden><path fill="#F25022" d="M2 2h9.5v9.5H2z" /><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" /><path fill="#00A4EF" d="M2 12.5h9.5V22H2z" /><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" /></svg>
                    Microsoft (Outlook / Office 365)
                  </button>
                )}
              </div>
            </div>
          )}
          {import.meta.env.DEV && (
            <p className="mt-6 rounded-lg bg-ink/5 px-3 py-2 text-xs text-muted">บัญชีทดลอง: admin / Admin@123 · master / Master@123 · user / User@1234</p>
          )}
        </motion.form>
      </div>
    </div>
  );
}
