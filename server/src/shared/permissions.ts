import { broadcast, onBroadcast } from '../services/cluster';
import { env } from '../config/env';
import { q, q1, Tx } from '../config/db';
import { AuthUser } from '../middleware/auth';
import { forbidden, notFound } from './http';

/**
 * Permission levels.
 *  read   – view data
 *  write  – enter / edit data
 *  manage – change structure (sheets, columns), share, delete, dashboards
 *
 * Effective level = max(owner, direct file grant, folder grant inherited from any ancestor,
 * creator of any ancestor folder — grants to the user's tags count as the user's own) capped by role (role "user" can never exceed write).
 * Admin is always manage.
 */
export const LV = { none: 0, read: 1, write: 2, manage: 3 } as const;
export type PermName = 'read' | 'write' | 'manage';
export const PERM_NAMES = ['none', 'read', 'write', 'manage'] as const;
export const toLevel = (p?: string | null): number => (p && p in LV ? LV[p as keyof typeof LV] : 0);
export const levelName = (l: number) => PERM_NAMES[Math.max(0, Math.min(3, l))];
const LEVEL_TH = ['ไม่มีสิทธิ์', 'ดูข้อมูล', 'แก้ไขข้อมูล', 'จัดการ'];

export interface FolderNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sortOrder: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FolderIndex {
  map: Map<string, FolderNode>;
  children: Map<string | null, string[]>;
}

let folderCache: { at: number; index: FolderIndex } | null = null;
onBroadcast('folders', () => { folderCache = null; });
export const invalidateFolders = () => {
  folderCache = null;
  broadcast('folders');
};

export async function getFolderIndex(): Promise<FolderIndex> {
  if (folderCache && Date.now() - folderCache.at < 5000) return folderCache.index;
  const rows = await q(
    `SELECT folder_id, parent_id, folder_name, description, color, icon, sort_order, created_by, created_at, updated_at
     FROM Folders WHERE is_deleted = 0`,
  );
  const map = new Map<string, FolderNode>();
  for (const r of rows) {
    map.set(r.folder_id, {
      id: r.folder_id,
      parentId: r.parent_id,
      name: r.folder_name,
      description: r.description,
      color: r.color,
      icon: r.icon,
      sortOrder: r.sort_order,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    });
  }
  const children = new Map<string | null, string[]>();
  for (const f of map.values()) {
    const parent = f.parentId && map.has(f.parentId) ? f.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(f.id);
  }
  const index = { map, children };
  folderCache = { at: Date.now(), index };
  return index;
}

export interface FileRef {
  file_id: string;
  folder_id: string;
  created_by: string;
}

export class PermCtx {
  private memo = new Map<string, number>();
  private anchors: Set<string> | null = null;

  constructor(
    public readonly user: AuthUser,
    public readonly index: FolderIndex,
    private readonly folderGrants: Map<string, number>,
    private readonly fileGrants: Map<string, number>,
  ) {}

  static async load(user: AuthUser): Promise<PermCtx> {
    const index = await getFolderIndex();
    if (user.role === 'admin') return new PermCtx(user, index, new Map(), new Map());
    // own grants + grants to any tag the user has (the higher level wins)
    const [fg, fi] = await Promise.all([
      q(
        `SELECT folder_id, permission FROM FolderAccess
         WHERE user_id = @u AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())
         UNION ALL
         SELECT ta.folder_id, ta.permission FROM FolderTagAccess ta JOIN UserTags ut ON ut.tag_id = ta.tag_id
         WHERE ut.user_id = @u AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`,
        { u: user.id },
      ),
      q(
        `SELECT file_id, permission FROM FileAccess
         WHERE user_id = @u AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())
         UNION ALL
         SELECT ta.file_id, ta.permission FROM FileTagAccess ta JOIN UserTags ut ON ut.tag_id = ta.tag_id
         WHERE ut.user_id = @u AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`,
        { u: user.id },
      ),
    ]);
    const maxMap = (rows: any[], key: string) => {
      const m = new Map<string, number>();
      for (const r of rows) m.set(r[key], Math.max(m.get(r[key]) ?? 0, toLevel(r.permission)));
      return m;
    };
    return new PermCtx(user, index, maxMap(fg, 'folder_id'), maxMap(fi, 'file_id'));
  }

  get isAdmin() {
    return this.user.role === 'admin';
  }

