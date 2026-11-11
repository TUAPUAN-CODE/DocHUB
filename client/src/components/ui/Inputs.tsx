import { forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/** group: the content is several buttons (tag chips, an upload tile …) — a <div>, so a tap on the title does not press the first one */
export function Field({ label, hint, error, required, children, className, group }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; required?: boolean; children: ReactNode; className?: string; group?: boolean;
}) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className={cn('block', className)} {...(group ? { role: 'group' } : {})}>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-ink/85">{label}{required && <span className="ml-0.5 text-danger">*</span>}</span>}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </Tag>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; invalid?: boolean }>(
  function TextInput({ className, icon, invalid, ...rest }, ref) {
    if (icon)
      return (
        <div className={cn('ds-input flex h-10 items-center gap-2 px-3', invalid && '!border-danger', className)}>
          <span className="text-muted [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          <input ref={ref} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" {...rest} />
        </div>
      );
    return <input ref={ref} className={cn('ds-input h-10 w-full px-3 text-sm', invalid && '!border-danger', className)} {...rest} />;
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function TextArea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} className={cn('ds-input w-full px-3 py-2 text-sm', invalid && '!border-danger', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className="ds-input h-10 w-full appearance-none pl-3 pr-9 text-sm" {...rest}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </div>
  );
});

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 text-sm disabled:opacity-50">
      <span className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-ink/20')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function Checkbox({ checked, onChange, label, indeterminate, className }: {
  checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; indeterminate?: boolean; className?: string;
}) {
  return (
    <button type="button" role="checkbox" aria-checked={indeterminate ? 'mixed' : checked} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className={cn('inline-flex min-w-0 items-center gap-2 text-left text-sm', className)}>
      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
        checked || indeterminate ? 'border-primary bg-primary text-white' : 'border-ink/25 bg-surface')}>
        {indeterminate ? <span className="h-0.5 w-2 rounded bg-white" /> : checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
      {label !== undefined && <span className="min-w-0 truncate">{label}</span>}
    </button>
  );
}

export function Segmented<T extends string>({ value, onChange, options, size = 'md' }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex rounded-xl bg-ink/5 p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn('inline-flex items-center gap-1.5 rounded-lg font-medium transition-all [&>svg]:h-4 [&>svg]:w-4',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
            value === o.value ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-ink')}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
