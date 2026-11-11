import { lazy, ReactNode, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmHost, Toaster } from '@/components/ui/Feedback';
import { Spinner } from '@/components/ui/misc';
import { useAuth } from '@/store/auth';
import { canSee } from '@/lib/pages';
import LoginPage, { nextPath } from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import FolderPage from '@/pages/FolderPage';
import NotFound from '@/pages/NotFound';
import { ToRequests } from '@/pages/RequestsHubPage';

const FilePage = lazy(() => import('@/pages/FilePage'));
const FileBuilderPage = lazy(() => import('@/pages/FileBuilderPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const TagsPage = lazy(() => import('@/pages/users/TagsPage'));
const SignupPage = lazy(() => import('@/pages/SignupPage'));
const TrashPage = lazy(() => import('@/pages/TrashPage'));
const DashboardsPage = lazy(() => import('@/pages/DashboardsPage'));
const PublicSharePage = lazy(() => import('@/pages/PublicSharePage'));
const PdfDesignerPage = lazy(() => import('@/pages/PdfDesignerPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ConnectorsPage = lazy(() => import('@/modules/connectors/ConnectorsPage'));
const TracebackPage = lazy(() => import('@/pages/TracebackPage'));
const DevicesPage = lazy(() => import('@/pages/DevicesPage'));
const GuidePage = lazy(() => import('@/modules/guide/GuidePage'));
const MonitorPage = lazy(() => import('@/modules/monitor/MonitorPage'));
const RequestsHubPage = lazy(() => import('@/pages/RequestsHubPage'));
const NewsPage = lazy(() => import('@/modules/news/NewsPage'));
const TagHubPage = lazy(() => import('@/modules/tags/TagHubPage'));
const PermissionsPage = lazy(() => import('@/modules/pageAccess/PermissionsPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const loc = useLocation();
  if (status === 'guest') {
    const from = loc.pathname + loc.search;
    // ?next= keeps the destination through a page reload and the Microsoft / Google round trip
    return <Navigate to={from === '/' ? '/login' : `/login?next=${encodeURIComponent(from)}`} replace state={{ from }} />;
  }
  return <>{children}</>;
}
function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const role = useAuth((s) => s.user?.role);
  return role && (roles.includes(role) || role === 'root') ? <>{children}</> : <Navigate to="/" replace />;
}
/** a page of the left bar: the role must have it (จัดการสิทธิ์, lib/pages.tsx) */
function RequirePage({ page, children }: { page: string; children: ReactNode }) {
  const ok = useAuth((s) => canSee(s.user, page));
  return ok ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);
  useEffect(() => { void bootstrap(); }, [bootstrap]);

  if (status === 'loading')
    return (
      <div className="grid h-full place-items-center" style={{ background: 'rgb(var(--c-bg))' }}>
        <div className="flex flex-col items-center gap-3 text-sm text-muted"><Spinner className="h-7 w-7" />กำลังโหลด DataSheet Pro…</div>
      </div>
    );

  return (
    <>
      <Routes>
        <Route path="/login" element={status === 'authed' ? <Navigate to={nextPath(window.location.search)} replace /> : <LoginPage />} />
        <Route path="/signup" element={status === 'authed' ? <Navigate to="/" replace /> : <Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}><SignupPage /></Suspense>} />
        <Route path="/s/:token" element={<Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}><PublicSharePage /></Suspense>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="browse" element={<RequirePage page="browse"><FolderPage /></RequirePage>} />
          <Route path="news" element={<RequirePage page="news"><NewsPage /></RequirePage>} />
          <Route path="tags" element={<RequirePage page="tags"><TagHubPage /></RequirePage>} />
          <Route path="permissions" element={<RequireRole roles={['root']}><PermissionsPage /></RequireRole>} />
          <Route path="folders/:id" element={<FolderPage />} />
          <Route path="files/new" element={<RequireRole roles={['master', 'admin']}><FileBuilderPage /></RequireRole>} />
          <Route path="files/:id" element={<FilePage />} />
          <Route path="files/:fileId/dashboards/:dashId" element={<DashboardPage />} />
          <Route path="files/:fileId/pdf" element={<PdfDesignerPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="requests" element={<RequirePage page="requests"><RequestsHubPage /></RequirePage>} />
          <Route path="access-requests" element={<ToRequests tab="access" />} />
          <Route path="audit" element={<RequirePage page="audit"><AuditPage /></RequirePage>} />
          <Route path="users" element={<RequirePage page="users"><UsersPage /></RequirePage>} />
          <Route path="users/requests" element={<ToRequests tab="accounts" />} />
          <Route path="users/tags" element={<RequirePage page="users"><TagsPage /></RequirePage>} />
          <Route path="trash" element={<RequirePage page="trash"><TrashPage /></RequirePage>} />
          <Route path="dashboards" element={<RequirePage page="dashboards"><DashboardsPage /></RequirePage>} />
          <Route path="approvals" element={<ToRequests tab="docs" />} />
          <Route path="connectors" element={<RequirePage page="connectors"><ConnectorsPage /></RequirePage>} />
          <Route path="traceback" element={<RequirePage page="search"><TracebackPage /></RequirePage>} />
          <Route path="devices" element={<RequirePage page="devices"><DevicesPage /></RequirePage>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="monitor" element={<RequirePage page="monitor"><MonitorPage /></RequirePage>} />
          <Route path="guide" element={<RequirePage page="guide"><GuidePage /></RequirePage>} />
          <Route path="guide/:id" element={<RequirePage page="guide"><GuidePage /></RequirePage>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
      <ConfirmHost />
    </>
  );
}
