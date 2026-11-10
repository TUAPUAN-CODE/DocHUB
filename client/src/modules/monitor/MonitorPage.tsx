import { ReactNode, useEffect } from 'react';
import { Activity, AlertTriangle, Cloud, Cpu, Info, Network, RefreshCw, Server } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { get } from '@/api/client';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { PageHeader, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';

interface Sums { cloudflare: number; lan: number; errors: number; slow: number; bytes: number }
interface Traffic {
  now: string;
  server: { startedAt: string; uptimeSec: number; memoryMb: number; load: number; cpus: number; sockets: number };
  today: Sums & { day: string }; month: Sums & { month: string };
  minutes: { t: string; cloudflare: number; lan: number; errors: number }[];
  peakMinute: { requests: number; at: string | null };
  hours: (Sums & { hour: string })[]; days: (Sums & { day: string })[]; months: (Sums & { month: string })[];
  topPaths: { path: string; requests: number }[];
  cloudflare: { configured: boolean; error?: string; days?: { date: string; requests: number; cachedRequests: number; bytes: number; threats: number; visitors: number | null }[] };
}

const CF = '#F38020';
const LAN = '#1552F0';
const n = (v: number) => v.toLocaleString('th-TH');
const mb = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(2)} GB` : `${(b / 1048576).toFixed(1)} MB`);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const uptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} วัน ${Math.floor((s % 86400) / 3600)} ชม.` : `${Math.floor(s / 3600)} ชม. ${Math.floor((s % 3600) / 60)} นาที`);

function Tile({ icon, label, value, sub, tone = 'primary' }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; tone?: 'primary' | 'cf' | 'danger' }) {
  const c = tone === 'cf' ? 'bg-[#F38020]/12 text-[#C2410C]' : tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-primary/10 text-primary';
  return (
    <div className="ds-card ds-card-pad">
      <div className="flex items-center gap-2 text-sm text-muted"><span className={`grid h-8 w-8 place-items-center rounded-lg [&>svg]:h-4 [&>svg]:w-4 ${c}`}>{icon}</span>{label}</div>
      <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** usage against a Cloudflare Workers Free limit — for comparison only: this system does not run on Workers */
function RefBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted">{n(used)} / {n(limit)} ({pct.toFixed(pct < 1 ? 2 : 0)}%)</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full" style={{ width: `${Math.max(pct, 0.5)}%`, background: pct > 80 ? '#DC2626' : pct > 50 ? '#F59E0B' : '#16A34A' }} /></div>
    </div>
  );
}

