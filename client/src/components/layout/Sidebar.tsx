import { isBasicRole } from '@/types';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Cpu, FileSpreadsheet, Database, FolderOpen, GitFork, History, Home, KeyRound, LayoutDashboard, LogOut, PanelLeftClose, PanelLeftOpen, Settings, Trash2, Users, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { useUi } from '@/store/ui';
import { useT } from '@/i18n';

function SidebarBody({ onNavigate, scope, collapsed = false }: { onNavigate?: () => void; scope: string; collapsed?: boolean }) {
  const t = useT();
  const setCollapsed = useUi((s) => s.setSidebarCollapsed);
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const pending = useData((s) => s.pendingReviews);
  const { pathname } = useLocation();
  const inFiles = pathname.startsWith('/browse') || pathname.startsWith('/folders') || pathname.startsWith('/files');

  const items = [
    { to: '/', label: t('หน้าแรก'), icon: <Home className="h-[18px] w-[18px]" />, active: pathname === '/' },
    { to: '/browse', label: t('ไฟล์ทั้งหมด'), icon: <FolderOpen className="h-[18px] w-[18px]" />, active: inFiles },
    { to: '/access-requests', label: t('คำขอสิทธิ์'), icon: <KeyRound className="h-[18px] w-[18px]" />, badge: pending },
    ...(!isBasicRole(user.role) ? [{ to: '/audit', label: t('ประวัติการแก้ไข'), icon: <History className="h-[18px] w-[18px]" /> }] : []),
    ...(user.role === 'admin' ? [{ to: '/users', label: t('จัดการผู้ใช้'), icon: <Users className="h-[18px] w-[18px]" /> }] : []),
    { to: '/trash', label: t('ถังขยะ'), icon: <Trash2 className="h-[18px] w-[18px]" /> },
    ...(!isBasicRole(user.role) ? [{ to: '/devices', label: t('อุปกรณ์ (RFID/IoT)'), icon: <Cpu className="h-[18px] w-[18px]" /> }] : []),
    ...(!isBasicRole(user.role) ? [{ to: '/connectors', label: t('ดึงข้อมูลจากลิงก์/API'), icon: <Database className="h-[18px] w-[18px]" /> }] : []),
    ...(!isBasicRole(user.role) ? [{ to: '/inkcode/plan', label: t('นำเข้าแผนผลิต'), icon: <FileSpreadsheet className="h-[18px] w-[18px]" /> }] : []),
    { to: '/approvals', label: t('อนุมัติเอกสาร'), icon: <CheckCircle2 className="h-[18px] w-[18px]" /> },
    { to: '/traceback', label: t('ย้อนรอย (Traceback)'), icon: <GitFork className="h-[18px] w-[18px]" /> },
    { to: '/dashboards', label: t('แดชบอร์ด'), icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
    { to: '/settings', label: t('ตั้งค่า'), icon: <Settings className="h-[18px] w-[18px]" /> },
  ];

  return (
    <div className={cn('flex h-full flex-col', collapsed && 'sb-collapsed')}>
      <Link to="/" onClick={onNavigate} title={collapsed ? 'DataSheet Pro' : undefined} className={cn('flex items-center gap-3 pb-4 pt-6', collapsed ? 'justify-center px-0' : 'px-6')}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/95 text-primary shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9M10 4v16" /></svg>
        </span>
        {!collapsed && <span className="text-[17px] font-semibold tracking-tight">DataSheet Pro</span>}
      </Link>
      {scope === 'desktop' && (
        <button onClick={() => setCollapsed(!collapsed)} title={collapsed ? t('ขยายเมนู') : t('ย่อเมนูให้เหลือแต่ไอคอน')} aria-label={collapsed ? t('ขยายเมนู') : t('ย่อเมนูให้เหลือแต่ไอคอน')}
          className={cn('mb-1 grid h-8 place-items-center rounded-lg opacity-80 hover:bg-white/10 hover:opacity-100', collapsed ? 'mx-auto w-10' : 'ml-auto mr-4 w-8')}>
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
        </button>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-6">
        <nav className="space-y-1.5">
          {items.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.to === '/'} onClick={onNavigate} title={collapsed ? it.label : undefined} aria-label={it.label}
              className={({ isActive }) => cn('nav-link', (it.active ?? isActive) && 'active')}>
              {({ isActive }) => (
                <>
                  {(it.active ?? isActive) && <motion.span layoutId={`nav-pill-${scope}`} className="nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 38 }} />}
                  {it.icon}
                  {!collapsed && <span className="flex-1">{it.label}</span>}
                  {!!it.badge && collapsed && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-warning" />}
                  {!!it.badge && !collapsed && <span className="mr-2 grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{it.badge}</span>}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="border-t border-white/10 p-3">
        <button onClick={() => void logout()} title={collapsed ? t('ออกจากระบบ') : undefined} aria-label={t('ออกจากระบบ')} className={cn('side-item w-full !h-10', collapsed && 'justify-center !px-0')}>
          <LogOut className="h-4 w-4" /> {!collapsed && t('ออกจากระบบ')}
        </button>
      </div>
    </div>
  );
}

export function Sidebar() {
  const t = useT();
  const mobile = useUi((s) => s.mobileNav);
  const setMobile = useUi((s) => s.setMobileNav);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  return (
    <>
      <aside className="ds-sidebar hidden h-full shrink-0 transition-[width] duration-200 lg:block" style={collapsed ? { width: 72 } : undefined}><SidebarBody scope="desktop" collapsed={collapsed} /></aside>
      <AnimatePresence>
        {mobile && (
          <motion.div className="fixed inset-0 z-[850] lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobile(false)} />
            <motion.aside className="ds-sidebar relative h-full max-w-[85vw]" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}>
              <button onClick={() => setMobile(false)} className="absolute right-3 top-6 rounded-lg p-1.5 opacity-80 hover:bg-white/10" aria-label={t('ปิดเมนู')}><X className="h-5 w-5" /></button>
              <SidebarBody scope="mobile" onNavigate={() => setMobile(false)} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
