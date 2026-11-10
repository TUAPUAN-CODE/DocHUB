import { ChevronLeft, ChevronRight, Eye, ListChecks, Pencil } from 'lucide-react';
import { fmtDateTime, relTime } from '@/lib/format';
import type { Column, Row, UsersDict } from '@/types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Chip } from './CellView';
import { ImageGallery, toUrls } from './ImageCell';

function Value({ col, value }: { col: Column; value: Row['values'][string] }) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <span className="text-muted">—</span>;
  switch (col.dataType) {
    case 'image':
      return <ImageGallery urls={toUrls(value)} />;
    case 'select': {
      const o = col.options.find((x) => x.value === value);
      return <Chip label={o?.label ?? String(value)} color={o?.color} />;
    }
    case 'multi_select':
      return <span className="flex flex-wrap gap-1.5">{(value as string[]).map((v) => <Chip key={v} label={col.options.find((o) => o.value === v)?.label ?? v} color={col.options.find((o) => o.value === v)?.color} />)}</span>;
    case 'boolean':
      return <span className="font-medium">{value ? 'ใช่ ✓' : 'ไม่ใช่'}</span>;
    case 'url':
      return <a href={String(value)} target="_blank" rel="noreferrer noopener" className="break-all text-primary hover:underline">{String(value)}</a>;
    case 'email':
      return <a href={`mailto:${value}`} className="break-all text-primary hover:underline">{String(value)}</a>;
    case 'date':
    case 'datetime':
      return <span>{col.dataType === 'date' ? new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'long' }) : fmtDateTime(String(value))}</span>;
    default:
      return <p className="whitespace-pre-wrap break-words">{String(value)}</p>;
  }
}

/** Read-only, scrollable detail of one row — all columns in full, with image galleries */
export function RowViewModal({ row, rows, columns, users, onClose, onNavigate, onEdit, onLines }: {
  row: Row | null; rows: Row[]; columns: Column[]; users: UsersDict; onClose: () => void; onNavigate: (r: Row) => void; onEdit?: (r: Row) => void;
  /** the row has line items (a document's lines): open them */
  onLines?: (r: Row) => void;
}) {
  const idx = row ? rows.findIndex((r) => r.id === row.id) : -1;
  const live = row ? rows[idx] ?? row : null; // pick up refreshed values after an edit
  const prev = idx > 0 ? rows[idx - 1] : null;
  const next = idx >= 0 && idx < rows.length - 1 ? rows[idx + 1] : null;
  return (
    <Modal open={!!row} onClose={onClose} size="xl" icon={<Eye className="h-5 w-5" />} title={live ? `ข้อมูลแถว #${live.order}` : ''}
      description={live ? `สร้างโดย ${users[live.createdBy]?.name ?? 'ผู้ใช้'} · ${fmtDateTime(live.createdAt)}${live.updatedBy ? ` · แก้ไขล่าสุดโดย ${users[live.updatedBy]?.name ?? 'ผู้ใช้'} ${relTime(live.updatedAt)}` : ''}` : ''}
      footer={<>
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} disabled={!prev} onClick={() => prev && onNavigate(prev)}>แถวก่อนหน้า</Button>
        <Button variant="secondary" disabled={!next} onClick={() => next && onNavigate(next)}>แถวถัดไป<ChevronRight className="h-4 w-4" /></Button>
        <span className="mr-auto" />
        {onLines && live && <Button variant="secondary" icon={<ListChecks className="h-4 w-4" />} onClick={() => onLines(live)}>รายการในแถว</Button>}
        {onEdit && live && <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(live)}>แก้ไข</Button>}
        <Button onClick={onClose}>ปิด</Button>
      </>}>
      {live && (
        <div className="max-h-[68vh] space-y-5 overflow-y-auto pr-2">
          {columns.map((c) => (
            <section key={c.id} className="border-b border-line/70 pb-4 last:border-0">
              <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">{c.name}{c.isRequired && <span className="ml-1 text-danger">*</span>}</h3>
              <div className="text-[15px]"><Value col={c} value={live.values[c.id]} /></div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