  private cap(l: number) {
    if (this.user.role === 'viewer') return Math.min(l, LV.read);
    return this.user.role === 'user' ? Math.min(l, LV.write) : l;
  }

  private rawFolder(id: string | null | undefined): number {
    if (!id) return 0;
    const m = this.memo.get(id);
    if (m !== undefined) return m;
    const f = this.index.map.get(id);
    if (!f) return 0;
    this.memo.set(id, 0); // cycle guard
    let l = this.folderGrants.get(id) ?? 0;
    if (f.createdBy === this.user.id) l = LV.manage;
    l = Math.max(l, this.rawFolder(f.parentId));
    this.memo.set(id, l);
    return l;
  }

  folderLevel(id: string | null | undefined): number {
    if (this.isAdmin) return LV.manage;
    return this.cap(this.rawFolder(id));
  }

  fileLevel(f: FileRef): number {
    if (this.isAdmin) return LV.manage;
    let l = f.created_by === this.user.id ? LV.manage : 0;
    l = Math.max(l, this.fileGrants.get(f.file_id) ?? 0, this.rawFolder(f.folder_id));
    return this.cap(l);
  }

  /** Ancestors from root down to (and including) the folder */
  path(id: string): FolderNode[] {
    const out: FolderNode[] = [];
    const seen = new Set<string>();
    let cur = this.index.map.get(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      out.unshift(cur);
      cur = cur.parentId ? this.index.map.get(cur.parentId) : undefined;
    }
    return out;
  }

  pathText(id: string) {
    return this.path(id)
      .map((f) => f.name)
      .join(' / ');
  }

  /** The folder and all folders below it */
  descendants(id: string): string[] {
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.includes(cur)) continue;
      out.push(cur);
      stack.push(...(this.index.children.get(cur) ?? []));
    }
    return out;
  }

  /**
   * Returns a predicate telling whether a folder should appear in navigation.
   * With SHOW_LOCKED_ITEMS=true every folder is visible (locked ones show a padlock).
   */
  async visibility(): Promise<(folderId: string) => boolean> {
    if (env.showLockedItems || this.isAdmin) return () => true;
    if (!this.anchors) {
      const anchors = new Set<string>();
      for (const [fid] of this.folderGrants) anchors.add(fid);
      for (const f of this.index.map.values()) if (f.createdBy === this.user.id) anchors.add(f.id);
      const fileIds = [...this.fileGrants.keys()];
      const rows = await q(
        `SELECT DISTINCT folder_id FROM Files WHERE is_deleted = 0
         AND (created_by = @u OR file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)))`,
        { u: this.user.id, ids: JSON.stringify(fileIds) },
      );
      for (const r of rows) anchors.add(r.folder_id);
      const withAncestors = new Set<string>();
      for (const a of anchors) for (const p of this.path(a)) withAncestors.add(p.id);
      this.anchors = withAncestors;
    }
    const anchors = this.anchors;
    return (id: string) => anchors.has(id) || this.folderLevel(id) >= LV.read;
  }
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */
function denied(level: number, min: number, target: { type: 'file' | 'folder'; id: string; name: string }) {
  if (level === 0)
    return forbidden(
      target.type === 'file' ? 'คุณยังไม่มีสิทธิ์เข้าถึงไฟล์นี้' : 'คุณยังไม่มีสิทธิ์เข้าถึงโฟลเดอร์นี้',
      'NO_ACCESS',
      { targetType: target.type, targetId: target.id, name: target.name, currentLevel: levelName(level) },
    );
  return forbidden(`ต้องมีสิทธิ์ระดับ "${LEVEL_TH[min]}" เพื่อดำเนินการนี้`, 'INSUFFICIENT_LEVEL', {
    targetType: target.type,
    targetId: target.id,
    name: target.name,
    currentLevel: levelName(level),
    requiredLevel: levelName(min),
  });
}

export async function getFileRow(fileId: string, tx?: Tx) {
  return q1(
    `SELECT f.*, fo.folder_name FROM Files f JOIN Folders fo ON fo.folder_id = f.folder_id
     WHERE f.file_id = @id AND f.is_deleted = 0`,
    { id: fileId },
    tx,
  );
}

export async function requireFile(user: AuthUser, fileId: string, min: number) {
  const file = await getFileRow(fileId);
  if (!file) throw notFound('ไม่พบไฟล์ หรือไฟล์ถูกลบแล้ว');
  const ctx = await PermCtx.load(user);
  const level = ctx.fileLevel(file);
  if (level < min) throw denied(level, min, { type: 'file', id: file.file_id, name: file.file_name });
  return { file, level, ctx };
}

