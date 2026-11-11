import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Copy, History, Layers, LayoutDashboard, MoveLeft, MoveRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { dashboardsApi, sheetsApi } from '@/api/endpoints';
import { cn } from '@/lib/cn';
import { confirmDialog, toast } from '@/store/ui';
import type { Sheet } from '@/types';
import { MetaModal } from '../files/Dialogs';
import { UnionDialog } from '../files/UnionDialog';
import { Anchor, MenuList, Popover } from '../ui/Popover';

export function SheetTabs({ fileId, sheets, activeId, dashboards, canManage, onSelect, onChanged, onRevisions }: {
  fileId: string; sheets: Sheet[]; activeId: string | null; dashboards: { id: string; name: string }[]; canManage: boolean;
  onSelect: (id: string) => void; onChanged: (selectId?: string) => void;
  /** ⋯ → Rev ของชีตนี้ (everyone who can open the file) */
  onRevisions?: (sheet: Sheet) => void;
}) {
  const nav = useNavigate();
  const [menu, setMenu] = useState<{ anchor: Anchor; sheet: Sheet } | null>(null);
  const [edit, setEdit] = useState<Sheet | 'new' | null>(null);
  const [dashOpen, setDashOpen] = useState(false);
  const [newDash, setNewDash] = useState(false);
  const dashBtn = useRef<HTMLButtonElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [union, setUnion] = useState(false);

  const reorder = async (s: Sheet, d: number) => {
    const ids = sheets.map((x) => x.id);
    const i = ids.indexOf(s.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    try { await sheetsApi.reorder(fileId, ids); onChanged(); } catch (e) { toast.error(e); }
  };
  const duplicate = async (s: Sheet) => {
    try { const n = await sheetsApi.create(fileId, { name: `${s.name} (สำเนา)`, copyStructureFrom: s.id }); toast.success('คัดลอกโครงสร้างชีตแล้ว'); onChanged(n.id); } catch (e) { toast.error(e); }
  };
  const remove = async (s: Sheet) => {
    if (!(await confirmDialog({ title: `ลบชีต “${s.name}”?`, message: 'ข้อมูลในชีตจะไม่แสดงอีก (ผู้ดูแลระบบกู้คืนได้จากฐานข้อมูล)', danger: true, confirmText: 'ลบชีต' }))) return;
    try { await sheetsApi.remove(s.id); toast.success('ลบชีตแล้ว'); onChanged(sheets.find((x) => x.id !== s.id)?.id); } catch (e) { toast.error(e); }
  };

  return (
    <div className="flex items-end gap-1 overflow-x-auto">
      {sheets.map((s) => (
        <button key={s.id} onClick={() => onSelect(s.id)} onDoubleClick={() => canManage && setEdit(s)}
          onContextMenu={(e) => { if (!canManage && !onRevisions) return; e.preventDefault(); setMenu({ anchor: { x: e.clientX, y: e.clientY }, sheet: s }); }}
          className={cn('group relative flex h-9 shrink-0 items-center gap-2 rounded-t-xl px-3 text-sm font-medium transition-colors sm:h-10 sm:px-4',
            s.id === activeId ? 'bg-surface text-ink shadow-[0_-1px_0_rgb(var(--c-border))]' : 'text-muted hover:bg-surface/60 hover:text-ink')}>
          {s.isUnion ? <Layers className="h-3.5 w-3.5 text-primary" /> : <span className="h-2 w-2 rounded-full" style={{ background: s.tabColor ?? 'rgb(var(--c-muted) / .5)' }} />}
          <span className="max-w-[130px] truncate sm:max-w-[180px]">{s.name}</span>
          {(canManage || (onRevisions && !s.isUnion)) && s.id === activeId && (
            <span role="button" tabIndex={-1} aria-label={`ตัวเลือกชีต ${s.name}`} onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, sheet: s }); }} className="rounded p-0.5 opacity-60 hover:bg-ink/10 hover:opacity-100">
              <ChevronDown className="h-3.5 w-3.5" />
            </span>
          )}
          {s.id === activeId && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full" style={{ background: s.tabColor ?? 'rgb(var(--c-primary))' }} />}
        </button>
      ))}
      {canManage && (
        <button ref={addBtn} onClick={() => setAddMenu(true)} className="mb-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-primary" title="เพิ่มชีต" aria-label="เพิ่มชีต">
          <Plus className="h-4 w-4" />
        </button>
      )}
      <div className="ml-auto flex shrink-0 items-center pb-1 pl-2 sm:pl-4">
        <button ref={dashBtn} onClick={() => setDashOpen(true)} aria-label="แดชบอร์ด" title="แดชบอร์ด" className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted hover:bg-surface hover:text-primary sm:gap-2 sm:px-3">
          <LayoutDashboard className="h-4 w-4" /> <span className="hidden sm:inline">แดชบอร์ด</span> {dashboards.length > 0 && <span className="rounded bg-ink/10 px-1.5 text-[11px]">{dashboards.length}</span>}<ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <Popover open={addMenu} onClose={() => setAddMenu(false)} anchor={addBtn.current} width={250}>
        <MenuList onClose={() => setAddMenu(false)} items={[
          { label: 'ชีตเปล่า', icon: <Plus />, onClick: () => setEdit('new') },
          { label: 'ชีตรวมข้อมูลจากชีตอื่น', icon: <Layers />, onClick: () => setUnion(true) },
        ]} />
      </Popover>
      <UnionDialog open={union} onClose={() => setUnion(false)} mode="sheet" fileId={fileId} onDone={(r) => onChanged(r.sheetId)} />
      <Popover open={dashOpen} onClose={() => setDashOpen(false)} anchor={dashBtn.current} placement="bottom-end" width={260}>
        <MenuList onClose={() => setDashOpen(false)} items={[
          ...dashboards.map((d) => ({ label: d.name, icon: <LayoutDashboard />, onClick: () => nav(`/files/${fileId}/dashboards/${d.id}`) })),
          ...(dashboards.length ? [] : [{ label: 'ยังไม่มีแดชบอร์ด', disabled: true }]),
          ...(canManage ? [{ divider: true }, { label: 'สร้างแดชบอร์ดใหม่', icon: <Plus />, onClick: () => setNewDash(true) }] : []),
        ]} />
      </Popover>
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} width={210}>
        {menu && <MenuList onClose={() => setMenu(null)} items={[
          ...(onRevisions && !menu.sheet.isUnion ? [{ label: 'Rev ของชีตนี้', icon: <History />, onClick: () => onRevisions(menu.sheet) }, ...(canManage ? [{ divider: true }] : [])] : []),
          ...(!canManage ? [] : [
          { label: 'เปลี่ยนชื่อ / สี', icon: <Pencil />, onClick: () => setEdit(menu.sheet) },
          ...(menu.sheet.isUnion ? [] : [{ label: 'คัดลอกโครงสร้าง', icon: <Copy />, onClick: () => void duplicate(menu.sheet) }]),
          { label: 'ย้ายไปทางซ้าย', icon: <MoveLeft />, onClick: () => void reorder(menu.sheet, -1) },
          { label: 'ย้ายไปทางขวา', icon: <MoveRight />, onClick: () => void reorder(menu.sheet, 1) },
          { divider: true },
          { label: 'ลบชีต', icon: <Trash2 />, danger: true, disabled: sheets.length <= 1, onClick: () => void remove(menu.sheet) },
          ]),
        ]} />}
      </Popover>
      <MetaModal open={!!edit} onClose={() => setEdit(null)} withDescription={false} title={edit === 'new' ? 'เพิ่มชีตใหม่' : 'แก้ไขชีต'}
        initial={edit && edit !== 'new' ? { name: edit.name, color: edit.tabColor } : { name: `Sheet${sheets.length + 1}`, color: '#1552F0' }}
        onSubmit={async (v) => {
          if (edit === 'new') { const s = await sheetsApi.create(fileId, { name: v.name, tabColor: v.color }); toast.success('เพิ่มชีตแล้ว', 'เริ่มต้นด้วย 1 คอลัมน์ ปรับได้ที่ “คอลัมน์”'); onChanged(s.id); }
          else if (edit) { await sheetsApi.update(edit.id, { name: v.name, tabColor: v.color }); onChanged(); }
        }} />
      <MetaModal open={newDash} onClose={() => setNewDash(false)} withDescription={false} title="สร้างแดชบอร์ด" initial={{ name: 'แดชบอร์ดใหม่', color: '#1552F0' }}
        onSubmit={async (v) => { const d = await dashboardsApi.create(fileId, v.name); nav(`/files/${fileId}/dashboards/${d.id}?edit=1`); }} />
    </div>
  );
}
