import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; icon?: ReactNode; iconRight?: ReactNode; loading?: boolean;
}
const V: Record<Variant, string> = {
  primary: 'btn-primary bg-primary text-white hover:bg-primary/90 active:bg-primary/95 shadow-sm shadow-primary/20',
  secondary: 'bg-surface text-ink border border-line hover:border-primary/40 hover:text-primary',
  ghost: 'text-ink/80 hover:bg-ink/5 hover:text-ink',
  subtle: 'bg-primary/10 text-primary hover:bg-primary/15',
  danger: 'bg-danger text-white hover:bg-danger/90',
};
const S: Record<Size, string> = { sm: 'h-8 px-3 text-[13px] gap-1.5', md: 'h-10 px-4 text-sm gap-2', lg: 'h-11 px-5 text-[15px] gap-2' };

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, className, children, disabled, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn('ds-btn inline-flex items-center justify-center font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none select-none', V[variant], S[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: 'sm' | 'md' }>(
  function IconButton({ label, active, className, size = 'md', children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        className={cn(
          'inline-flex items-center justify-center rounded-[10px] transition-colors disabled:opacity-40 disabled:pointer-events-none',
          size === 'sm' ? 'h-7 w-7' : 'h-9 w-9',
          active ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-ink/5 hover:text-ink',
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