export async function requireFolder(user: AuthUser, folderId: string, min: number) {
  const ctx = await PermCtx.load(user);
  const folder = ctx.index.map.get(folderId);
  if (!folder) throw notFound('ไม่พบโฟลเดอร์ หรือโฟลเดอร์ถูกลบแล้ว');
  const level = ctx.folderLevel(folderId);
  if (level < min) throw denied(level, min, { type: 'folder', id: folder.id, name: folder.name });
  return { folder, level, ctx };
}

/**
 * `allowUnion`: management actions that make sense on a union sheet (rename, delete). Every write to its data or
 * structure is refused: the rows belong to the source sheets and are mirrored automatically.
 */
export async function requireSheet(user: AuthUser, sheetId: string, min: number, tx?: Tx, allowUnion = false) {
  const sheet = await q1(
    `SELECT s.*, f.folder_id, f.created_by AS file_created_by, f.file_name
     FROM Sheets s JOIN Files f ON f.file_id = s.file_id
     WHERE s.sheet_id = @id AND s.is_deleted = 0 AND f.is_deleted = 0`,
    { id: sheetId },
    tx,
  );
  if (!sheet) throw notFound('ไม่พบชีต หรือชีตถูกลบแล้ว');
  const ctx = await PermCtx.load(user);
  const level = ctx.fileLevel({ file_id: sheet.file_id, folder_id: sheet.folder_id, created_by: sheet.file_created_by });
  if (level < min) throw denied(level, min, { type: 'file', id: sheet.file_id, name: sheet.file_name });
  if (min >= LV.write && sheet.union_config && !allowUnion)
    throw forbidden('ชีตนี้รวมข้อมูลจากชีตอื่นอัตโนมัติ แก้ไขไม่ได้ กรุณาแก้ที่ไฟล์ต้นทาง', 'UNION_READONLY');
  return { sheet, level, ctx };
}

/** User ids who can approve requests / should be notified about a file or folder */
export async function managersOf(target: { type: 'file' | 'folder'; id: string }): Promise<string[]> {
  const index = await getFolderIndex();
  const ids = new Set<string>();
  let folderId: string | null = null;
  if (target.type === 'file') {
    const f = await q1(`SELECT folder_id, created_by FROM Files WHERE file_id = @id`, { id: target.id });
    if (!f) return [];
    ids.add(f.created_by);
    folderId = f.folder_id;
    const direct = await q(
      `SELECT fa.user_id FROM FileAccess fa JOIN UserRoles ur ON ur.user_id = fa.user_id AND ur.role_id >= 2
       WHERE fa.file_id = @id AND fa.permission = 'manage'
       UNION
       SELECT ut.user_id FROM FileTagAccess ta JOIN UserTags ut ON ut.tag_id = ta.tag_id JOIN UserRoles ur ON ur.user_id = ut.user_id AND ur.role_id >= 2
       WHERE ta.file_id = @id AND ta.permission = 'manage' AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`,
      { id: target.id },
    );
    direct.forEach((r) => ids.add(r.user_id));
  } else folderId = target.id;

  const chain: string[] = [];
  let cur = folderId ? index.map.get(folderId) : undefined;
  while (cur && !chain.includes(cur.id)) {
    chain.push(cur.id);
    ids.add(cur.createdBy);
    cur = cur.parentId ? index.map.get(cur.parentId) : undefined;
  }
  if (chain.length) {
    const rows = await q(
      `SELECT fa.user_id FROM FolderAccess fa JOIN UserRoles ur ON ur.user_id = fa.user_id AND ur.role_id >= 2
       WHERE fa.permission = 'manage' AND fa.folder_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))
       UNION
       SELECT ut.user_id FROM FolderTagAccess ta JOIN UserTags ut ON ut.tag_id = ta.tag_id JOIN UserRoles ur ON ur.user_id = ut.user_id AND ur.role_id >= 2
       WHERE ta.permission = 'manage' AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())
         AND ta.folder_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`,
      { ids: JSON.stringify(chain) },
    );
    rows.forEach((r) => ids.add(r.user_id));
  }
  const admins = await q(
    `SELECT u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id = 3 WHERE u.is_active = 1`,
  );
  admins.forEach((r) => ids.add(r.user_id));
  return [...ids];
}
