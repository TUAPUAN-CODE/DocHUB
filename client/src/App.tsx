import { lazy, ReactNode, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { ConfirmHost, Toaster } from '@/components/ui/Feedback';
import { Spinner } from '@/components/ui/misc';
import { useAuth } from '@/store/auth';
import LoginPage from '@/pages/LoginPage';
import HomePage from '@/pages/HomePage';
import FolderPage from '@/pages/FolderPage';
import NotFound from '@/pages/NotFound';

const FilePage = lazy(() => import('@/pages/FilePage'));
const FileBuilderPage = lazy(() => import('@/pages/FileBuilderPage'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const SearchPage = lazy(() => import('@/pages/SearchPage'));
const AccessRequestsPage = lazy(() => import('@/pages/AccessRequestsPage'));
const AuditPage = lazy(() => import('@/pages/AuditPage'));
const UsersPage = lazy(() => import('@/pages/UsersPage'));
const TrashPage = lazy(() => import('@/pages/TrashPage'));
const DashboardsPage = lazy(() => import('@/pages/DashboardsPage'));
const PublicSharePage = lazy(() => import('@/pages/PublicSharePage'));
const PdfDesignerPage = lazy(() => import('@/pages/PdfDesignerPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ApprovalsPage = lazy(() => import('@/modules/approvals/ApprovalsPage'));
const ConnectorsPage = lazy(() => import('@/modules/connectors/ConnectorsPage'));
const AutoPlanPage = lazy(() => import('@/modules/inkcode/AutoPlanPage'));
const TracebackPage = lazy(() => import('@/pages/TracebackPage'));
const DevicesPage = lazy(() => import('@/pages/DevicesPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const loc = useLocation();
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <>{children}</>;
}
function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const role = useAuth((s) => s.user?.role);
  return role && roles.includes(role) ? <>{children}</> : <Navigate to="/" replace />;
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
        <Route path="/login" element={status === 'authed' ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/s/:token" element={<Suspense fallback={<div className="grid h-full place-items-center"><Spinner /></div>}><PublicSharePage /></Suspense>} />
        <Route element={<RequireAuth><AppShell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="browse" element={<FolderPage />} />
          <Route path="folders/:id" element={<FolderPage />} />
          <Route path="files/new" element={<RequireRole roles={['master', 'admin']}><FileBuilderPage /></RequireRole>} />
          <Route path="files/:id" element={<FilePage />} />
          <Route path="files/:fileId/dashboards/:dashId" element={<DashboardPage />} />
          <Route path="files/:fileId/pdf" element={<PdfDesignerPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="access-requests" element={<AccessRequestsPage />} />
          <Route path="audit" element={<RequireRole roles={['master', 'admin']}><AuditPage /></RequireRole>} />
          <Route path="users" element={<RequireRole roles={['admin']}><UsersPage /></RequireRole>} />
          <Route path="trash" element={<TrashPage />} />
          <Route path="dashboards" element={<DashboardsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="inkcode/plan" element={<RequireRole roles={['master', 'admin']}><AutoPlanPage /></RequireRole>} />
          <Route path="connectors" element={<RequireRole roles={['master', 'admin']}><ConnectorsPage /></RequireRole>} />
          <Route path="traceback" element={<TracebackPage />} />
          <Route path="devices" element={<RequireRole roles={['master', 'admin']}><DevicesPage /></RequireRole>} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
      <ConfirmHost />
    </>
  );
}
