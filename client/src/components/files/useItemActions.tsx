import { MouseEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookMarked, Copy, ExternalLink, FolderCog, FolderInput, KeyRound, Pencil, Share2, Trash2 } from 'lucide-react';
import { filesApi, foldersApi } from '@/api/endpoints';
import { useAuth } from '@/store/auth';
import { useData } from '@/store/data';
import { confirmDialog, toast } from '@/store/ui';
import { LV, isAdminRole, isBasicRole } from '@/types';
import { docTypeOf, FileDocTypeModal, FolderDocTypeModal } from '@/modules/revisions/docTypes';
import { Anchor, MenuItemDef, MenuList, Popover } from '../ui/Popover';
import { DuplicateDialog, MetaModal, MoveDialog, RequestAccessDialog, ShareDialog } from './Dialogs';
import type { Item } from './ItemViews';

/** Context menu + dialogs shared by folder / home / search views */
export function useItemActions(reload: () => void) {
  const nav = useNavigate();
  const role = useAuth((s) => s.user?.role);
  const [menu, setMenu] = useState<{ anchor: Anchor; item: Item } | null>(null);
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'move' | 'share' | 'dup' | 'request' | 'doctype'; item: Item } | null>(null);

  const openMenu = (e: MouseEvent, item: Item) => setMenu({ anchor: { x: e.clientX, y: e.clientY }, item });
  const star = async (item: Item) => {
    const r = await useData.getState().toggleFavorite(item.kind, item.data.id);
    if (r !== null) reload();
  };
  const remove = async (item: Item) => {
    const ok = await confirmDialog({
      title: `ลบ “${item.data.name}”?`, danger: true, confirmText: 'ย้ายไปถังขยะ',
      message: item.kind === 'folder' ? 'โฟลเดอร์ย่อยและไฟล์ทั้งหมดภายในจะถูกย้ายไปถังขยะด้วย และกู้คืนได้ภายในระยะเวลาที่กำหนด' : 'ไฟล์จะถูกย้ายไปถังขยะและสามารถกู้คืนได้',
    });
    if (!ok) return;
    try {
      if (item.kind === 'folder') await foldersApi.remove(item.data.id); else await filesApi.remove(item.data.id);
      toast.success('ย้ายไปถังขยะแล้ว');
      void useData.getState().loadTree();
      reload();
    } catch (e) { toast.error(e); }
  };

  const items = (it: Item): MenuItemDef[] => {
    const lvl = it.data.level;
    const manage = lvl >= LV.manage;
    const out: MenuItemDef[] = [
      { label: 'เปิด', icon: <ExternalLink />, onClick: () => nav(it.kind === 'folder' ? `/folders/${it.data.id}` : `/files/${it.data.id}`) },
    ];
    if (lvl < LV.write || (it.kind === 'file' && lvl < LV.manage && !isBasicRole(role)))
      out.push({ label: 'ขอสิทธิ์เพิ่ม', icon: <KeyRound />, onClick: () => setDialog({ kind: 'request', item: it }) });
    if (manage) {
      out.push({ divider: true }, { label: 'เปลี่ยนชื่อ / สี', icon: <Pencil />, onClick: () => setDialog({ kind: 'rename', item: it }) },
        { label: 'แชร์และสิทธิ์', icon: <Share2 />, onClick: () => setDialog({ kind: 'share', item: it }) },
        { label: 'ย้าย', icon: <FolderInput />, onClick: () => setDialog({ kind: 'move', item: it }) });
    }
    if (it.kind === 'file' && lvl >= LV.read && !isBasicRole(role)) out.push({ label: 'ทำสำเนา', icon: <Copy />, onClick: () => setDialog({ kind: 'dup', item: it }) });
    // ประเภทเอกสาร: a file (Master and up who manage it) · every file of a folder (admin)
    if (it.kind === 'file' && manage && !isBasicRole(role)) out.push({ label: `ประเภทเอกสาร: ${docTypeOf(it.data.docType).short}`, icon: <BookMarked />, onClick: () => setDialog({ kind: 'doctype', item: it }) });
    if (it.kind === 'folder' && manage && isAdminRole(role)) out.push({ label: 'ตั้งประเภทเอกสารทั้งโฟลเดอร์', icon: <FolderCog />, onClick: () => setDialog({ kind: 'doctype', item: it }) });
    if (manage) out.push({ divider: true }, { label: 'ลบ', icon: <Trash2 />, danger: true, onClick: () => void remove(it) });
    return out;
  };

  const d = dialog?.item;
  const target = d ? { type: d.kind, id: d.data.id, name: d.data.name } : null;
  const ui = (
    <>
      <Popover open={!!menu} onClose={() => setMenu(null)} anchor={menu?.anchor ?? null} width={220}>
        {menu && <MenuList items={items(menu.item)} onClose={() => setMenu(null)} />}
      </Popover>
      {d && (
        <MetaModal open={dialog?.kind === 'rename'} onClose={() => setDialog(null)} title={d.kind === 'folder' ? 'แก้ไขโฟลเดอร์' : 'แก้ไขไฟล์'}
          initial={{ name: d.data.name, color: d.data.color, description: d.data.description ?? null }}
          onSubmit={async (v) => {
            if (d.kind === 'folder') await foldersApi.update(d.data.id, v); else await filesApi.update(d.data.id, v);
            toast.success('บันทึกแล้ว');
            void useData.getState().loadTree();
            reload();
          }} />
      )}
      <MoveDialog open={dialog?.kind === 'move'} onClose={() => setDialog(null)} item={target} onDone={reload} />
      <ShareDialog open={dialog?.kind === 'share'} onClose={() => setDialog(null)} target={target} />
      <RequestAccessDialog open={dialog?.kind === 'request'} onClose={() => setDialog(null)} target={target} />
      <FileDocTypeModal file={dialog?.kind === 'doctype' && d?.kind === 'file' ? { id: d.data.id, name: d.data.name, docType: d.data.docType } : null} onClose={() => setDialog(null)} onSaved={reload} />
      <FolderDocTypeModal folder={dialog?.kind === 'doctype' && d?.kind === 'folder' ? { id: d.data.id, name: d.data.name } : null} onClose={() => setDialog(null)} onSaved={reload} />
      <DuplicateDialog open={dialog?.kind === 'dup'} onClose={() => setDialog(null)}
        file={d?.kind === 'file' ? { id: d.data.id, name: d.data.name, folderId: d.data.folderId } : null}
        onDone={(id) => { reload(); nav(`/files/${id}`); }} />
    </>
  );
  return { openMenu, star, ui, openDialog: setDialog };
}
