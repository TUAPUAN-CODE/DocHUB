import { Suspense } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Spinner } from '../ui/misc';
import { AiPanel } from '@/modules/ai/AiPanel';
import { OpenFileOverlay } from './OpenFileOverlay';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const outlet = useOutlet();
  const { pathname } = useLocation();
  return (
    <div className="flex h-full" style={{ background: 'var(--sidebar-bg)' }}>
      <Sidebar />
      <main id="main-panel" className="main-panel flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        <div id="page-scroll" className="relative min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={pathname} className="min-h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}>
              <Suspense fallback={<div className="grid h-64 place-items-center"><Spinner /></div>}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <AiPanel />
      <OpenFileOverlay />
    </div>
  );
}

export const Page = ({ children, wide }: { children: React.ReactNode; wide?: boolean }) => (
  <div className={wide ? 'px-3 pb-6 pt-2 sm:px-6' : 'mx-auto max-w-[1440px] px-4 pb-10 pt-3 sm:px-8'}>{children}</div>
);
