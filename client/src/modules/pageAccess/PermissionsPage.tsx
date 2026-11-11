import { useEffect, useMemo, useState } from 'react';
import { Check, Info, Lock, RotateCcw, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Inputs';
import { EmptyState, PageHeader, RoleBadge, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { NAV } from '@/lib/pages';
import { ROLE_LABEL } from '@/lib/format';
import { confirmDialog, toast } from '@/store/ui';
import type { Role } from '@/types';
import { PageInfo, pageAccessApi } from './api';

const ROLE_ORDER: Role[] = ['root', 'admin', 'master', 'user', 'viewer'];
const iconOf = (key: string) => NAV.find((n) => n.key === key)?.icon ?? <Sparkles className="h-[18px] w-[18px]" />;

/** why a box cannot be changed */
function lockReason(p: PageInfo, role: Role) {
  if (role === 'root') return 'Root เห็นทุกหน้าเสมอ';
  if (p.rootOnly) return 'เฉพาะ Root';
  if (p.always) return 'ทุกบทบาทต้องเห็น';
  if (p.floor && ROLE_ORDER.indexOf(role) > ROLE_ORDER.indexOf(p.floor)) return `ต้องเป็น ${ROLE_LABEL[p.floor]} ขึ้นไป`;
  return null;
}

function Box({ on, locked, onToggle, label }: { on: boolean; locked: string | null; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} disabled={!!locked} title={locked ?? undefined} onClick={onToggle}
      className={cn('mx-auto grid h-7 w-7 place-items-center rounded-lg border transition-colors',
        on ? 'border-primary bg-primary text-white' : 'border-ink/20 bg-surface text-transparent hover:border-primary/60',
        locked && (on ? '!border-ink/20 !bg-ink/15 !text-ink/60' : 'opacity-40'), locked ? 'cursor-not-allowed' : 'cursor-pointer')}>
      {locked && !on ? <Lock className="h-3 w-3 text-ink/50" /> : <Check className="h-4 w-4" strokeWidth={3} />}
    </button>
  );
}

/** Root only: which pages of the left bar (and the AI button) each role sees */
export default function PermissionsPage() {
  const { data, loading, reload } = useLoad(() => pageAccessApi.get(), []);
  const [allowed, setAllowed] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('user');
  useEffect(() => { if (data) setAllowed(data.allowed); }, [data]);

  const has = (r: Role, key: string) => r === 'root' || (allowed[r] ?? []).includes(key);
  const toggle = (r: Role, key: string) =>
    setAllowed((a) => ({ ...a, [r]: (a[r] ?? []).includes(key) ? a[r].filter((k) => k !== key) : [...(a[r] ?? []), key] }));
  const dirty = useMemo(() => !!data && data.roles.some((r) => [...(allowed[r] ?? [])].sort().join() !== [...data.allowed[r]].sort().join()), [allowed, data]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await pageAccessApi.save(allowed);
      setAllowed(r.allowed);
      toast.success('บันทึกสิทธิ์แล้ว', 'เมนูของผู้ใช้ที่เปิดอยู่จะเปลี่ยนตามทันที');
      void reload(true);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const resetDefaults = async () => {
    if (!data) return;
    if (!(await confirmDialog({ title: 'คืนค่าเริ่มต้น?', message: 'ตั้งทุกบทบาทกลับเป็นค่าเริ่มต้นของระบบ (ยังไม่บันทึกจนกว่าจะกด “บันทึก”)', confirmText: 'คืนค่าเริ่มต้น' }))) return;
    setAllowed(Object.fromEntries(data.roles.map((r) => [r, data.pages.filter((p) => p.always || (!p.rootOnly && p.defaults.includes(r) && !lockReason(p, r))).map((p) => p.key)])));
  };

  const pages = data?.pages ?? [];
  const groups: { title: string; items: PageInfo[] }[] = [
    { title: 'หน้าในเมนูด้านซ้าย', items: pages.filter((p) => p.kind === 'page') },
    { title: 'ฟังก์ชัน', items: pages.filter((p) => p.kind === 'feature') },
  ];
  const cols: Role[] = ['viewer', 'user', 'master', 'admin', 'root'];

  return (
    <Page>
      <PageHeader icon={<ShieldCheck />} title="จัดการสิทธิ์" subtitle="กำหนดว่าแต่ละบทบาทเห็นหน้าไหนในเมนูด้านซ้าย และใช้ปุ่ม AI ได้หรือไม่ (เฉพาะ Root)"
        actions={<>
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void resetDefaults()} disabled={!data}>คืนค่าเริ่มต้น</Button>
          <Button icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={busy} disabled={!dirty}>บันทึก</Button>
        </>} />

      <div className="mb-4 flex items-start gap-2 rounded-theme bg-primary/[.06] px-4 py-3 text-sm text-ink/80">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          ติ๊ก = บทบาทนั้นเห็นเมนู / เปิดหน้านั้นได้ · ช่องที่มีกุญแจเปลี่ยนไม่ได้ (เช่น จัดการผู้ใช้ต้องเป็น Admin ขึ้นไป) ·
          การซ่อนเมนูไม่ได้ลบสิทธิ์ไฟล์ — ไฟล์ที่ถูกแชร์ยังเปิดจากลิงก์ได้
          {data?.updatedAt && <span className="text-muted"> · แก้ล่าสุด {fmtDateTime(data.updatedAt)}{data.updatedBy ? ` โดย ${data.updatedBy}` : ''}</span>}
        </div>
      </div>

      {loading && !data ? <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 rounded-theme" />)}</div>
        : !pages.length ? <div className="ds-card"><EmptyState icon={<ShieldCheck />} title="ไม่พบรายการหน้า" /></div>
        : (
          <>
            {/* desktop: whole matrix */}
            <div className="ds-card hidden overflow-hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-ink/[.03] text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">หน้า / ฟังก์ชัน</th>
                    {cols.map((r) => <th key={r} className="w-28 px-2 py-3 text-center font-medium"><RoleBadge role={r} /></th>)}
                  </tr>
                </thead>
                {groups.map((g) => (
                  <tbody key={g.title} className="divide-y divide-line">
                    <tr><td colSpan={cols.length + 1} className="bg-ink/[.02] px-4 py-2 text-xs font-semibold text-muted">{g.title}</td></tr>
                    {g.items.map((p) => (
                      <tr key={p.key} className="hover:bg-ink/[.02]">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5 font-medium"><span className="text-primary">{iconOf(p.key)}</span>{p.label}</div>
                          {p.hint && <p className="ml-7 mt-0.5 text-xs text-muted">{p.hint}</p>}
                        </td>
                        {cols.map((r) => (
                          <td key={r} className="px-2 py-2.5 text-center">
                            <Box on={has(r, p.key)} locked={lockReason(p, r)} onToggle={() => toggle(r, p.key)} label={`${p.label} — ${ROLE_LABEL[r]}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
            </div>

            {/* phone: one role at a time */}
            <div className="md:hidden">
              <div className="mb-3 overflow-x-auto">
                <Segmented value={role} onChange={setRole} size="sm" options={cols.map((r) => ({ value: r, label: ROLE_LABEL[r].replace(/ \(.*\)/, '') }))} />
              </div>
              {groups.map((g) => (
                <div key={g.title} className="ds-card mb-3 divide-y divide-line overflow-hidden">
                  <p className="bg-ink/[.02] px-4 py-2 text-xs font-semibold text-muted">{g.title}</p>
                  {g.items.map((p) => {
                    const locked = lockReason(p, role);
                    return (
                      <div key={p.key} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="text-primary">{iconOf(p.key)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{p.label}</p>
                          {(locked || p.hint) && <p className="text-xs text-muted">{locked ?? p.hint}</p>}
                        </div>
                        <Box on={has(role, p.key)} locked={locked} onToggle={() => toggle(role, p.key)} label={`${p.label} — ${ROLE_LABEL[role]}`} />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {dirty && (
              <div className="sticky bottom-3 mt-4 flex items-center justify-between gap-3 rounded-theme border border-warning/40 bg-surface px-4 py-3 shadow-lg">
                <span className="text-sm text-warning">มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => data && setAllowed(data.allowed)}>ยกเลิก</Button>
                  <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void save()} loading={busy}>บันทึก</Button>
                </div>
              </div>
            )}
          </>
        )}
    </Page>
  );
}
