import { useCallback, useEffect, useState } from 'react';
import { Archive, Download, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { apiError } from '@/api/client';
import { Button, IconButton } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { useDebounce } from '@/hooks';
import { fmtDateTime } from '@/lib/format';
import { confirmDialog, toast } from '@/store/ui';
import { archiveApi, ArchiveItem } from './api';
import { approvalsApi } from '@/modules/approvals/api';

const size = (b: number) => (b > 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Documents exported and saved earlier (who, when, with which answers / signers), downloadable again */
export function ArchiveDialog({ open, onClose, fileId }: { open: boolean; onClose: () => void; fileId: string }) {
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [total, setTotal] = useState(0);
  const [canDelete, setCanDelete] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(25);
  const q = useDebounce(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await archiveApi.list(fileId, { limit, search: q || undefined }); setItems(r.items); setTotal(r.total); setCanDelete(r.canDelete); }
    catch (e) { toast.error(apiError(e).message, 'โหลดรายการไม่สำเร็จ'); } finally { setLoading(false); }
  }, [fileId, limit, q]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const verify = async (it: ArchiveItem) => {
    try { const r = await archiveApi.verify(it.id); r.intact ? toast.success('ไฟล์ตรงกับที่บันทึกไว้', 'ไม่มีการแก้ไขหลังบันทึก') : toast.error(r.reason === 'missing' ? 'ไฟล์หายจากที่เก็บ' : 'ไฟล์ไม่ตรงกับที่บันทึกไว้', 'ตรวจสอบไม่ผ่าน'); }
    catch (e) { toast.error(apiError(e).message); }
  };
  const startApproval = async (it: ArchiveItem) => {
    try {
      const { flows } = await approvalsApi.flows(fileId);
      if (!flows.length) return toast.error('ยังไม่มีสายอนุมัติ — ให้ผู้จัดการไฟล์ตั้งค่าที่เมนู “สายอนุมัติเอกสาร…”');
      const pick = flows.length === 1 ? flows[0] : flows.find((f) => f.name === window.prompt(`เลือกสายอนุมัติ:\n${flows.map((x) => x.name).join('\n')}`, flows[0].name));
      if (!pick) return;
      await approvalsApi.start(it.id, pick.id);
      toast.success('ส่งเข้าสายอนุมัติแล้ว', pick.name);
    } catch (e) { toast.error(apiError(e).message, 'ส่งอนุมัติไม่สำเร็จ'); }
  };
  const remove = async (it: ArchiveItem) => {
    if (!(await confirmDialog({ title: `ลบ “${it.title}” ออกจากรายการ?`, message: 'ไฟล์จะไม่แสดงในรายการอีก (ผู้ดูแลระบบยังตรวจสอบย้อนหลังได้ในบันทึกกิจกรรม)', danger: true, confirmText: 'ลบ' }))) return;
    try { await archiveApi.remove(it.id); void load(); } catch (e) { toast.error(apiError(e).message); }
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" icon={<Archive className="h-5 w-5" />} title="เอกสารที่ออกแล้ว" description="สำเนา PDF ที่บันทึกไว้ตอน export" footer={<Button variant="secondary" onClick={onClose}>ปิด</Button>}>
      <div className="space-y-3">
        <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาชื่อเอกสาร / รูปแบบ / ผู้ออกเอกสาร" />
        {loading && !items.length ? <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : !items.length ? <EmptyState title="ยังไม่มีเอกสารที่บันทึกไว้" description="เลือก “บันทึกสำเนาเก็บเข้าระบบ” ในหน้าต่าง export" />
          : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{it.title}</p>
                    <p className="truncate text-xs text-muted">{fmtDateTime(it.createdAt)} · {it.createdByName ?? '-'} · {it.templateName ?? 'รายงานมาตรฐาน'} · {size(it.sizeBytes)}</p>
                    {!!it.meta.signers?.some((s) => s.name) && <p className="truncate text-xs text-muted">ลงนาม: {it.meta.signers.filter((s) => s.name).map((s) => `${s.label} ${s.name}`).join(' · ')}</p>}
                    {it.meta.note && <p className="truncate text-xs text-muted">หมายเหตุ: {it.meta.note}</p>}
                  </div>
                  <IconButton label="ส่งอนุมัติ (ลายเซ็น)" onClick={() => void startApproval(it)}><Send className="h-4 w-4" /></IconButton>
                  <IconButton label="ดาวน์โหลด" onClick={() => void archiveApi.download(it).catch((e) => toast.error(apiError(e).message))}><Download className="h-4 w-4" /></IconButton>
                  <IconButton label="ตรวจว่าไฟล์ไม่ถูกแก้ไข (SHA-256)" onClick={() => void verify(it)}><ShieldCheck className="h-4 w-4" /></IconButton>
                  {canDelete && <IconButton label="ลบออกจากรายการ" onClick={() => void remove(it)}><Trash2 className="h-4 w-4" /></IconButton>}
                </li>
              ))}
            </ul>
          )}
        {total > items.length && <div className="text-center"><Button variant="secondary" size="sm" onClick={() => setLimit((n) => n + 25)} loading={loading}>แสดงเพิ่ม ({items.length}/{total})</Button></div>}
      </div>
    </Modal>
  );
}
