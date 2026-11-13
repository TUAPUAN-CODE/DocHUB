import { useRef, useState } from 'react';
import { Check, Globe } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MenuList, Popover } from '@/components/ui/Popover';
import { LANGS, useLang, useT } from './index';

/** Language menu (Thai · English · မြန်မာ · ខ្មែរ) */
export function LangSwitcher({ className, compact }: { className?: string; compact?: boolean }) {
  const { lang, setLang } = useLang();
  const t = useT();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const cur = LANGS.find((l) => l.code === lang)!;
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((v) => !v)} aria-label={t('ภาษา')} aria-haspopup="menu" aria-expanded={open}
        className={cn('flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium hover:bg-ink/5', className)}>
        <Globe className="h-5 w-5" />{!compact && <span className="hidden sm:inline">{cur.label}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn.current} placement="bottom-end" width={170}>
        <MenuList onClose={() => setOpen(false)} items={LANGS.map((l) => ({ label: l.label, icon: l.code === lang ? <Check /> : <span />, onClick: () => setLang(l.code) }))} />
      </Popover>
    </>
  );
}
