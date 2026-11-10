import { NavLink } from 'react-router-dom';
import { Tags, UserPlus, Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useData } from '@/store/data';

/** Sub-pages of จัดการผู้ใช้ */
export function UsersTabs() {
  const pending = useData((s) => s.pendingAccounts);
  const tabs = [
    { to: '/users', label: 'ผู้ใช้งาน', icon: <Users className="h-4 w-4" />, end: true },
    { to: '/users/requests', label: 'คำขอสร้างบัญชี', icon: <UserPlus className="h-4 w-4" />, badge: pending },
    { to: '/users/tags', label: 'Tag', icon: <Tags className="h-4 w-4" /> },
  ];
  return (
    <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="เมนูจัดการผู้ใช้">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}
          className={({ isActive }) => cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            isActive ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>
          {t.icon}{t.label}
          {!!t.badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{t.badge}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
