import { useRef } from 'react';
import { PAGE_MM } from './pageSizes';
import type { Area } from './api';

/** Drag on a page-shaped canvas to mark where the signature goes (page size in mm, from the top-left corner) */
export function AreaPicker({ area, onChange, size, landscape }: { area: Area; onChange: (a: Area) => void; size: string; landscape: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [pw0, ph0] = PAGE_MM[size] ?? PAGE_MM.A4;
  const pw = landscape ? ph0 : pw0, ph = landscape ? pw0 : ph0;
  const toMm = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return { x: Math.min(pw, Math.max(0, ((e.clientX - r.left) / r.width) * pw)), y: Math.min(ph, Math.max(0, ((e.clientY - r.top) / r.height) * ph)) }; };
  const down = (e: React.PointerEvent) => { box.current!.setPointerCapture(e.pointerId); start.current = toMm(e); };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = toMm(e); const s = start.current;
    onChange({ ...area, x: Math.round(Math.min(s.x, p.x)), y: Math.round(Math.min(s.y, p.y)), w: Math.max(10, Math.round(Math.abs(p.x - s.x))), h: Math.max(8, Math.round(Math.abs(p.y - s.y))) });
  };
  return (
    <div ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}
      className="relative w-full max-w-[260px] cursor-crosshair touch-none select-none rounded-md border border-line bg-white shadow-sm" style={{ aspectRatio: `${pw} / ${ph}` }}>
      <div className="pointer-events-none absolute border-2 border-primary bg-primary/15" style={{ left: `${(area.x / pw) * 100}%`, top: `${(area.y / ph) * 100}%`, width: `${(area.w / pw) * 100}%`, height: `${(area.h / ph) * 100}%` }} />
      <span className="pointer-events-none absolute bottom-1 right-1 text-[10px] text-muted">ลากเพื่อกำหนดพื้นที่</span>
    </div>
  );
}
