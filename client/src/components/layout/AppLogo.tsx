import { useAppInfo } from '@/store/appInfo';
import { cn } from '@/lib/cn';

/** The app's icon: the one an admin uploaded (ตั้งค่า → ชื่อระบบ), or the built-in mark */
export function AppLogo({ className }: { className?: string }) {
  const icon = useAppInfo((s) => s.icon);
  if (icon) return <img src={icon} alt="" className={cn('h-9 w-9 shrink-0 rounded-xl object-cover shadow-sm', className)} />;
  return (
    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/95 text-primary shadow-sm', className)}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M5 7h14M5 12h14M5 17h9M10 4v16" /></svg>
    </span>
  );
}
