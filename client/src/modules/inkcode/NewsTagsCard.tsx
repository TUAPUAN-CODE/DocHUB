import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone } from 'lucide-react';
import { tagsApi } from '@/api/endpoints';
import { Button } from '@/components/ui/Button';
import { TagPicker } from '@/components/ui/TagChip';
import { toast } from '@/store/ui';
import type { TagRef } from '@/types';
import { inkNewsApi } from './api';

/**
 * Who is told on the news board when an imported plan has New Code products (QC checks 100 %): the tags picked here
 * (default: Ink). People are put in a tag on จัดการผู้ใช้ › Tag.
 */
export function NewsTagsCard() {
  const [tags, setTags] = useState<TagRef[]>([]);
  const [value, setValue] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([tagsApi.list(), inkNewsApi.get()])
      .then(([t, s]) => { setTags(t.filter((x) => !x.isSystem)); setValue(s.tagIds); setSaved(s.tagIds); })
      .catch((e) => toast.error(e, 'โหลด Tag ไม่สำเร็จ'));
  }, []);
  const dirty = value !== null && [...value].sort().join() !== [...saved].sort().join();
  const save = async () => {
    if (!value) return;
    setBusy(true);
    try { const r = await inkNewsApi.set(value); setSaved(r.tagIds); toast.success('บันทึกแล้ว', 'แผนที่นำเข้าครั้งถัดไปจะโพสต์ข่าวถึง Tag เหล่านี้'); }
    catch (e) { toast.error(e, 'บันทึกไม่สำเร็จ'); } finally { setBusy(false); }
  };
  return (
    <div className="ds-card mb-4 space-y-2 p-4">
      <div className="flex items-start gap-2">
        <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">ข่าว New Code ตรวจ 100%</p>
          <p className="text-sm text-muted">แผนที่มีสินค้า New Code (Remark ใน Master) ระบบโพสต์รายการที่ <Link to="/news" className="text-primary hover:underline">ข่าวสาร</Link> ถึงคนใน Tag ที่เลือก (ขึ้นกระดิ่งแจ้งเตือนด้วย) · ใส่คนเข้า Tag ได้ที่ จัดการผู้ใช้ › Tag</p>
        </div>
      </div>
      {value === null ? <p className="text-sm text-muted">กำลังโหลด…</p> : <TagPicker tags={tags} value={value} onChange={setValue} />}
      {value !== null && !value.length && <p className="text-xs text-amber-600">ไม่ได้เลือก Tag — จะไม่โพสต์ข่าว</p>}
      {dirty && <Button size="sm" onClick={() => void save()} loading={busy}>บันทึก</Button>}
    </div>
  );
}
