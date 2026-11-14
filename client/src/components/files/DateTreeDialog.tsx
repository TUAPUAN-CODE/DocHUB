import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { foldersApi } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, Toggle } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { toast } from '@/store/ui';

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Makes <year> / "01 มกราคม" … / "01" … "31" under a folder in one go (only what is missing) */
export function DateTreeDialog({ folder, open, onClose, onDone }: { folder: { id: string; name: string } | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [days, setDays] = useState(true);
  const [months, setMonths] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setYear(String(new Date().getFullYear())); setDays(true); setMonths([]); } }, [open]);
  const y = Number(year);
  const ok = Number.isInteger(y) && y >= 2000 && y <= 2100;
  const submit = async () => {
    if (!folder || !ok) return;
    setBusy(true);
    try {
      const r = await foldersApi.dateTree(folder.id, { year: y, days, months: months.length ? months : undefined });
      toast.success(r.made ? `สร้างแล้ว ${r.made.toLocaleString()} โฟลเดอร์` : 'มีครบอยู่แล้ว ไม่ได้สร้างเพิ่ม');
      onDone(); onClose();
    } catch (e) { toast.error(e, 'สร้างไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="md" icon={<CalendarDays className="h-5 w-5" />} title="สร้างโฟลเดอร์ ปี / เดือน / วัน"
      description={folder ? `ใน “${folder.name}” — สร้างเฉพาะที่ยังไม่มี` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>ยกเลิก</Button><Button onClick={() => void submit()} loading={busy} disabled={!ok}>สร้าง</Button></>}>
      <div className="space-y-4">
        <Field label="ปี (ค.ศ.)" required hint="เช่น 2027"><TextInput type="number" inputMode="numeric" min={2000} max={2100} value={year} onChange={(e) => setYear(e.target.value)} autoFocus /></Field>
        <Field group label="เดือน" hint="ไม่เลือก = ครบ 12 เดือน">
          <div className="grid grid-cols-6 gap-1.5">
            {MONTHS.map((m, i) => {
              const on = months.includes(i + 1);
              return <button key={m} type="button" aria-pressed={on} onClick={() => setMonths(on ? months.filter((x) => x !== i + 1) : [...months, i + 1])}
                className={cn('rounded-lg border py-1.5 text-xs font-medium', on ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted hover:bg-ink/5')}>{m}</button>;
            })}
          </div>
        </Field>
        <Toggle checked={days} onChange={setDays} label="สร้างโฟลเดอร์วัน 01–31 ในแต่ละเดือนด้วย" />
        <p className="rounded-lg bg-ink/[.04] px-3 py-2 text-xs text-muted">ตัวอย่าง: {ok ? y : 'ปี'} › 01 มกราคม{days ? ' › 01 … 31' : ''}</p>
      </div>
    </Modal>
  );
}
