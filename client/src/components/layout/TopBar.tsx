import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAiPanel } from '@/modules/ai/useAiPanel';
import { canSee } from '@/lib/pages';
import { Bell, Sparkles, CheckCheck, ChevronDown, FileSpreadsheet, Folder, Lock, LogOut, Menu, Minus, PanelLeft, PanelLeftClose, PanelLeftDashed, Palette, Plus, Search, UserCircle, X, ZoomIn } from 'lucide-react';
import { searchApi, SearchResult } from '@/api/endpoints';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/cn';
import { relTime, ROLE_LABEL } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useNotifications } from '@/store/notifications';
import { useUi, ZOOM_STEPS } from '@/store/ui';
import { Avatar } from '../ui/misc';
import { MenuList, Popover } from '../ui/Popover';
import { useT } from '@/i18n';
import { LangSwitcher } from '@/i18n/LangSwitcher';

function GlobalSearch({ autoFocus, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<SearchResult | null>(null);
  const dq = useDebounce(q, 220);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); setOpen(true); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
  useEffect(() => {
    if (!dq.trim()) return setRes(null);
    let live = true;
    searchApi.search(dq, 6).then((r) => live && setRes(r)).catch(() => undefined);
    return () => { live = false; };
  }, [dq]);

  const go = (path: string) => { setOpen(false); setQ(''); input.current?.blur(); onDone?.(); nav(path); };
  const hasResults = !!res && (res.files.length > 0 || res.folders.length > 0);

  return (
    <div ref={box} className="w-full max-w-md">
      <div className="ds-input flex h-10 items-center gap-2 px-3">
        <Search className="h-4 w-4 text-muted" />
        <input ref={input} value={q} autoFocus={autoFocus} placeholder="ค้นหาไฟล์หรือโฟลเดอร์…" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`); if (e.key === 'Escape') { setOpen(false); input.current?.blur(); } }} />
        <kbd className="hidden rounded-md border border-line px-1.5 text-[10px] text-muted sm:block">Ctrl K</kbd>
      </div>
      <Popover open={open && !!q.trim()} onClose={() => setOpen(false)} anchor={box.current} width={box.current?.offsetWidth}>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {!hasResults && <p className="px-4 py-5 text-center text-sm text-muted">{res ? t('ไม่พบผลลัพธ์') : t('กำลังค้นหา…')}</p>}
          {res && res.folders.length > 0 && <p className="px-4 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('โฟลเดอร์')}</p>}
          {res?.folders.map((f) => (
            <button key={f.id} onClick={() => go(`/folders/${f.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink/5">
              <Folder className="h-4 w-4 shrink-0" style={{ color: f.color }} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{f.name}</span><span className="block truncate text-xs text-muted">{f.path}</span></span>
              {f.level === 0 && <Lock className="h-3.5 w-3.5 text-muted" />}
            </button>
          ))}
          {res && res.files.length > 0 && <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('ไฟล์')}</p>}
          {res?.files.map((f) => (
            <button key={f.id} onClick={() => go(`/files/${f.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-ink/5">
              <FileSpreadsheet className="h-4 w-4 shrink-0" style={{ color: f.color }} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{f.name}</span><span className="block truncate text-xs text-muted">{f.path}</span></span>
              {f.level === 0 && <Lock className="h-3.5 w-3.5 text-muted" />}
            </button>
          ))}
          {q.trim() && (
            <button onClick={() => go(`/search?q=${encodeURIComponent(q.trim())}`)} className="mt-1 w-full border-t border-line px-4 pt-2.5 text-left text-[13px] font-medium text-primary hover:underline">
              ดูผลการค้นหาทั้งหมดสำหรับ “{q.trim()}”
            </button>
          )}
        </div>
      </Popover>
    </div>
  );
}

function NotificationBell() {
  const t = useT();
  const nav = useNavigate();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { items, unread, markRead, markAll } = useNotifications();
  return (
    <>
      <button ref={btn} onClick={() => setOpen(!open)} aria-label="การแจ้งเตือน" className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink/75 hover:bg-ink/5 hover:text-ink">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white ring-2 ring-app">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-end" width={380}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <span className="font-semibold">{t('การแจ้งเตือน')}</span>
          <button onClick={() => void markAll()} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><CheckCheck className="h-3.5 w-3.5" /> {t('อ่านทั้งหมด')}</button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted">{t('ยังไม่มีการแจ้งเตือน')}</p>}
          {items.map((n) => (
            <button key={n.id} onClick={() => { void markRead(n.id); setOpen(false); if (n.link) nav(n.link); }}
              className={cn('flex w-full gap-3 border-b border-line/60 px-4 py-3 text-left hover:bg-ink/5', !n.isRead && 'bg-primary/[.04]')}>
              <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-primary')} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{n.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted">{n.message}</span>
                <span className="mt-1 block text-[11px] text-muted">{relTime(n.createdAt)}</span>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function UserMenu() {
  const t = useT();
  const nav = useNavigate();
  const user = useAuth((s) => s.user)!;
  const logout = useAuth((s) => s.logout);
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} onClick={() => setOpen(!open)} aria-label="เมนูผู้ใช้" className="flex shrink-0 items-center gap-2.5 rounded-full p-1 hover:bg-ink/5 md:pr-2.5">
        <Avatar name={user.displayName} src={user.avatarUrl} size={34} />
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[160px] truncate text-sm font-medium">{user.displayName}</span>
          <span className="block text-[11px] text-muted">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-muted md:block" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-end" width={230}>
        <MenuList onClose={() => setOpen(false)} items={[
          { label: t('โปรไฟล์ของฉัน'), icon: <UserCircle />, onClick: () => nav('/settings?tab=profile') },
          { label: t('ธีมและรูปแบบ'), icon: <Palette />, onClick: () => nav('/settings?tab=appearance') },
          { divider: true },
          { label: t('ออกจากระบบ'), icon: <LogOut />, danger: true, onClick: () => void logout() },
        ]} />
      </Popover>
    </>
  );
}

function AiButton() {
  const t = useT();
  const { open, toggle } = useAiPanel();
  return (
    <button onClick={toggle} className={cn('flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium hover:bg-ink/5 sm:px-3', open && 'bg-primary/10 text-primary')} aria-label="ผู้ช่วย AI" aria-pressed={open}>
      <Sparkles className="h-5 w-5" /><span className="hidden sm:inline">AI</span>
    </button>
  );
}

/** desktop: left bar full / icons only / hidden */
function NavModeButton() {
  const mode = useUi((s) => s.navMode);
  const setMode = useUi((s) => s.setNavMode);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const opts = [
    { v: 'full' as const, label: 'แสดงเมนูเต็ม', icon: <PanelLeft /> },
    { v: 'icons' as const, label: 'แสดงเฉพาะไอคอน', icon: <PanelLeftDashed /> },
    { v: 'hidden' as const, label: 'ซ่อนเมนู', icon: <PanelLeftClose /> },
  ];
  return (
    <>
      <button ref={btn} onClick={() => setOpen(true)} className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-ink/5 lg:grid" aria-label="ซ่อน / ย่อเมนูด้านซ้าย" title="ซ่อน / ย่อเมนูด้านซ้าย">
        {mode === 'hidden' ? <Menu className="h-5 w-5" /> : <PanelLeft className="h-5 w-5" />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-start" width={210}>
        <MenuList onClose={() => setOpen(false)} items={opts.map((o) => ({ label: `${o.label}${o.v === mode ? ' ✓' : ''}`, icon: o.icon, onClick: () => setMode(o.v) }))} />
      </Popover>
    </>
  );
}

/** zoom the whole app in / out (remembered in this browser) */
function ZoomButton() {
  const zoom = useUi((s) => s.uiZoom);
  const setZoom = useUi((s) => s.setUiZoom);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const i = ZOOM_STEPS.indexOf(zoom);
  const step = (d: number) => setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? ZOOM_STEPS.indexOf(100) : i) + d))]);
  return (
    <>
      <button ref={btn} onClick={() => setOpen(true)} className={cn('flex h-10 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm font-medium hover:bg-ink/5', zoom !== 100 && 'text-primary')} aria-label="ขนาดหน้าจอ (ซูม)" title="ขนาดหน้าจอ (ซูม)">
        <ZoomIn className="h-5 w-5" />{zoom !== 100 && <span className="hidden text-xs tabular-nums sm:inline">{zoom}%</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-end" width={230}>
        <div className="p-3">
          <p className="mb-2 text-xs font-medium text-muted">ขนาดหน้าจอ</p>
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} disabled={i === 0} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:border-primary disabled:opacity-40" aria-label="ย่อ (ซูมออก)"><Minus className="h-4 w-4" /></button>
            <span className="flex-1 text-center text-lg font-semibold tabular-nums">{zoom}%</span>
            <button onClick={() => step(1)} disabled={i === ZOOM_STEPS.length - 1} className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:border-primary disabled:opacity-40" aria-label="ขยาย (ซูมเข้า)"><Plus className="h-4 w-4" /></button>
          </div>
          <button onClick={() => setZoom(100)} disabled={zoom === 100} className="mt-2 w-full rounded-lg py-1.5 text-xs font-medium text-primary hover:bg-primary/5 disabled:opacity-40">กลับเป็น 100%</button>
          <p className="mt-1 text-[11px] text-muted">จำไว้ในเครื่องนี้ ไม่กระทบคนอื่น</p>
        </div>
      </Popover>
    </>
  );
}

export function TopBar() {
  // AI: admin + root by default; a root can give it to other roles (จัดการสิทธิ์)
  const aiAllowed = useAuth((s) => canSee(s.user, 'ai'));
  const setMobile = useUi((s) => s.setMobileNav);
  // phones: the search box is a button that opens a full-width field, so the icons on the right keep their room
  const [searching, setSearching] = useState(false);
  if (searching)
    return (
      <header className="ds-topbar print:hidden flex h-14 shrink-0 items-center gap-2 px-3 sm:h-16 sm:px-8">
        <div className="min-w-0 flex-1"><GlobalSearch autoFocus onDone={() => setSearching(false)} /></div>
        <button onClick={() => setSearching(false)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-ink/5" aria-label="ปิดการค้นหา"><X className="h-5 w-5" /></button>
      </header>
    );
  return (
    <header className="ds-topbar print:hidden flex h-14 shrink-0 items-center gap-1.5 px-2 sm:h-16 sm:gap-3 sm:px-8">
      <button onClick={() => setMobile(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-ink/5 lg:hidden" aria-label="เปิดเมนู"><Menu className="h-5 w-5" /></button>
      <NavModeButton />
      <div className="hidden min-w-0 flex-1 sm:block"><GlobalSearch /></div>
      <button onClick={() => setSearching(true)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-ink/5 sm:hidden" aria-label="ค้นหาไฟล์หรือโฟลเดอร์"><Search className="h-5 w-5" /></button>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
        <LangSwitcher />
        <ZoomButton />
        {aiAllowed && <AiButton />}
        <NotificationBell />
        <UserMenu />
      </div>
    </header>
  );
}
