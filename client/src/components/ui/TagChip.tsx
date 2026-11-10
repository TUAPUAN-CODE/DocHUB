import { Check, Tag as TagIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TagRef } from '@/types';

export function TagChip({ tag, className, size = 'sm' }: { tag: Pick<TagRef, 'name' | 'color'>; className?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full border font-medium', size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs', className)}
      style={{ color: tag.color, borderColor: `${tag.color}55`, background: `${tag.color}14` }}>
      <TagIcon className="h-3 w-3 shrink-0" /><span className="truncate">{tag.name}</span>
    </span>
  );
}

/** Pick any number of tags: tap to switch on / off */
export function TagPicker({ tags, value, onChange, empty = 'ยังไม่มี Tag — สร้างได้ที่ จัดการผู้ใช้ → Tag' }: {
  tags: TagRef[]; value: string[]; onChange: (ids: string[]) => void; empty?: string;
}) {
  if (!tags.length) return <p className="text-sm text-muted">{empty}</p>;
  const on = new Set(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const picked = on.has(t.id);
        return (
          <button key={t.id} type="button" aria-pressed={picked}
            onClick={() => onChange(picked ? value.filter((v) => v !== t.id) : [...value, t.id])}
            className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors', !picked && 'border-line text-muted hover:bg-ink/5')}
            style={picked ? { color: t.color, borderColor: t.color, background: `${t.color}1f` } : undefined}>
            {picked ? <Check className="h-3 w-3" /> : <TagIcon className="h-3 w-3" />}{t.name}
          </button>
        );
      })}
    </div>
  );
}
