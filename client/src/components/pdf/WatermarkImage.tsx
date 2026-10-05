import { useState } from 'react';
import { Upload, X } from 'lucide-react';
import { uploadsApi } from '@/api/endpoints';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';

/** Upload / clear the image used as a PDF watermark */
export function WatermarkImage({ url, onChange }: { url?: string; onChange: (u: string | undefined) => void }) {
  const [busy, setBusy] = useState(false);
  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { onChange((await uploadsApi.image(f)).url); } catch (e) { toast.error(e, 'อัปโหลดไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      {url && (
        <div className="relative inline-block">
          <img src={url} alt="" className="max-h-24 rounded-lg border border-line object-contain" />
          <button type="button" onClick={() => onChange(undefined)} className="absolute -right-2 -top-2 rounded-full bg-surface p-0.5 shadow ring-1 ring-line" aria-label="ลบรูป"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <label className={cn('flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-3 text-sm text-muted hover:border-primary/50 hover:text-primary', busy && 'opacity-50')}>
        <Upload className="h-4 w-4" />{busy ? 'กำลังอัปโหลด…' : url ? 'เปลี่ยนรูป' : 'อัปโหลดรูปลายน้ำ'}
        <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
    </div>
  );
}
