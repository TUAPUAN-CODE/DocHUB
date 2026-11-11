import { DragEvent, MouseEvent, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, FolderOpen, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { actionVerb, fmtDateTime, levelToPerm, relTime } from '@/lib/format';
import type { FileItem, FolderItem } from '@/types';
import { dropInto, DRAG_MIME } from '../layout/FolderTree';
import { playOpenFile } from '../layout/OpenFileOverlay';
import { Avatar, PermBadge, StarButton } from '../ui/misc';
import { FileGlyph, FileThumb, FolderGlyph } from './icons';
import { DocTypeBadge } from '@/modules/revisions/docTypes';

export type Item = { kind: 'folder'; data: FolderItem } | { kind: 'file'; data: FileItem };

interface Common {
  item: Item; onMenu: (e: MouseEvent, item: Item) => void; onStar: (item: Item) => void; draggable?: boolean;
}

function useDnD(item: Item, canDrag: boolean) {
  const [over, setOver] = useState(false);
  const drag = canDrag ? {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: item.kind, id: item.data.id, name: item.data.name }));
      e.dataTransfer.effectAllowed = 'move';
    },
  } : {};
  const drop = item.kind === 'folder' ? {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_MIME)) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: async (e: DragEvent) => { e.preventDefault(); setOver(false); await dropInto(e, item.data.id); },
  } : {};
  return { over, props: { ...drag, ...drop } };
}

function useOpen(item: Item) {
  const nav = useNavigate();
  return (el: HTMLElement | null) => {
    if (item.kind === 'folder') return nav(`/folders/${item.data.id}`);
    if (item.data.level > 0) playOpenFile(el, item.data.color, item.data.name);
    nav(`/files/${item.data.id}`);
  };
}

export function ItemCard({ item, onMenu, onStar, draggable }: Common) {
  const ref = useRef<HTMLDivElement>(null);
  const { over, props } = useDnD(item, !!draggable);
  const open = useOpen(item);
  const d = item.data;
  const locked = d.level === 0;
  return (
    <div ref={ref} {...props} onClick={() => open(ref.current)} onContextMenu={(e) => { e.preventDefault(); onMenu(e, item); }}
      className={cn('ds-card group relative cursor-pointer overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
        over && 'ring-2 ring-primary ring-offset-2 ring-offset-app')}>
      {/* phones: no preview picture, so a screen lists several files */}
      {item.kind === 'file' && <div className="hidden h-28 border-b border-line sm:block"><FileThumb id={d.id} color={d.color} /></div>}
      <div className="flex items-start gap-3 p-3 sm:p-3.5">
        {item.kind === 'folder' ? <FolderGlyph color={d.color} size={38} locked={locked} /> : <FileGlyph color={d.color} size={34} locked={locked} />}
        <div className="min-w-0 flex-1">
          {item.kind === 'file' && item.data.folderName && <p className="truncate text-xs font-medium" style={{ color: d.color }}>{item.data.folderName}</p>}
          <p className="line-clamp-2 break-words text-sm font-semibold leading-snug sm:truncate sm:text-[15px]">{d.name}</p>
          {item.kind === 'file' && item.data.docType && <DocTypeBadge type={item.data.docType} className="mt-1" />}
          <p className="mt-0.5 truncate text-xs text-muted">
            {item.kind === 'folder'
              ? `${item.data.folderCount} โฟลเดอร์ · ${item.data.fileCount} ไฟล์`
              : `${item.data.sheetCount ?? 0} ชีต · ${relTime(item.data.lastActivityAt ?? item.data.updatedAt)}`}
          </p>
        </div>
        <div className="flex items-center opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
          <StarButton active={d.favorite} onToggle={() => onStar(item)} size={16} />
          <button onClick={(e) => { e.stopPropagation(); onMenu(e, item); }} className="rounded-lg p-1 text-muted hover:bg-ink/5 hover:text-ink" aria-label="ตัวเลือก">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
        {d.favorite && <StarButton active onToggle={() => onStar(item)} size={16} className="absolute right-2 top-2 max-sm:!hidden sm:group-hover:opacity-0" />}
      </div>
    </div>
  );
}

