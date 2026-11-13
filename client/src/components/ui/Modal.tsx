import { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/i18n';

const SIZES = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl', full: 'max-w-[1400px]' };

export function Modal({
  open, onClose, title, description, children, footer, size = 'md', icon, className, bodyClassName,
}: {
  open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode;
  size?: keyof typeof SIZES; icon?: ReactNode; className?: string; bodyClassName?: string;
}) {
  const t = useT();
  return createPortal(
    <AnimatePresence>
      {open && (
        <ModalLayer>
          {/* closes only from its own buttons (✕ / ยกเลิก …): a tap outside or Esc must not throw away what was typed */}
          <div className="fixed inset-0 bg-slate-900/40" />
          <motion.div role="dialog" aria-modal="true"
            className={cn('ds-modal relative my-6 flex w-full flex-col', SIZES[size], className)}
            initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
            {(title || description) && (
              <div className="flex items-start gap-3 px-6 pb-2 pt-5">
                {icon && <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</div>}
                <div className="min-w-0 flex-1">
                  {title && <h2 className="text-lg font-semibold leading-tight">{title}</h2>}
                  {description && <p className="mt-1 text-sm text-muted">{description}</p>}
                </div>
                <button onClick={onClose} aria-label={t('ปิด')} className="-mr-2 rounded-lg p-1.5 text-muted hover:bg-ink/5 hover:text-ink">
                  <X className="h-5 w-5" />
                </button>
              </div>
            )}
            <div className={cn('px-6 py-4', bodyClassName)}>{children}</div>
            {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
          </motion.div>
        </ModalLayer>
      )}
    </AnimatePresence>,
    document.fullscreenElement ?? document.body, // inside the top layer while a page is full screen
  );
}

/** The full-screen layer behind a dialog. Once closing starts it lets taps through, even if the exit animation is cut short
 *  (phone app switched away mid-animation): an invisible layer left over the page would make the whole app look frozen. */
function ModalLayer({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div className="fixed inset-0 z-[900] flex items-start justify-center overflow-y-auto p-3 sm:items-center sm:p-6"
      style={{ pointerEvents: present ? 'auto' : 'none' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      {children}
    </motion.div>
  );
}
