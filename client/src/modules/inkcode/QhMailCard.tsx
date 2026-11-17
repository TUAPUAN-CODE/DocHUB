import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Field, Segmented, TextArea, TextInput, Toggle } from '@/components/ui/Inputs';
import { useAuth } from '@/store/auth';
import { toast } from '@/store/ui';
import { OutlookStatus, QhMailConfig, qhMailApi, SmtpPublic } from './api';

const toList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Mail sent when an imported plan has a Doc No that is in Quality Highlight: the people (To / CC), the subject and the intro are typed here;
 * the table of plan lines + Quality Highlight details is added by the system. Sent from the Outlook mailbox connected below.
 */
export function QhMailCard() {
  const staff = useAuth((s) => ['master', 'admin', 'root'].includes(s.user?.role ?? ''));
  const [cfg, setCfg] = useState<QhMailConfig | null>(null);
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [outlook, setOutlook] = useState<OutlookStatus | null>(null);
  const [smtp, setSmtp] = useState<SmtpPublic | null>(null);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState('');
  const apply = (c: QhMailConfig) => { setCfg(c); setTo(c.to.join('\n')); setCc(c.cc.join('\n')); };
  const load = () => qhMailApi.get().then((r) => { apply(r.config); setOutlook(r.outlook); setSmtp(r.smtp); }).catch((e) => toast.error(e, 'โหลดตั้งค่าอีเมลไม่สำเร็จ'));
  useEffect(() => { if (staff) void load(); }, [staff]);  // eslint-disable-line react-hooks/exhaustive-deps
  // after the Microsoft popup closes, read the connection again
  useEffect(() => {
    const h = (e: MessageEvent) => { if (e.origin === window.location.origin && e.data?.type === 'ms-connector') { if (e.data.ok) toast.success('เชื่อม Outlook แล้ว'); else toast.error('เชื่อม Outlook ไม่สำเร็จ'); void load(); } };
    window.addEventListener('message', h);
    return () => window.removeEventListener('message', h);
  }, []);
  if (!staff || !cfg || !smtp) return null;

  const bad = [...toList(to), ...toList(cc)].filter((x) => !EMAIL.test(x));
  const run = async (name: string, f: () => Promise<void>) => { setBusy(name); try { await f(); } catch (e) { toast.error(apiError(e).message); } finally { setBusy(''); } };
  const save = () => run('save', async () => { if (cfg.channel === 'smtp') setSmtp((await qhMailApi.saveSmtp({ ...smtp, ...(pw ? { password: pw } : {}) })).smtp);
    setPw('');
    const r = await qhMailApi.save({ ...cfg, to: toList(to), cc: toList(cc) }); apply(r.config); toast.success('บันทึกตั้งค่าอีเมลแล้ว'); });
  const connect = () => run('connect', async () => { const { url } = await qhMailApi.start(); if (!window.open(url, 'ms-login', 'width=520,height=680')) toast.error('เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป — อนุญาตป๊อปอัปแล้วลองใหม่'); });
  const test = () => run('test', async () => {
    // what is typed is saved first, so the test uses it
    await save();
    const r = await qhMailApi.test(); toast.success('ส่งอีเมลทดสอบแล้ว', `ถึง ${r.sentTo} (อีเมลผู้ส่ง)`); });
  const disconnect = () => run('off', async () => { const r = await qhMailApi.disconnect(); setOutlook(r.outlook); toast.success('ยกเลิกการเชื่อม Outlook แล้ว'); });

  return (
    <div className="ds-card mb-4 space-y-3 p-4">
      <div className="flex items-start gap-2">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">อีเมลแจ้ง Quality Highlight</p>
          <p className="text-sm text-muted">เมื่อนำเข้าแผนผลิตแล้วมี Doc No ตรงกับ Sub Doc No. ใน Quality Highlight ระบบทำอีเมลให้ (To / CC / หัวข้อ ด้านล่าง + ตารางรายการในแผนและรายละเอียดจาก Quality Highlight): ใต้ผลนำเข้ามีปุ่ม “เปิดอีเมลใน Outlook” (ได้ไฟล์ที่เปิดแล้วขึ้นหน้าเขียนอีเมลพร้อมตารางเต็ม) ให้กดส่งเองได้เลยโดยไม่ต้องตั้งเซิร์ฟเวอร์เมล · หรือเปิดสวิตช์ด้านขวาให้ส่งอัตโนมัติ (ต้องตั้งช่องทางส่งด้านล่าง) · ส่งอัตโนมัติไม่ส่งซ้ำแผนเดิม</p>
        </div>
        <Toggle checked={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} label={cfg.enabled ? 'ส่งอัตโนมัติ: เปิด' : 'ส่งอัตโนมัติ: ปิด'} />
      </div>

      <div className="space-y-3 rounded-xl border border-line p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">ส่งผ่าน</span>
          <Segmented size="sm" value={cfg.channel} onChange={(v) => setCfg({ ...cfg, channel: v })} options={[{ value: 'smtp', label: 'SMTP (ไม่ต้องขอสิทธิ์ Azure)' }, { value: 'outlook', label: 'Outlook (Microsoft 365)' }]} />
        </div>
        {cfg.channel === 'smtp' ? (
          <div className="space-y-2">
            <div className="grid gap-2 md:grid-cols-3">
              <Field label="เซิร์ฟเวอร์ SMTP"><TextInput value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} placeholder="smtp.office365.com" /></Field>
              <Field label="พอร์ต"><TextInput type="number" value={String(smtp.port)} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) || 587 })} /></Field>
              <Field label="อีเมลผู้ส่ง (From)"><TextInput value={smtp.from} onChange={(e) => setSmtp({ ...smtp, from: e.target.value })} placeholder="dochub@company.com" /></Field>
              <Field label="ชื่อบัญชี" hint="เว้นว่างถ้าเซิร์ฟเวอร์ไม่ต้องล็อกอิน"><TextInput value={smtp.user} autoComplete="off" onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} /></Field>
              <Field label="รหัสผ่าน" hint={smtp.hasPassword ? 'บันทึกไว้แล้ว — เว้นว่างถ้าไม่เปลี่ยน' : undefined}><TextInput type="password" value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} /></Field>
            </div>
            <div className="flex flex-wrap gap-4">
              <Toggle checked={smtp.secure} onChange={(v) => setSmtp({ ...smtp, secure: v })} label="เข้ารหัสทั้งการเชื่อมต่อ (พอร์ต 465)" />
              <Toggle checked={smtp.allowSelfSigned} onChange={(v) => setSmtp({ ...smtp, allowSelfSigned: v })} label="ไม่ตรวจใบรับรองเซิร์ฟเวอร์ (เซิร์ฟเวอร์ภายใน)" />
            </div>
            <p className="text-xs text-muted">พอร์ต 587 ระบบเปิดการเข้ารหัส (STARTTLS) ให้เองถ้าเซิร์ฟเวอร์รองรับ · รหัสผ่านเก็บเข้ารหัสบน server ไม่แสดงกลับ</p>
          </div>
        ) : (
          <div>
            {outlook?.connected
              ? <p>ส่งจาก Outlook: <b>{outlook.account ?? outlook.name ?? 'เชื่อมแล้ว'}</b> {outlook.name && outlook.account ? <span className="text-muted">({outlook.name})</span> : null}</p>
              : <p className="text-amber-600">{outlook?.configured ? 'ยังไม่ได้เชื่อม Outlook สำหรับส่งอีเมล' : 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า Microsoft (MS_CLIENT_ID / MS_CLIENT_SECRET) — ดู docs/PLAN_MAIL.md'}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void connect()} loading={busy === 'connect'} disabled={!outlook?.configured}>{outlook?.connected ? 'เชื่อมบัญชีอื่น' : 'เชื่อม Outlook'}</Button>
              {outlook?.connected && <Button size="sm" variant="secondary" onClick={() => void disconnect()} loading={busy === 'off'}>ยกเลิกการเชื่อม</Button>}
            </div>
          </div>
        )}
        <Button size="sm" variant="secondary" onClick={() => void test()} loading={busy === 'test'} disabled={cfg.channel === 'outlook' ? !outlook?.connected : !(smtp.host && smtp.from)}>บันทึกและส่งอีเมลทดสอบถึงอีเมลผู้ส่ง</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="ถึง (To)" hint="หนึ่งอีเมลต่อบรรทัด หรือคั่นด้วย , ;"><TextArea rows={3} value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" /></Field>
        <Field label="สำเนา (CC)"><TextArea rows={3} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="name@company.com" /></Field>
      </div>
      <Field label="หัวข้ออีเมล" hint="ใส่ {date} วันที่ผลิต · {count} จำนวน Doc No ที่ตรง · {file} ชื่อไฟล์แผน"><TextInput value={cfg.subject} maxLength={200} onChange={(e) => setCfg({ ...cfg, subject: e.target.value })} /></Field>
      <Field label="ข้อความนำ" hint="ขึ้นก่อนตาราง ใช้ {date} {count} {file} ได้เหมือนกัน"><TextArea rows={3} value={cfg.intro} maxLength={2000} onChange={(e) => setCfg({ ...cfg, intro: e.target.value })} /></Field>
      {!!bad.length && <p className="text-xs text-danger">อีเมลไม่ถูกต้อง: {bad.join(', ')}</p>}
      {cfg.enabled && !toList(to).length && <p className="text-xs text-amber-600">เปิดไว้แต่ยังไม่มีผู้รับ — จะไม่ส่ง</p>}
      <Button size="sm" onClick={() => void save()} loading={busy === 'save'} disabled={!!bad.length}>บันทึกตั้งค่าอีเมล</Button>
    </div>
  );
}
