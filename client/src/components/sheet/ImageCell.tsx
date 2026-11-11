import { DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ChevronLeft, ChevronRight, ImagePlus, Loader2, X } from 'lucide-react';
import { prepareImage } from '@/lib/imageCompress';
import { uploadsApi } from '@/api/endpoints';
import { apiError } from '@/api/client';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import type { CellValue, Column } from '@/types';
import { Popover } from '../ui/Popover';

export const toUrls = (v: CellValue | undefined): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** /uploads/x.png is served by the API host; absolute URLs are used as-is */
export const imgSrc = (u: string) => u;

/* ---------------- Lightbox ---------------- */
export function Lightbox({ urls, index, onIndex, onClose }: { urls: string[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const n = urls.length;
  const go = useCallback((d: number) => onIndex((index + d + n) % n), [index, n, onIndex]);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [go, onClose]);
  if (!n) return null;
  return createPortal(
    <div className="fixed inset-0 z-[2000] flex flex-col bg-black/90" onClick={onClose} role="dialog" aria-label="ดูรูปภาพ">
      <div className="flex items-center justify-between px-4 py-3 text-sm text-white/80">
        <span className="tabular-nums">{index + 1} / {n}</span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="ปิด"><X className="h-5 w-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-14 pb-4">
        <img src={imgSrc(urls[index])} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        {n > 1 && (
          <>
            <button onClick={(e) => { e.stopPropagation(); go(-1); }} className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/25" aria-label="รูปก่อนหน้า"><ChevronLeft className="h-6 w-6" /></button>
            <button onClick={(e) => { e.stopPropagation(); go(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/25" aria-label="รูปถัดไป"><ChevronRight className="h-6 w-6" /></button>
          </>
        )}
      </div>
      {n > 1 && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4" onClick={(e) => e.stopPropagation()}>
          {urls.map((u, i) => (
            <button key={u} onClick={() => onIndex(i)} className={cn('h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2', i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100')}>
              <img src={imgSrc(u)} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.fullscreenElement ?? document.body,
  );
}

/** Opens the viewer for a list of images */
export function useLightbox() {
  const [state, setState] = useState<{ urls: string[]; index: number } | null>(null);
  const node = state ? <Lightbox urls={state.urls} index={state.index} onIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))} onClose={() => setState(null)} /> : null;
  return { open: (urls: string[], index = 0) => setState({ urls, index }), node };
}

/* ---------------- Read-only displays ---------------- */
/** Thumbnails inside a grid cell: as many as fit, then "+N" */
export function ImageThumbs({ urls, max = 12 }: { urls: string[]; max?: number }) {
  const lb = useLightbox();
  const shown = urls.slice(0, max);
  return (
    <span className="flex h-full items-center gap-1.5">
      <span className="flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {shown.map((u, i) => (
          <button key={u} type="button" onClick={(e) => { e.stopPropagation(); lb.open(urls, i); }} onDoubleClick={(e) => e.stopPropagation()}
            className="h-[calc(100%-6px)] max-h-24 shrink-0 overflow-hidden rounded-md border border-line bg-ink/5" style={{ aspectRatio: '1 / 1' }}>
            <img src={imgSrc(u)} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
          </button>
        ))}
      </span>
      {urls.length > 1 && <span className="shrink-0 rounded-full bg-ink/10 px-1.5 text-[0.85em] font-medium tabular-nums" title={`${urls.length} รูป`}>{urls.length}</span>}
      {lb.node}
    </span>
  );
}

/** Larger responsive gallery (row detail view) */
export function ImageGallery({ urls }: { urls: string[] }) {
  const lb = useLightbox();
  if (!urls.length) return <span className="text-muted">—</span>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {urls.map((u, i) => (
          <button key={u} type="button" onClick={() => lb.open(urls, i)} className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-ink/5">
            <img src={imgSrc(u)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          </button>
        ))}
      </div>
      {lb.node}
    </>
  );
}

/* ---------------- Upload + editing ---------------- */
/** Uploads files one by one and returns the URLs that succeeded */
export async function uploadImages(files: File[], onProgress?: (done: number, total: number) => void): Promise<string[]> {
  const out: string[] = [];
  let done = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/')) { toast.error(`“${f.name}” ไม่ใช่ไฟล์รูปภาพ`); continue; }
    try { out.push((await uploadsApi.image(await prepareImage(f))).url); } catch (e) { toast.error(apiError(e).message, `อัปโหลด “${f.name}” ไม่สำเร็จ`); }
    onProgress?.(++done, files.length);
  }
  return out;
}

/** Thumbnail grid with remove buttons and an add / drop zone — used in the row form and the cell popover */
export function ImagePicker({ urls, onChange, max = 200, columns = 4 }: { urls: string[]; onChange: (u: string[]) => void; max?: number; columns?: number }) {
  const input = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [over, setOver] = useState(false);
  const lb = useLightbox();
  const add = async (list: FileList | File[] | null) => {
    const files = [...(list ?? [])].slice(0, Math.max(0, max - urls.length));
    if (!files.length) { if (list?.length) toast.info(`ใส่รูปได้ไม่เกิน ${max} รูป`); return; }
    setBusy({ done: 0, total: files.length });
    const added = await uploadImages(files, (done, total) => setBusy({ done, total }));
    setBusy(null);
    if (added.length) onChange([...urls, ...added]);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files); };
  return (
    <div onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
      className={cn('rounded-xl border border-dashed p-2 transition-colors', over ? 'border-primary bg-primary/5' : 'border-line')}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {urls.map((u, i) => (
          <div key={u} className="group relative aspect-square overflow-hidden rounded-lg border border-line bg-ink/5">
            <button type="button" onClick={() => lb.open(urls, i)} className="h-full w-full"><img src={imgSrc(u)} alt="" loading="lazy" className="h-full w-full object-cover" /></button>
            {/* always visible: phones have no hover */}
            <button type="button" onClick={() => onChange(urls.filter((x) => x !== u))} aria-label="ลบรูปนี้" title="ลบรูปนี้"
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white shadow transition-colors hover:bg-danger"><X className="h-4 w-4" /></button>
          </div>
        ))}
        {urls.length < max && (
          <button type="button" disabled={!!busy} onClick={() => cam.current?.click()}
            className="grid aspect-square place-items-center rounded-lg border border-primary/40 bg-primary/5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-60">
            <span className="flex flex-col items-center gap-1"><Camera className="h-5 w-5" />ถ่ายรูป</span>
          </button>
        )}
        {urls.length < max && (
          <button type="button" disabled={!!busy} onClick={() => input.current?.click()}
            className="grid aspect-square place-items-center rounded-lg border border-line text-xs text-muted hover:border-primary/50 hover:text-primary disabled:opacity-60">
            {busy ? <span className="flex flex-col items-center gap-1"><Loader2 className="h-5 w-5 animate-spin" />{busy.done}/{busy.total}</span>
              : <span className="flex flex-col items-center gap-1"><ImagePlus className="h-5 w-5" />เพิ่มรูป</span>}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-muted">กด ✕ ที่มุมรูปเพื่อลบรูปนั้น · เลือกได้หลายรูปพร้อมกัน หรือลากรูปมาวางที่นี่ · PNG, JPG, GIF, WEBP</p>
      <input ref={input} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" className="hidden"
        onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      {/* capture = open the phone's camera app directly (works on http too); on a PC it is the normal file dialog */}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      {lb.node}
    </div>
  );
}

/** Cell editor: popover with the picker; saves when closed */
export function ImageCellEditor({ col, value, anchor, onCommit, onCancel }: {
  col: Column; value: CellValue | undefined; anchor: HTMLElement | null; onCommit: (v: CellValue, move: null) => void; onCancel: () => void;
}) {
  const [urls, setUrls] = useState<string[]>(toUrls(value));
  const orig = JSON.stringify(toUrls(value));
  const close = () => { if (JSON.stringify(urls) === orig) onCancel(); else onCommit(urls.length ? urls : null, null); };
  return (
    <Popover open anchor={anchor} onClose={close} width={Math.max(340, anchor?.offsetWidth ?? 0)}>
      <div className="p-3"><ImagePicker urls={urls} onChange={setUrls} max={col.validation?.maxSelections ?? 200} columns={4} /></div>
      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        <button type="button" onClick={() => onCommit(null, null)} className="text-xs text-muted hover:text-danger">ลบรูปทั้งหมด</button>
        <button type="button" onClick={close} className="rounded-lg bg-primary px-3 py-1 text-xs font-medium text-white">เสร็จ</button>
      </div>
    </Popover>
  );
}
