import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Info, Lock, RotateCcw, Save, ShieldCheck, Sparkles } from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { Segmented, TextInput } from '@/components/ui/Inputs';
import { EmptyState, PageHeader, RoleBadge, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { NAV, orderedNav } from '@/lib/pages';
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
  if (p.lockedFor?.includes(role)) return `${ROLE_LABEL[role]} ต้องเห็นเสมอ (กันล็อกตัวเองออก)`;
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

/** Admin / root: which pages of the left bar (and the AI button) each role sees, and the names of the left-bar items */
export default function PermissionsPage() {
  const { data, loading, reload } = useLoad(() => pageAccessApi.get(), []);
  const [allowed, setAllowed] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => { if (data) { setAllowed(data.allowed); setLabels(data.labels ?? {}); setOrder(orderedNav(data.order).map((n) => n.key)); } }, [data]);
  const orderDirty = !!data && order.join() !== orderedNav(data.order).map((n) => n.key).join();
  /** moves a left-bar item one place up / down among the items that are in the left bar */
  const move = (key: string, dir: -1 | 1) => setOrder((o) => {
    const navKeys = o.filter((k) => navPages.some((p) => p.key === k));
    const i = navKeys.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= navKeys.length) return o;
    [navKeys[i], navKeys[j]] = [navKeys[j], navKeys[i]];
    const rest = o.filter((k) => !navKeys.includes(k));
    return [...navKeys, ...rest];
  });
  const mover = (p: PageInfo, idx: number, count: number) => (
    <span className="inline-flex shrink-0 flex-col">
      <button type="button" aria-label={`เลื่อน ${p.label} ขึ้น`} disabled={idx === 0} onClick={() => move(p.key, -1)} className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-primary disabled:opacity-25"><ArrowUp className="h-3.5 w-3.5" /></button>
      <button type="button" aria-label={`เลื่อน ${p.label} ลง`} disabled={idx === count - 1} onClick={() => move(p.key, 1)} className="rounded p-0.5 text-muted hover:bg-ink/5 hover:text-primary disabled:opacity-25"><ArrowDown className="h-3.5 w-3.5" /></button>
    </span>
  );
  const labelsDirty = !!data && JSON.stringify(Object.entries(labels).filter(([, v]) => v.trim()).sort()) !== JSON.stringify(Object.entries(data.labels ?? {}).sort());
  const nameField = (p: PageInfo) => p.kind === 'page' && !p.notInNav
    ? <TextInput value={labels[p.key] ?? ''} placeholder={`ชื่อในเมนู (เดิม: ${p.label})`} maxLength={60} aria-label={`ชื่อเมนู ${p.label}`}
        onChange={(e) => setLabels((l) => ({ ...l, [p.key]: e.target.value }))} className="!h-8 mt-1 max-w-[260px] text-xs" />
    : null;

  const has = (r: Role, key: string) => r === 'root' || (allowed[r] ?? []).includes(key);
  const toggle = (r: Role, key: string) =>
    setAllowed((a) => ({ ...a, [r]: (a[r] ?? []).includes(key) ? a[r].filter((k) => k !== key) : [...(a[r] ?? []), key] }));
  const dirty = useMemo(() => !!data && data.roles.some((r) => [...(allowed[r] ?? [])].sort().join() !== [...data.allowed[r]].sort().join()), [allowed, data]) || labelsDirty || orderDirty;

  const save = async () => {
    setBusy(true);
    try {
      const r = await pageAccessApi.save(allowed, Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)), order);
      setAllowed(r.allowed);
      toast.success('บันทึกสิทธิ์แล้ว', 'เมนูของผู้ใช้ที่เปิดอยู่จะเปลี่ยนตามทันที');
      void reload(true);
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const resetDefaults = async () => {
    if (!data) return;
    if (!(await confirmDialog({ title: 'คืนค่าเริ่มต้น?', message: 'ตั้งทุกบทบาทกลับเป็นค่าเริ่มต้นของระบบ (ยังไม่บันทึกจนกว่าจะกด “บันทึก”)', confirmText: 'คืนค่าเริ่มต้น' }))) return;
    setAllowed(Object.fromEntries(data.roles.map((r) => [r, data.pages.filter((p) => p.always || (!p.rootOnly && p.defaults.includes(r) && !lockReason(p, r))).map((p) => p.key)])));
    setOrder(NAV.map((n) => n.key));
  };

  const pages = data?.pages ?? [];
  const at = new Map(order.map((k, i) => [k, i]));
  const navPages = pages.filter((p) => p.kind === 'page' && !p.notInNav).sort((a, b) => (at.get(a.key) ?? 999) - (at.get(b.key) ?? 999));
  const groups: { title: string; note?: string; items: PageInfo[]; ordered?: boolean }[] = [
    { title: 'เมนูด้านซ้าย (ลูกศร = เลื่อนลำดับ)', items: navPages, ordered: true },
    { title: 'เปิดจากหน้า Application (ไม่อยู่ในแถบซ้าย)', note: 'ติ๊ก = role นั้นเห็นแอปนี้ในหน้า Application และเปิดหน้านั้นได้', items: pages.filter((p) => p.kind === 'page' && p.notInNav) },
    { title: 'ฟังก์ชัน', items: pages.filter((p) => p.kind === 'feature') },
  ];
  const cols: Role[] = ['viewer', 'user', 'master', 'admin', 'root'];

  return (
    <Page>
      <PageHeader icon={<ShieldCheck />} title="จัดการสิทธิ์" subtitle="กำหนดว่าแต่ละบทบาทเห็นหน้าไหนในเมนูด้านซ้าย และใช้ปุ่ม AI ได้หรือไม่ · เปลี่ยนชื่อเมนูได้ (Admin / Root)"
        actions={<>
          <Button variant="secondary" icon={<RotateCcw className="h-4 w-4" />} onClick={() => void resetDefaults()} disabled={!data}>คืนค่าเริ่มต้น</Button>
          <Button icon={<Save className="h-4 w-4" />} onClick={() => void save()} loading={busy} disabled={!dirty}>บันทึก</Button>
        </>} />

      <div className="mb-4 flex items-start gap-2 rounded-theme bg-primary/[.06] px-4 py-3 text-sm text-ink/80">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          ติ๊ก = บทบาทนั้นเห็นเมนู / เปิดหน้านั้นได้ · ช่องชื่อใต้แต่ละเมนู = เปลี่ยนชื่อที่แสดงในแถบซ้าย (ว่าง = ชื่อเดิม) · ช่องที่มีกุญแจเปลี่ยนไม่ได้ (เช่น จัดการผู้ใช้ต้องเป็น Admin ขึ้นไป) ·
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
                    <tr><td colSpan={cols.length + 1} className="bg-ink/[.02] px-4 py-2 text-xs font-semibold text-muted">{g.title}{g.note && <span className="ml-2 font-normal">· {g.note}</span>}</td></tr>
                    {g.items.map((p, idx) => (
                      <tr key={p.key} className="hover:bg-ink/[.02]">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5 font-medium">{g.ordered && mover(p, idx, g.items.length)}<span className="text-primary">{iconOf(p.key)}</span>{p.label}</div>
                          {p.hint && <p className="ml-7 mt-0.5 text-xs text-muted">{p.hint}</p>}
                          {nameField(p) && <div className="ml-7">{nameField(p)}</div>}
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
                  <p className="bg-ink/[.02] px-4 py-2 text-xs font-semibold text-muted">{g.title}{g.note && <span className="block font-normal">{g.note}</span>}</p>
                  {g.items.map((p, idx) => {
                    const locked = lockReason(p, role);
                    return (
                      <div key={p.key} className="flex items-center gap-3 px-4 py-2.5">
                        {g.ordered && mover(p, idx, g.items.length)}
                        <span className="text-primary">{iconOf(p.key)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{p.label}</p>
                          {(locked || p.hint) && <p className="text-xs text-muted">{locked ?? p.hint}</p>}
                          {nameField(p)}
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
                  <Button size="sm" variant="secondary" onClick={() => { if (data) { setAllowed(data.allowed); setLabels(data.labels ?? {}); setOrder(orderedNav(data.order).map((n) => n.key)); } }}>ยกเลิก</Button>
                  <Button size="sm" icon={<Save className="h-3.5 w-3.5" />} onClick={() => void save()} loading={busy}>บันทึก</Button>
                </div>
              </div>
            )}
          </>
        )}
    </Page>
  );
}
