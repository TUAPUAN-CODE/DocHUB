import { isAdminRole } from '@/types';
import { RotateCcw, Trash2 } from 'lucide-react';
import { trashApi } from '@/api/endpoints';
import { FileGlyph, FolderGlyph } from '@/components/files/icons';
import { Page } from '@/components/layout/AppShell';
import { Button } from '@/components/ui/Button';
import { EmptyState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useLoad } from '@/hooks';
import { fmtDateTime, relTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';

export default function TrashPage() {
  const isAdmin = useAuth((s) => isAdminRole(s.user?.role));
  const { data, loading, reload } = useLoad(() => trashApi.list(), []);
  const restore = async (type: 'file' | 'folder', id: string) => {
    try { await trashApi.restore(type, id); toast.success('กู้คืนแล้ว'); void useData.getState().loadTree(); void reload(true); } catch (e) { toast.error(e); }
  };
  const purge = async (type: 'file' | 'folder', id: string, name: string) => {
    if (!(await confirmDialog({ title: `ลบ “${name}” ถาวร?`, message: 'ข้อมูล ประวัติ และแดชบอร์ดทั้งหมดจะถูกลบและกู้คืนไม่ได้', danger: true, confirmText: 'ลบถาวร' }))) return;
    try { await trashApi.purge(type, id); toast.success('ลบถาวรแล้ว'); void reload(true); } catch (e) { toast.error(e); }
  };
  return (
    <Page>
      <PageHeader icon={<Trash2 />} title="ถังขยะ" subtitle={data ? `รายการจะถูกลบถาวรอัตโนมัติหลัง ${data.retentionDays} วัน` : ''} />
      {loading ? <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-theme" />)}</div>
        : !data?.items.length ? <div className="ds-card"><EmptyState icon={<Trash2 />} title="ถังขยะว่าง" description="ไฟล์และโฟลเดอร์ที่ถูกลบจะอยู่ที่นี่ก่อนถูกลบถาวร" /></div>
        : (
          <div className="overflow-x-auto">
            <table className="row-table min-w-[720px]">
              <thead><tr><th>ชื่อ</th><th>ลบเมื่อ</th><th>ลบโดย</th><th>ลบถาวร</th><th /></tr></thead>
              <tbody>
                {data.items.map((it) => (
                  <tr key={it.type + it.id}>
                    <td><div className="flex items-center gap-3">{it.type === 'folder' ? <FolderGlyph color={it.color} size={32} /> : <FileGlyph color={it.color} size={30} />}
                      <span className="min-w-0"><span className="block truncate font-medium">{it.name}</span><span className="block truncate text-xs text-muted">{it.detail}</span></span></div></td>
                    <td className="text-[13px] text-muted">{fmtDateTime(it.deletedAt)}</td>
                    <td className="text-[13px]">{it.deletedByName ?? '—'}</td>
                    <td className="text-[13px] text-muted">{relTime(it.purgeAt)}</td>
                    <td className="text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} disabled={it.blocked} title={it.blocked ? 'กู้คืนโฟลเดอร์ต้นทางก่อน' : undefined} onClick={() => restore(it.type, it.id)}>กู้คืน</Button>
                        {isAdmin && <Button size="sm" variant="ghost" className="text-danger" onClick={() => purge(it.type, it.id, it.name)}>ลบถาวร</Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </Page>
  );
}
