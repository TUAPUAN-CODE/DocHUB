import { ReactNode, useState } from 'react';
import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { colorFor, initials, PERM_LABEL, ROLE_LABEL, SWATCHES } from '@/lib/format';

export function Avatar({ name, src, size = 32, className, ring }: { name?: string | null; src?: string | null; size?: number; className?: string; ring?: boolean }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (src && !broken)
    return <img src={src} alt={name ?? ''} onError={() => setBroken(true)} style={style} className={cn('shrink-0 rounded-full object-cover', ring && 'ring-2 ring-surface', className)} />;
  return (
    <span style={{ ...style, background: colorFor(name ?? '?') }} title={name ?? undefined}
      className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white', ring && 'ring-2 ring-surface', className)}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ users, max = 4, size = 28 }: { users: { id: string; displayName: string; avatarUrl?: string | null }[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u) => <Avatar key={u.id} name={u.displayName} src={u.avatarUrl} size={size} ring />)}
      {users.length > max && (
        <span style={{ width: size, height: size }} className="grid place-items-center rounded-full bg-ink/10 text-[11px] font-semibold ring-2 ring-surface">
          +{users.length - max}
        </span>
      )}
    </div>
  );
}

const PERM_STYLE: Record<string, string> = {
  manage: 'bg-primary/10 text-primary', write: 'bg-success/10 text-success', read: 'bg-ink/5 text-ink/70', none: 'bg-danger/10 text-danger',
};
export const PermBadge = ({ perm }: { perm: string }) => (
  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', PERM_STYLE[perm] ?? PERM_STYLE.read)}>{PERM_LABEL[perm] ?? perm}</span>
);
const ROLE_STYLE: Record<string, string> = { admin: 'bg-danger/10 text-danger', master: 'bg-primary/10 text-primary', user: 'bg-success/10 text-success', viewer: 'bg-ink/5 text-ink/60' };
export const RoleBadge = ({ role }: { role: string }) => (
  <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', ROLE_STYLE[role])}>{ROLE_LABEL[role] ?? role}</span>
);

export function StatusDot({ tone, label }: { tone: 'green' | 'amber' | 'red' | 'gray' | 'blue'; label: ReactNode }) {
  const c = { green: 'bg-success', amber: 'bg-warning', red: 'bg-danger', gray: 'bg-muted', blue: 'bg-primary' }[tone];
  return <span className="inline-flex items-center gap-2 text-[13px]"><span className={cn('h-2 w-2 rounded-full', c)} />{label}</span>;
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton', className)} />;

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary [&>svg]:h-7 [&>svg]:w-7">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StarButton({ active, onToggle, size = 18, className }: { active: boolean; onToggle: () => void; size?: number; className?: string }) {
  return (
    <motion.button type="button" whileTap={{ scale: 0.8 }} onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggle(); }}
      aria-label={active ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'} title={active ? 'เอาออกจากรายการโปรด' : 'เพิ่มในรายการโปรด'}
      className={cn('grid place-items-center rounded-lg p-1 transition-colors', active ? 'text-warning' : 'text-muted/70 hover:text-warning', className)}>
      <motion.span key={String(active)} initial={active ? { scale: 0.4, rotate: -40 } : false} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}>
        <Star style={{ width: size, height: size }} fill={active ? 'currentColor' : 'none'} />
      </motion.span>
    </motion.button>
  );
}

export function ColorInput({ value, onChange, swatches = SWATCHES, allowEmpty }: { value: string | null | undefined; onChange: (v: string | null) => void; swatches?: string[]; allowEmpty?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowEmpty && (
        <button type="button" onClick={() => onChange(null)} title="ไม่มีสี"
          className={cn('h-6 w-6 rounded-full border border-dashed border-ink/30 bg-[linear-gradient(135deg,transparent_45%,rgb(var(--c-danger))_45%,rgb(var(--c-danger))_55%,transparent_55%)]', !value && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')} />
      )}
      {swatches.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} style={{ background: c }} title={c}
          className={cn('h-6 w-6 rounded-full transition-transform hover:scale-110', value?.toLowerCase() === c.toLowerCase() && 'ring-2 ring-primary ring-offset-2 ring-offset-surface')} />
      ))}
      <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-line bg-[conic-gradient(red,yellow,lime,aqua,blue,magenta,red)]" title="เลือกสีเอง">
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#1552f0'} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block h-5 w-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary', className)} />;
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary [&>svg]:h-5 [&>svg]:w-5">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-[22px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-muted">
      {/* phones: "1–45 / 45" and arrows, so the pager fits on one line */}
      <span className="whitespace-nowrap"><span className="hidden sm:inline">แสดง </span>{total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)}<span className="hidden sm:inline"> จาก </span><span className="sm:hidden"> / </span>{total.toLocaleString()}<span className="hidden sm:inline"> รายการ</span></span>
      <div className="flex items-center gap-1">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="หน้าก่อนหน้า" className="h-8 rounded-lg px-2 hover:bg-ink/5 disabled:opacity-40 sm:px-2.5"><span className="sm:hidden">‹</span><span className="hidden sm:inline">ก่อนหน้า</span></button>
        {nums.map((n, i) => n === '…' ? <span key={i} className="px-1">…</span> : (
          <button key={i} onClick={() => onPage(n)} className={cn('h-8 min-w-8 rounded-lg px-2 font-medium', n === page ? 'bg-primary text-white' : 'hover:bg-ink/5 text-ink')}>{n}</button>
        ))}
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="หน้าถัดไป" className="h-8 rounded-lg px-2 hover:bg-ink/5 disabled:opacity-40 sm:px-2.5"><span className="sm:hidden">›</span><span className="hidden sm:inline">ถัดไป</span></button>
      </div>
    </div>
  );
}
