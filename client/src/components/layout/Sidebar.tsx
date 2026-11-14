import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { LogOut, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Badge, canSee, navLabel, orderedNav } from '@/lib/pages';
import { useAppInfo } from '@/store/appInfo';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';

/** compact: icons only (labels as tooltips, badges as dots) */
function SidebarBody({ onNavigate, scope, compact }: { onNavigate?: () => void; scope: string; compact?: boolean }) {
  const t = useT();
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const appName = useAppInfo((s) => s.name);
  const counts: Record<Badge, number> = {
    requests: useData((s) => s.pendingReviews + s.pendingAccounts + s.pendingTagRequests),
    news: useData((s) => s.newsUnread),
  };
  const { pathname } = useLocation();
  // pages the role sees: set by a root on จัดการสิทธิ์ (lib/pages.tsx)
  const items = orderedNav(user.pageOrder).filter((n) => !n.notInNav && canSee(user, n.key)).map((n) => ({ ...n, name: navLabel(user, n) ?? t(n.label), active: n.match?.(pathname), badge: n.badge ? counts[n.badge] : 0 }));

  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className={cn('flex items-center gap-3 pb-4 pt-6', compact ? 'justify-center px-0' : 'px-6')} title={appName}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/95 text-primary shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9M10 4v16" /></svg>
        </span>
        {!compact && <span className="truncate text-[17px] font-semibold tracking-tight">{appName}</span>}
      </Link>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-6">
        <nav className="space-y-1.5">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'} onClick={onNavigate} title={compact ? it.name : undefined} aria-label={compact ? it.name : undefined}
              className={({ isActive }) => cn('nav-link', compact && '!gap-0 !px-0 justify-center', (it.active ?? isActive) && 'active')}>
              {({ isActive }) => (
                <>
                  {(it.active ?? isActive) && (scope === 'desktop'
                    ? <motion.span layoutId="nav-pill-desktop" className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />
                    // phone drawer: a plain pill. A sliding layoutId pill inside the closing drawer kept the drawer's exit from ever
                    // finishing, leaving its invisible backdrop over the page: every tap hit it and the app looked frozen.
                    : <span className="nav-pill" />)}
                  {compact
                    ? <span className="relative">{it.icon}{!!it.badge && <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] font-semibold text-white">{it.badge}</span>}</span>
                    : <>{it.icon}<span className="flex-1">{it.name}</span>
                      {!!it.badge && <span className="mr-2 grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{it.badge}</span>}</>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t border-white/10 p-3">
        <button onClick={() => void logout()} className={cn('side-item w-full !h-10', compact && 'justify-center')} title="ออกจากระบบ" aria-label="ออกจากระบบ">
          <LogOut className="h-4 w-4" />{!compact && ' ออกจากระบบ'}
        </button>
      </div>
    </div>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  // once closing starts, let taps through even if the exit animation is cut short (app switched away, slow phone)
  const present = useIsPresent();
  return (
    <motion.div className="fixed inset-0 z-[850] lg:hidden" style={{ pointerEvents: present ? 'auto' : 'none' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <motion.aside className="ds-sidebar relative h-full max-w-[85vw]" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
        <button onClick={onClose} className="absolute right-3 top-6 rounded-lg p-1.5 opacity-80 hover:bg-white/10" aria-label="ปิดเมนู"><X className="h-5 w-5" /></button>
        <SidebarBody scope="mobile" onNavigate={onClose} />
      </motion.aside>
    </motion.div>
  );
}

export function Sidebar() {
  const t = useT();
  const mobile = useUi((s) => s.mobileNav);
  const setMobile = useUi((s) => s.setMobileNav);
  const mode = useUi((s) => s.navMode);
  return (
    <>
      {mode !== 'hidden' && (
        <aside className="ds-sidebar hidden h-full shrink-0 lg:block print:!hidden" style={mode === 'icons' ? { width: 76 } : undefined}>
          <SidebarBody scope="desktop" compact={mode === 'icons'} />
        </aside>
      )}
      <AnimatePresence>{mobile && <MobileDrawer onClose={() => setMobile(false)} />}</AnimatePresence>
    </>
  );
}