function Chart({ title, data, x, fmt }: { title: string; data: object[]; x: string; fmt: (v: string) => string }) {
  return (
    <div className="ds-card ds-card-pad">
      <p className="mb-3 font-semibold">{title}</p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -12, right: 4, top: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(100,116,139,.2)" />
            <XAxis dataKey={x} tickFormatter={fmt} tick={{ fontSize: 11 }} minTickGap={16} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip labelFormatter={(v) => fmt(String(v))} formatter={(v: number) => n(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="cloudflare" name="ผ่าน Cloudflare (อินเทอร์เน็ต)" stackId="a" fill={CF} />
            <Bar dataKey="lan" name="ในโรงงาน (LAN)" stackId="a" fill={LAN} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const { data, loading, reload } = useLoad(() => get<Traffic>('/monitor/traffic'), []);
  useEffect(() => { const t = setInterval(() => void reload(true), 30_000); return () => clearInterval(t); }, [reload]);
  const d = data;
  return (
    <Page>
      <PageHeader icon={<Activity />} title="Monitor" subtitle="จำนวนการใช้งาน (request) ผ่าน Cloudflare และในโรงงาน · อัปเดตเองทุก 30 วินาที"
        actions={<Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void reload(true)} loading={loading && !!data}>รีเฟรช</Button>} />
      {!d ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-theme" />)}</div> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile tone="cf" icon={<Cloud />} label="ผ่าน Cloudflare วันนี้" value={n(d.today.cloudflare)} sub={`เดือนนี้ ${n(d.month.cloudflare)} · ${mb(d.today.bytes)} วันนี้ (ทุกทาง)`} />
            <Tile icon={<Network />} label="ในโรงงาน (LAN) วันนี้" value={n(d.today.lan)} sub={`เดือนนี้ ${n(d.month.lan)}`} />
            <Tile icon={<Activity />} label="สูงสุดต่อนาที (1 ชม.ล่าสุด)" value={n(d.peakMinute.requests)} sub={d.peakMinute.at ? `เวลา ${hhmm(d.peakMinute.at)}` : 'ยังไม่มีข้อมูล'} />
            <Tile tone={d.today.errors ? 'danger' : 'primary'} icon={<AlertTriangle />} label="ผิดพลาด (5xx) วันนี้" value={n(d.today.errors)} sub={`ตอบช้าเกิน 3 วินาที ${n(d.today.slow)} ครั้ง`} />
          </div>

          <div className="ds-card ds-card-pad">
            <p className="flex items-center gap-2 font-semibold"><Info className="h-4 w-4 text-primary" />ข้อจำกัดของ Cloudflare ที่ใช้กับระบบนี้</p>
            <div className="mt-2 grid gap-4 text-sm leading-relaxed lg:grid-cols-2">
              <div className="space-y-1.5">
                <p>ระบบนี้เปิดสู่อินเทอร์เน็ตด้วย <b>Cloudflare Tunnel</b> (แผนฟรี) ซึ่ง<b>ไม่มีโควตาจำนวน request ต่อวัน/เดือน</b> จึงไม่มีตัวเลข “เหลืออีกเท่าไหร่”</p>
                <p>ตัวเลข 100,000 ครั้ง/วัน · 1,000 ครั้ง/นาที · CPU 10 ms · subrequest 50 เป็นข้อจำกัดของ <b>Cloudflare Workers</b> (บริการรันโค้ดบน Cloudflare) ซึ่งระบบนี้ไม่ได้ใช้</p>
                <p className="font-medium">ข้อจำกัดที่ใช้กับระบบนี้จริง:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  <li>อัปโหลดได้ไม่เกิน <b>100 MB</b> ต่อครั้ง (ระบบจำกัดรูปไว้ที่ 15 MB อยู่แล้ว)</li>
                  <li>server ต้องเริ่มตอบภายใน <b>100 วินาที</b> ไม่อย่างนั้นผู้ใช้จะเห็น Error 524</li>
                  <li>ใช้งานตามปกติ (fair use) — ห้ามใช้ส่งวิดีโอ/ไฟล์ใหญ่จำนวนมากเป็นหลัก</li>
                </ul>
              </div>
              <div className="space-y-3 rounded-xl bg-ink/[.03] p-3">
                <p className="text-xs text-muted">เทียบกับขีดจำกัดของ Workers แผนฟรี (เพื่อให้เห็นภาพเท่านั้น — ระบบนี้ไม่ถูกจำกัดตามนี้)</p>
                <RefBar label="วันนี้ (ผ่าน Cloudflare)" used={d.today.cloudflare} limit={100_000} />
                <RefBar label="สูงสุดต่อนาที" used={d.peakMinute.requests} limit={1_000} />
                <RefBar label="เดือนนี้ (ผ่าน Cloudflare)" used={d.month.cloudflare} limit={3_000_000} />
              </div>
            </div>
          </div>

          <Chart title="ต่อนาที — 60 นาทีล่าสุด" data={d.minutes} x="t" fmt={hhmm} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Chart title="ต่อชั่วโมง — 48 ชั่วโมงล่าสุด" data={d.hours} x="hour" fmt={(v) => `${dmy(new Date(v).toLocaleDateString('sv-SE'))} ${hhmm(v)}`} />
            <Chart title="ต่อวัน — 31 วันล่าสุด" data={d.days} x="day" fmt={dmy} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="ds-card ds-card-pad">
              <p className="mb-2 font-semibold">ต่อเดือน</p>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1.5">เดือน</th><th className="text-right">Cloudflare</th><th className="text-right">LAN</th><th className="text-right">ผิดพลาด</th><th className="text-right">ข้อมูล</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {[...d.months].reverse().map((m) => <tr key={m.month}><td className="py-1.5">{m.month.slice(5)}/{m.month.slice(0, 4)}</td><td className="text-right tabular-nums">{n(m.cloudflare)}</td><td className="text-right tabular-nums">{n(m.lan)}</td><td className="text-right tabular-nums">{n(m.errors)}</td><td className="text-right tabular-nums">{mb(m.bytes)}</td></tr>)}
                  {!d.months.length && <tr><td colSpan={5} className="py-3 text-center text-muted">ยังไม่มีข้อมูล (เริ่มนับตั้งแต่ติดตั้งหน้านี้)</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="ds-card ds-card-pad">
              <p className="mb-2 font-semibold">หน้าที่ถูกเรียกมากที่สุด <span className="text-xs font-normal text-muted">(ตั้งแต่ server เริ่มทำงาน)</span></p>
              <ul className="space-y-1 text-sm">{d.topPaths.map((p) => <li key={p.path} className="flex gap-2"><code className="min-w-0 flex-1 truncate text-xs">{p.path}</code><span className="tabular-nums text-muted">{n(p.requests)}</span></li>)}</ul>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <div className="ds-card ds-card-pad text-sm">
              <p className="mb-2 flex items-center gap-2 font-semibold"><Server className="h-4 w-4 text-primary" />เครื่อง server</p>
              <div className="grid grid-cols-2 gap-2">
                <span className="text-muted">ทำงานมาแล้ว</span><span>{uptime(d.server.uptimeSec)}</span>
                <span className="text-muted">หน่วยความจำ</span><span>{n(d.server.memoryMb)} MB</span>
                <span className="text-muted">ผู้ใช้เชื่อมต่ออยู่</span><span>{n(d.server.sockets)} หน้าจอ</span>
                <span className="text-muted">โหลด CPU</span><span className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5" />{d.server.load.toFixed(2)} / {d.server.cpus} core</span>
              </div>
            </div>
            <div className="ds-card ds-card-pad text-sm">
              <p className="mb-2 flex items-center gap-2 font-semibold"><Cloud className="h-4 w-4" style={{ color: CF }} />ตัวเลขจาก Cloudflare (30 วัน)</p>
              {!d.cloudflare.configured ? (
                <p className="leading-relaxed text-muted">ยังไม่ได้เชื่อม · ตัวเลขด้านบนนับโดย server เอง ถ้าต้องการตัวเลขจากฝั่ง Cloudflare ด้วย ให้สร้าง API Token สิทธิ์ <b>Zone · Analytics · Read</b> แล้วใส่ <code>CF_API_TOKEN</code> และ <code>CF_ZONE_ID</code> ใน server\.env (ดู docs/MONITOR.md)</p>
              ) : d.cloudflare.error ? <p className="text-danger">{d.cloudflare.error}</p> : (
                <table className="w-full">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-1">วันที่</th><th className="text-right">Requests</th><th className="text-right">Cache</th><th className="text-right">ภัยคุกคาม</th><th className="text-right">ข้อมูล</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {[...(d.cloudflare.days ?? [])].reverse().slice(0, 10).map((x) => <tr key={x.date}><td className="py-1">{dmy(x.date)}</td><td className="text-right tabular-nums">{n(x.requests)}</td><td className="text-right tabular-nums">{n(x.cachedRequests)}</td><td className="text-right tabular-nums">{n(x.threats)}</td><td className="text-right tabular-nums">{mb(x.bytes)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