export function ItemRow({ item, onMenu, onStar, draggable }: Common) {
  const ref = useRef<HTMLTableRowElement>(null);
  const { over, props } = useDnD(item, !!draggable);
  const open = useOpen(item);
  const d = item.data;
  const f = item.kind === 'file' ? item.data : null;
  return (
    <tr ref={ref} {...props} onClick={() => open(ref.current)} onContextMenu={(e) => { e.preventDefault(); onMenu(e, item); }}
      className={cn('cursor-pointer', over && '[&>td]:!border-primary [&>td]:!bg-primary/5')}>
      <td>
        <div className="flex items-center gap-3">
          {item.kind === 'folder' ? <FolderGlyph color={d.color} size={32} locked={d.level === 0} /> : <FileGlyph color={d.color} size={30} locked={d.level === 0} />}
          <span className="truncate font-medium">{d.name}</span>
          {f?.docType && <DocTypeBadge type={f.docType} />}
        </div>
      </td>
      <td className="whitespace-nowrap text-[13px] text-muted">{fmtDateTime(f?.lastActivityAt ?? d.updatedAt)}</td>
      <td className="text-[13px]">
        {f?.lastActivityBy ? <span className="inline-flex items-center gap-2"><Avatar name={f.lastActivityBy} src={f.lastActivityAvatar} size={22} /><span className="truncate">{f.lastActivityBy}</span></span>
          : <span className="text-muted">—</span>}
      </td>
      <td className="hidden text-[13px] text-muted md:table-cell">{item.kind === 'folder' ? `${item.data.fileCount} ไฟล์` : `${item.data.sheetCount ?? 0} ชีต`}</td>
      <td><PermBadge perm={levelToPerm(d.level)} /></td>
      <td className="w-20 text-right">
        <div className="inline-flex items-center">
          <StarButton active={d.favorite} onToggle={() => onStar(item)} size={16} />
          <button onClick={(e) => { e.stopPropagation(); onMenu(e, item); }} className="rounded-lg p-1 text-muted hover:bg-ink/5" aria-label="ตัวเลือก"><MoreHorizontal className="h-4 w-4" /></button>
        </div>
      </td>
    </tr>
  );
}

/** SharePoint-like activity card */
export function ActivityCard({ file }: { file: FileItem }) {
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <Link ref={ref} to={`/files/${file.id}`} onClick={() => playOpenFile(ref.current, file.color, file.name)}
      className="ds-card group block overflow-hidden transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md">
      {/* phones: no preview picture, so a screen shows several files instead of one */}
      <div className="hidden h-32 overflow-hidden border-b border-line sm:block"><FileThumb id={file.id} color={file.color} className="transition-transform duration-500 group-hover:scale-[1.04]" /></div>
      <div className="p-3 sm:p-4">
        <div className="flex items-start gap-2.5">
          <FileGlyph color={file.color} size={26} />
          <div className="min-w-0 flex-1" title={['ไฟล์ทั้งหมด', ...(file.pathParts ?? []).map((p) => p.name)].join(' / ')}>
            {/* phones: only the file's own folder on one line (the whole path is in the tooltip / folder page) */}
            <p className="flex items-center gap-x-1 text-[11px] leading-snug text-muted max-sm:overflow-hidden sm:flex-wrap">
              <FolderOpen className="h-3 w-3 shrink-0" style={{ color: file.color }} />
              <span className="max-sm:hidden">ไฟล์ทั้งหมด</span>
              {(file.pathParts ?? [{ id: file.folderId, name: file.folderName ?? '' }]).map((p, i, a) => (
                <span key={p.id} className={cn('inline-flex min-w-0 items-center gap-1', i < a.length - 1 && 'max-sm:hidden')}>
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-50 max-sm:hidden" />
                  <span className={cn('min-w-0 max-sm:truncate', i === a.length - 1 && 'font-semibold')} style={i === a.length - 1 ? { color: file.color } : undefined}>{p.name}</span>
                </span>
              ))}
            </p>
          </div>
        </div>
        <p className="mt-1.5 line-clamp-2 break-words text-sm font-semibold leading-snug sm:mt-2 sm:min-h-[2.6em] sm:text-[15px]">{file.name}</p>
        {file.docType && <DocTypeBadge type={file.docType} className="mt-1" />}
        <p className="mt-1 truncate text-[11px] text-muted sm:whitespace-normal">{file.sheetCount != null && <>{file.sheetCount} ชีต · </>}สร้างโดย {file.createdByName ?? '—'}{file.createdAt ? ` · ${fmtDateTime(file.createdAt)}` : ''}</p>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted sm:mt-3">
          <Avatar name={file.lastActivityBy ?? file.createdByName} src={file.lastActivityAvatar} size={24} />
          <span className="min-w-0 truncate">
            <span className="font-medium text-ink/80">{file.lastActivityBy ?? file.createdByName}</span>{' '}
            {actionVerb(file.lastAction) || 'แก้ไข'} · {relTime(file.lastActivityAt ?? file.updatedAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}
