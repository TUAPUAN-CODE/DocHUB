import { useEffect, useState } from 'react';
import { BookMarked, ClipboardList, FileQuestion, FolderCog } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';
import { DocType, docTypesApi } from './api';

/** ประเภทเอกสาร (docs/NEWS_TAGS_ROOT.md): how revisions work for a file */
export const DOC_TYPES: { v: DocType; label: string; short: string; color: string; icon: JSX.Element; hint: string }[] = [
  { v: 'master_data', label: 'Master Data (ข้อมูลหลัก)', short: 'Master Data', color: '#7C3AED', icon: <BookMarked className="h-5 w-5" />,
    hint: 'ข้อมูลอ้างอิงที่ต้องควบคุม เช่น Quality Highlight, ตาราง Program — แก้ข้อมูลแล้วระบบเตือนให้ออก Rev ใหม่' },
  { v: 'record', label: 'แบบฟอร์มบันทึก', short: 'แบบฟอร์มบันทึก', color: '#0E9F6E', icon: <ClipboardList className="h-5 w-5" />,
    hint: 'ฟอร์มที่ลงข้อมูลทุกวัน เช่น ใบตรวจ Metal Detector — ออก Rev เมื่อแก้รูปแบบฟอร์ม (ข้อมูลที่ลงไม่ต้องออก Rev) และทุกแถวจำว่าลงด้วยแบบฟอร์ม Rev ไหน' },
  { v: null, label: 'ทั่วไป', short: 'ทั่วไป', color: '#64748B', icon: <FileQuestion className="h-5 w-5" />,
    hint: 'ไม่ติดตาม Rev อัตโนมัติ (ยังออก Rev เองได้) — ไฟล์เดิมทั้งหมดเริ่มที่ประเภทนี้' },
];
export const docTypeOf = (v: DocType | undefined) => DOC_TYPES.find((t) => t.v === (v ?? null))!;

/** small label on a file card / file header (nothing for ทั่วไป) */
export function DocTypeBadge({ type, className }: { type: DocType | undefined; className?: string }) {
  if (!type) return null;
  const t = docTypeOf(type);
  return (
    <span className={cn('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', className)} style={{ color: t.color, background: `${t.color}1a` }} title={t.hint}>
      {t.short}
    </span>
  );
}

/** three cards to choose from */
export function DocTypePicker({ value, onChange }: { value: DocType | undefined; onChange: (v: DocType) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="ประเภทเอกสาร">
      {DOC_TYPES.map((t) => {
        const on = value !== undefined && (value ?? null) === t.v;
        return (
          <button key={String(t.v)} type="button" role="radio" aria-checked={on} onClick={() => onChange(t.v)}
            className={cn('flex flex-col gap-1.5 rounded-2xl border p-3 text-left transition-colors', on ? 'border-2' : 'border-line hover:border-ink/30')}
            style={on ? { borderColor: t.color, background: `${t.color}0d` } : undefined}>
            <span className="flex items-center gap-2 font-semibold" style={{ color: t.color }}>{t.icon}<span className="text-ink">{t.label}</span></span>
            <span className="text-xs leading-relaxed text-muted">{t.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

/** ⋯ → ประเภทเอกสาร (a file) */
export function FileDocTypeModal({ file, onClose, onSaved }: { file: { id: string; name: string; docType?: DocType } | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<DocType | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (file) setV(file.docType ?? null); }, [file]);
  const save = async () => {
    if (!file || v === undefined) return;
    setBusy(true);
    try {
      const r = await docTypesApi.setFile(file.id, v);
      toast.success('บันทึกประเภทเอกสารแล้ว', r.firstRevs ? `ออก Rev เริ่มต้นให้ ${r.firstRevs} ชีต` : undefined);
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!file} onClose={onClose} size="lg" icon={<BookMarked className="h-5 w-5" />} title="ประเภทเอกสาร" description={file ? `“${file.name}” — กำหนดว่า Rev ของไฟล์นี้ทำงานแบบไหน` : ''}
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void save()} loading={busy} disabled={v === undefined || (file?.docType ?? null) === v}>บันทึก</Button></>}>
      <DocTypePicker value={v} onChange={setV} />
      <p className="mt-3 text-xs text-muted">เปลี่ยนเป็น Master Data หรือแบบฟอร์มบันทึกแล้ว ชีตที่ยังไม่เคยออก Rev จะได้ <b>Rev เริ่มต้น</b> อัตโนมัติ เพื่อเป็นจุดเริ่มเทียบการเปลี่ยนแปลง · ไม่แก้ข้อมูลในไฟล์</p>
    </Modal>
  );
}

/** ⋯ → ตั้งประเภทเอกสารทั้งโฟลเดอร์ (admin) */
export function FolderDocTypeModal({ folder, onClose, onSaved }: { folder: { id: string; name: string } | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<DocType | undefined>(undefined);
  const [sub, setSub] = useState(true);
  const [onlyUntyped, setOnlyUntyped] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (folder) { setV(undefined); setSub(true); setOnlyUntyped(true); } }, [folder]);
  const save = async () => {
    if (!folder || v === undefined) return;
    setBusy(true);
    try {
      const r = await docTypesApi.setFolder(folder.id, { docType: v, includeSubfolders: sub, onlyUntyped });
      toast.success(`ตั้งประเภทให้ ${r.files} ไฟล์แล้ว`, r.firstRevs ? `ออก Rev เริ่มต้น ${r.firstRevs} ชีต` : undefined);
      onSaved();
      onClose();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!folder} onClose={onClose} size="lg" icon={<FolderCog className="h-5 w-5" />} title="ตั้งประเภทเอกสารทั้งโฟลเดอร์" description={folder ? `ไฟล์ในโฟลเดอร์ “${folder.name}”` : ''}
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void save()} loading={busy} disabled={v === undefined}>ตั้งประเภท</Button></>}>
      <DocTypePicker value={v} onChange={setV} />
      <div className="mt-3 flex flex-col gap-2">
        <Checkbox checked={sub} onChange={setSub} label="รวมไฟล์ในโฟลเดอร์ย่อยด้วย" />
        <Checkbox checked={onlyUntyped} onChange={setOnlyUntyped} label="เฉพาะไฟล์ที่ยังเป็น “ทั่วไป” (ไม่เปลี่ยนไฟล์ที่ตั้งไว้แล้ว)" />
      </div>
    </Modal>
  );
}
