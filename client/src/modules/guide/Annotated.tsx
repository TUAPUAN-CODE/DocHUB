import { useId, useMemo } from 'react';
import type { GuideMark } from './types';

const RED = '#E11D48';
const GAP = 52; // arrow length (image px)

interface Rect { x: number; y: number; w: number; h: number }
interface Laid { box: Rect; bubble: Rect; side: 'below' | 'above' | 'left' | 'right'; from: [number, number]; to: [number, number]; label: string }

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Where each explanation bubble goes: next to its box, inside the picture, clear of the other boxes and bubbles */
function layout(marks: GuideMark[], W: number, H: number, fs: number): Laid[] {
  const boxes = marks.map((m) => ({ x: m.x - 6, y: m.y - 6, w: m.w + 12, h: m.h + 12 }));
  const placed: Rect[] = [];
  return marks.map((m, i) => {
    const box = boxes[i];
    const bw = clamp(m.label.length * fs * 0.56 + 64, 150, Math.min(360, W * 0.46));
    const lines = Math.max(1, Math.ceil((m.label.length * fs * 0.56) / (bw - 64)));
    const bh = lines * fs * 1.5 + 22;
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const cand = {
      below: { x: clamp(cx - bw / 2, 8, W - bw - 8), y: box.y + box.h + GAP, w: bw, h: bh },
      above: { x: clamp(cx - bw / 2, 8, W - bw - 8), y: box.y - GAP - bh, w: bw, h: bh },
      right: { x: box.x + box.w + GAP, y: clamp(cy - bh / 2, 8, H - bh - 8), w: bw, h: bh },
      left: { x: box.x - GAP - bw, y: clamp(cy - bh / 2, 8, H - bh - 8), w: bw, h: bh },
    };
    const inside = (r: Rect) => r.x >= 4 && r.y >= 4 && r.x + r.w <= W - 4 && r.y + r.h <= H - 4;
    const order = [...(m.place ? [m.place] : []), ...(cy < H / 2 ? ['below', 'right', 'left', 'above'] : ['above', 'right', 'left', 'below'])] as Laid['side'][];
    const free = (r: Rect) => !boxes.some((b) => hit(r, b)) && !placed.some((p) => hit(r, p));
    const side = order.find((s) => inside(cand[s]) && free(cand[s])) ?? order.find((s) => inside(cand[s])) ?? 'below';
    const bubble = cand[side];
    placed.push(bubble);
    let from: [number, number];
    let to: [number, number];
    if (side === 'below') { from = [clamp(cx, bubble.x + 18, bubble.x + bw - 18), bubble.y]; to = [cx, box.y + box.h + 2]; }
    else if (side === 'above') { from = [clamp(cx, bubble.x + 18, bubble.x + bw - 18), bubble.y + bh]; to = [cx, box.y - 2]; }
    else if (side === 'right') { from = [bubble.x, cy]; to = [box.x + box.w + 2, cy]; }
    else { from = [bubble.x + bw, cy]; to = [box.x - 2, cy]; }
    return { box, bubble, side, from, to, label: m.label };
  });
}

/** A screenshot with red boxes, arrows and numbered explanations drawn over it (scales with the picture, like a PDF page) */
export function Annotated({ src, w, h, marks = [], onZoom, phone }: { src: string; w: number; h: number; marks?: GuideMark[]; onZoom?: () => void; phone?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const fs = phone ? 15 : 17;
  const laid = useMemo(() => layout(marks, w, h, fs), [marks, w, h, fs]);
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-white shadow-sm" style={{ aspectRatio: `${w} / ${h}` }}>
      <img src={src} width={w} height={h} loading="lazy" alt="" className="block h-full w-full" />
      <svg viewBox={`0 0 ${w} ${h}`} className="absolute inset-0 h-full w-full" aria-hidden onClick={onZoom} style={{ cursor: onZoom ? 'zoom-in' : undefined }}>
        <defs>
          <marker id={`ah${uid}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={RED} />
          </marker>
        </defs>
        {laid.map((m, i) => (
          <g key={i}>
            <rect x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} rx={9} fill="rgba(225,29,72,.07)" stroke="#fff" strokeWidth={8} />
            <rect x={m.box.x} y={m.box.y} width={m.box.w} height={m.box.h} rx={9} fill="none" stroke={RED} strokeWidth={3.5} />
            <line x1={m.from[0]} y1={m.from[1]} x2={m.to[0]} y2={m.to[1]} stroke="#fff" strokeWidth={8} strokeLinecap="round" />
            <line x1={m.from[0]} y1={m.from[1]} x2={m.to[0]} y2={m.to[1]} stroke={RED} strokeWidth={3.5} markerEnd={`url(#ah${uid})`} />
            <circle cx={m.box.x} cy={m.box.y} r={fs * 0.85} fill={RED} stroke="#fff" strokeWidth={3} />
            <text x={m.box.x} y={m.box.y} dy="0.36em" textAnchor="middle" fontSize={fs * 0.95} fontWeight={700} fill="#fff">{i + 1}</text>
            <foreignObject x={m.bubble.x} y={m.bubble.y - (m.side === 'above' ? 40 : 0)} width={m.bubble.w} height={m.bubble.h + 40}>
              <div style={{
                display: 'flex', height: '100%',
                alignItems: m.side === 'above' ? 'flex-end' : m.side === 'below' ? 'flex-start' : 'center',
                justifyContent: m.side === 'left' ? 'flex-end' : m.side === 'right' ? 'flex-start' : 'center',
                paddingBottom: m.side === 'above' ? 0 : 40,
              }}>
                <div style={{ background: RED, color: '#fff', fontSize: fs, lineHeight: 1.45, fontWeight: 600, borderRadius: 12, padding: '9px 13px', boxShadow: '0 6px 18px rgba(15,23,42,.28)', display: 'flex', gap: 8, alignItems: 'flex-start', border: '2px solid #fff' }}>
                  <span style={{ flex: 'none', width: fs * 1.45, height: fs * 1.45, borderRadius: 99, background: '#fff', color: RED, display: 'grid', placeItems: 'center', fontSize: fs * 0.85, fontWeight: 800 }}>{i + 1}</span>
                  <span>{m.label}</span>
                </div>
              </div>
            </foreignObject>
          </g>
        ))}
      </svg>
    </div>
  );
}
