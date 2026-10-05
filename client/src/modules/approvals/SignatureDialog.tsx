import { useEffect, useRef, useState } from 'react';
import { PenLine, Upload } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/store/ui';
import { approvalsApi } from './api';

/** Draw (mouse / finger) or upload the signature that is stamped onto PDFs the user approves */
export function SignatureDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setDirty(false); approvalsApi.getSignature().then((r) => setCurrent(r.image)).catch(() => setCurrent(null)); } }, [open]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = cv.current!; const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = cv.current!.getContext('2d')!; const p = pos(e);
    cv.current!.setPointerCapture(e.pointerId);
    drawing.current = true; g.lineWidth = 3; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827';
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + 0.1, p.y + 0.1); g.stroke();
    setDirty(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const g = cv.current!.getContext('2d')!; const p = pos(e); g.lineTo(p.x, p.y); g.stroke();
  };
  const up = () => { drawing.current = false; };
  const clear = () => { const c = cv.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setDirty(false); };

  const fromFile = async (f?: File) => {
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const c = cv.current!; const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      const k = Math.min(c.width / bmp.width, c.height / bmp.height);
      g.drawImage(bmp, (c.width - bmp.width * k) / 2, (c.height - bmp.height * k) / 2, bmp.width * k, bmp.height * k);
      setDirty(true);
    } catch { toast.error('อ่านรูปไม่ได้'); }
  };
  const save = async () => {
    setBusy(true);
    try { await approvalsApi.saveSignature(cv.current!.toDataURL('image/png')); toast.success('บันทึกลายเซ็นแล้ว'); onSaved?.(); onClose(); }
    catch (e) { toast.error(apiError(e).message, 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" icon={<PenLine className="h-5 w-5" />} title="ลายเซ็นของฉัน" description="เซ็นในกรอบ หรืออัปโหลดรูปลายเซ็น (พื้นหลังโปร่งใสจะสวยที่สุด) — ระบบจะประทับลงใน PDF เมื่อคุณกดอนุมัติ"
      footer={<><Button variant="secondary" onClick={onClose}>ปิด</Button><Button onClick={() => void save()} loading={busy} disabled={!dirty}>บันทึกลายเซ็น</Button></>}>
      <div className="space-y-3">
        {current && !dirty && <div><p className="mb-1 text-xs text-muted">ลายเซ็นปัจจุบัน</p><img src={current} alt="" className="h-20 rounded-lg border border-line bg-white object-contain" /></div>}
        <canvas ref={cv} width={600} height={240} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          className="w-full touch-none rounded-xl border-2 border-dashed border-line bg-white" style={{ aspectRatio: '600 / 240' }} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={clear}>ล้าง</Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium hover:border-primary/40"><Upload className="h-4 w-4" />อัปโหลดรูป
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
      </div>
    </Modal>
  );
}
