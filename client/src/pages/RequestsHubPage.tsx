import { lazy, ReactNode, Suspense, useState } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ClipboardCheck, FileSignature, KeyRound, Tags, UserPlus } from 'lucide-react';
import { Page } from '@/components/layout/AppShell';
import { PageHeader, Spinner } from '@/components/ui/misc';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { isAdminRole, isBasicRole } from '@/types';

const ApprovalsPage = lazy(() => import('@/modules/approvals/ApprovalsPage'));
const AccessRequestsPage = lazy(() => import('@/pages/AccessRequestsPage'));
const AccountRequestsPage = lazy(() => import('@/pages/users/AccountRequestsPage'));
const TagRequestsTab = lazy(() => import('@/modules/tags/TagHubPage').then((m) => ({ default: m.TagRequestsTab })));

export type RequestTab = 'docs' | 'access' | 'accounts' | 'tags';

/** คำขออนุมัติ: every kind of request in one page — documents to sign, file access, new accounts (admin), tags (master / admin) */
export default function RequestsHubPage() {
  const role = useAuth((s) => s.user?.role);
  const counts = { reviews: useData((s) => s.pendingReviews), accounts: useData((s) => s.pendingAccounts), tags: useData((s) => s.pendingTagRequests) };
  const [sp, setSp] = useSearchParams();
  const tabs: { v: RequestTab; label: string; icon: ReactNode; badge?: number }[] = [
    { v: 'docs', label: 'อนุมัติเอกสาร', icon: <FileSignature className="h-4 w-4" /> },
    { v: 'access', label: 'คำขอสิทธิ์ไฟล์', icon: <KeyRound className="h-4 w-4" />, badge: counts.reviews },
    ...(isAdminRole(role) ? [{ v: 'accounts' as RequestTab, label: 'คำขอสร้างบัญชี', icon: <UserPlus className="h-4 w-4" />, badge: counts.accounts }] : []),
    { v: 'tags', label: 'คำขอ Tag', icon: <Tags className="h-4 w-4" />, badge: role && !isBasicRole(role) ? counts.tags : 0 },
  ];
  const asked = sp.get('tab') as RequestTab | null;
  const tab = tabs.some((t) => t.v === asked) ? asked! : 'docs';
  const go = (v: RequestTab) => setSp({ tab: v }, { replace: true }); // (each tab starts on its own default box)
  return (
    <Page>
      <PageHeader icon={<ClipboardCheck />} title="คำขออนุมัติ" subtitle="เอกสารที่รอลงนาม คำขอสิทธิ์ไฟล์ คำขอสร้างบัญชี และคำขอ Tag ในหน้าเดียว" />
      <nav className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-line px-1" aria-label="ประเภทคำขอ">
        {tabs.map((t) => (
          <button key={t.v} onClick={() => go(t.v)} aria-current={tab === t.v ? 'page' : undefined}
            className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === t.v ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-ink')}>
            {t.icon}{t.label}
            {!!t.badge && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white">{t.badge}</span>}
          </button>
        ))}
      </nav>
      <Suspense fallback={<div className="grid h-40 place-items-center"><Spinner /></div>}>
        {tab === 'docs' ? <ApprovalsPage embedded /> : tab === 'access' ? <AccessRequestsPage embedded /> : tab === 'accounts' ? <AccountRequestsPage embedded /> : <TagRequestsTab />}
      </Suspense>
    </Page>
  );
}

/** old addresses (notifications, bookmarks) → the tab, keeping their other parameters (?open=, ?box=) */
export function ToRequests({ tab }: { tab: RequestTab }) {
  const { search } = useLocation();
  // worked out once: while the page fades out it sees the new address
  const [to] = useState(() => { const p = new URLSearchParams(search); p.set('tab', tab); return `/requests?${p.toString()}`; });
  return <Navigate to={to} replace />;
}
