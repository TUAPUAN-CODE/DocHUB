"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PermCtx = exports.invalidateFolders = exports.levelName = exports.toLevel = exports.PERM_NAMES = exports.LV = void 0;
exports.getFolderIndex = getFolderIndex;
exports.getFileRow = getFileRow;
exports.requireFile = requireFile;
exports.requireFolder = requireFolder;
exports.requireSheet = requireSheet;
exports.managersOf = managersOf;
const cluster_1 = require("../services/cluster");
const env_1 = require("../config/env");
const db_1 = require("../config/db");
const http_1 = require("./http");
/**
 * Permission levels.
 *  read   – view data
 *  write  – enter / edit data
 *  manage – change structure (sheets, columns), share, delete, dashboards
 *
 * Effective level = max(owner, direct file grant, folder grant inherited from any ancestor,
 * creator of any ancestor folder) capped by role (role "user" can never exceed write).
 * Admin is always manage.
 */
exports.LV = { none: 0, read: 1, write: 2, manage: 3 };
exports.PERM_NAMES = ['none', 'read', 'write', 'manage'];
const toLevel = (p) => (p && p in exports.LV ? exports.LV[p] : 0);
exports.toLevel = toLevel;
const levelName = (l) => exports.PERM_NAMES[Math.max(0, Math.min(3, l))];
exports.levelName = levelName;
const LEVEL_TH = ['ไม่มีสิทธิ์', 'ดูข้อมูล', 'แก้ไขข้อมูล', 'จัดการ'];
let folderCache = null;
(0, cluster_1.onBroadcast)('folders', () => { folderCache = null; });
const invalidateFolders = () => {
    folderCache = null;
    (0, cluster_1.broadcast)('folders');
};
exports.invalidateFolders = invalidateFolders;
async function getFolderIndex() {
    if (folderCache && Date.now() - folderCache.at < 5000)
        return folderCache.index;
    const rows = await (0, db_1.q)(`SELECT folder_id, parent_id, folder_name, description, color, icon, sort_order, created_by, created_at, updated_at
     FROM Folders WHERE is_deleted = 0`);
    const map = new Map();
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
    const children = new Map();
    for (const f of map.values()) {
        const parent = f.parentId && map.has(f.parentId) ? f.parentId : null;
        if (!children.has(parent))
            children.set(parent, []);
        children.get(parent).push(f.id);
    }
    const index = { map, children };
    folderCache = { at: Date.now(), index };
    return index;
}
class PermCtx {
    constructor(user, index, folderGrants, fileGrants) {
        this.user = user;
        this.index = index;
        this.folderGrants = folderGrants;
        this.fileGrants = fileGrants;
        this.memo = new Map();
        this.anchors = null;
    }
    static async load(user) {
        const index = await getFolderIndex();
        if (user.role === 'admin')
            return new PermCtx(user, index, new Map(), new Map());
        const [fg, fi] = await Promise.all([
            (0, db_1.q)(`SELECT folder_id, permission FROM FolderAccess
         WHERE user_id = @u AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())`, { u: user.id }),
            (0, db_1.q)(`SELECT file_id, permission FROM FileAccess
         WHERE user_id = @u AND (expires_at IS NULL OR expires_at > SYSUTCDATETIME())`, { u: user.id }),
        ]);
        return new PermCtx(user, index, new Map(fg.map((r) => [r.folder_id, (0, exports.toLevel)(r.permission)])), new Map(fi.map((r) => [r.file_id, (0, exports.toLevel)(r.permission)])));
    }
    get isAdmin() {
        return this.user.role === 'admin';
    }
    cap(l) {
        if (this.user.role === 'viewer')
            return Math.min(l, exports.LV.read);
        return this.user.role === 'user' ? Math.min(l, exports.LV.write) : l;
    }
    rawFolder(id) {
        if (!id)
            return 0;
        const m = this.memo.get(id);
        if (m !== undefined)
            return m;
        const f = this.index.map.get(id);
        if (!f)
            return 0;
        this.memo.set(id, 0); // cycle guard
        let l = this.folderGrants.get(id) ?? 0;
        if (f.createdBy === this.user.id)
            l = exports.LV.manage;
        l = Math.max(l, this.rawFolder(f.parentId));
        this.memo.set(id, l);
        return l;
    }
    folderLevel(id) {
        if (this.isAdmin)
            return exports.LV.manage;
        return this.cap(this.rawFolder(id));
    }
    fileLevel(f) {
        if (this.isAdmin)
            return exports.LV.manage;
        let l = f.created_by === this.user.id ? exports.LV.manage : 0;
        l = Math.max(l, this.fileGrants.get(f.file_id) ?? 0, this.rawFolder(f.folder_id));
        return this.cap(l);
    }
    /** Ancestors from root down to (and including) the folder */
    path(id) {
        const out = [];
        const seen = new Set();
        let cur = this.index.map.get(id);
        while (cur && !seen.has(cur.id)) {
            seen.add(cur.id);
            out.unshift(cur);
            cur = cur.parentId ? this.index.map.get(cur.parentId) : undefined;
        }
        return out;
    }
    pathText(id) {
        return this.path(id)
            .map((f) => f.name)
            .join(' / ');
    }
    /** The folder and all folders below it */
    descendants(id) {
        const out = [];
        const stack = [id];
        while (stack.length) {
            const cur = stack.pop();
            if (out.includes(cur))
                continue;
            out.push(cur);
            stack.push(...(this.index.children.get(cur) ?? []));
        }
        return out;
    }
    /**
     * Returns a predicate telling whether a folder should appear in navigation.
     * With SHOW_LOCKED_ITEMS=true every folder is visible (locked ones show a padlock).
     */
    async visibility() {
        if (env_1.env.showLockedItems || this.isAdmin)
            return () => true;
        if (!this.anchors) {
            const anchors = new Set();
            for (const [fid] of this.folderGrants)
                anchors.add(fid);
            for (const f of this.index.map.values())
                if (f.createdBy === this.user.id)
                    anchors.add(f.id);
            const fileIds = [...this.fileGrants.keys()];
            const rows = await (0, db_1.q)(`SELECT DISTINCT folder_id FROM Files WHERE is_deleted = 0
         AND (created_by = @u OR file_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids)))`, { u: this.user.id, ids: JSON.stringify(fileIds) });
            for (const r of rows)
                anchors.add(r.folder_id);
            const withAncestors = new Set();
            for (const a of anchors)
                for (const p of this.path(a))
                    withAncestors.add(p.id);
            this.anchors = withAncestors;
        }
        const anchors = this.anchors;
        return (id) => anchors.has(id) || this.folderLevel(id) >= exports.LV.read;
    }
}
exports.PermCtx = PermCtx;
/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */
function denied(level, min, target) {
    if (level === 0)
        return (0, http_1.forbidden)(target.type === 'file' ? 'คุณยังไม่มีสิทธิ์เข้าถึงไฟล์นี้' : 'คุณยังไม่มีสิทธิ์เข้าถึงโฟลเดอร์นี้', 'NO_ACCESS', { targetType: target.type, targetId: target.id, name: target.name, currentLevel: (0, exports.levelName)(level) });
    return (0, http_1.forbidden)(`ต้องมีสิทธิ์ระดับ "${LEVEL_TH[min]}" เพื่อดำเนินการนี้`, 'INSUFFICIENT_LEVEL', {
        targetType: target.type,
        targetId: target.id,
        name: target.name,
        currentLevel: (0, exports.levelName)(level),
        requiredLevel: (0, exports.levelName)(min),
    });
}
async function getFileRow(fileId, tx) {
    return (0, db_1.q1)(`SELECT f.*, fo.folder_name FROM Files f JOIN Folders fo ON fo.folder_id = f.folder_id
     WHERE f.file_id = @id AND f.is_deleted = 0`, { id: fileId }, tx);
}
async function requireFile(user, fileId, min) {
    const file = await getFileRow(fileId);
    if (!file)
        throw (0, http_1.notFound)('ไม่พบไฟล์ หรือไฟล์ถูกลบแล้ว');
    const ctx = await PermCtx.load(user);
    const level = ctx.fileLevel(file);
    if (level < min)
        throw denied(level, min, { type: 'file', id: file.file_id, name: file.file_name });
    return { file, level, ctx };
}
async function requireFolder(user, folderId, min) {
    const ctx = await PermCtx.load(user);
    const folder = ctx.index.map.get(folderId);
    if (!folder)
        throw (0, http_1.notFound)('ไม่พบโฟลเดอร์ หรือโฟลเดอร์ถูกลบแล้ว');
    const level = ctx.folderLevel(folderId);
    if (level < min)
        throw denied(level, min, { type: 'folder', id: folder.id, name: folder.name });
    return { folder, level, ctx };
}
/**
 * `allowUnion`: management actions that make sense on a union sheet (rename, delete). Every write to its data or
 * structure is refused: the rows belong to the source sheets and are mirrored automatically.
 */
async function requireSheet(user, sheetId, min, tx, allowUnion = false) {
    const sheet = await (0, db_1.q1)(`SELECT s.*, f.folder_id, f.created_by AS file_created_by, f.file_name
     FROM Sheets s JOIN Files f ON f.file_id = s.file_id
     WHERE s.sheet_id = @id AND s.is_deleted = 0 AND f.is_deleted = 0`, { id: sheetId }, tx);
    if (!sheet)
        throw (0, http_1.notFound)('ไม่พบชีต หรือชีตถูกลบแล้ว');
    const ctx = await PermCtx.load(user);
    const level = ctx.fileLevel({ file_id: sheet.file_id, folder_id: sheet.folder_id, created_by: sheet.file_created_by });
    if (level < min)
        throw denied(level, min, { type: 'file', id: sheet.file_id, name: sheet.file_name });
    if (min >= exports.LV.write && sheet.union_config && !allowUnion)
        throw (0, http_1.forbidden)('ชีตนี้รวมข้อมูลจากชีตอื่นอัตโนมัติ แก้ไขไม่ได้ กรุณาแก้ที่ไฟล์ต้นทาง', 'UNION_READONLY');
    return { sheet, level, ctx };
}
/** User ids who can approve requests / should be notified about a file or folder */
async function managersOf(target) {
    const index = await getFolderIndex();
    const ids = new Set();
    let folderId = null;
    if (target.type === 'file') {
        const f = await (0, db_1.q1)(`SELECT folder_id, created_by FROM Files WHERE file_id = @id`, { id: target.id });
        if (!f)
            return [];
        ids.add(f.created_by);
        folderId = f.folder_id;
        const direct = await (0, db_1.q)(`SELECT fa.user_id FROM FileAccess fa JOIN UserRoles ur ON ur.user_id = fa.user_id AND ur.role_id >= 2
       WHERE fa.file_id = @id AND fa.permission = 'manage'`, { id: target.id });
        direct.forEach((r) => ids.add(r.user_id));
    }
    else
        folderId = target.id;
    const chain = [];
    let cur = folderId ? index.map.get(folderId) : undefined;
    while (cur && !chain.includes(cur.id)) {
        chain.push(cur.id);
        ids.add(cur.createdBy);
        cur = cur.parentId ? index.map.get(cur.parentId) : undefined;
    }
    if (chain.length) {
        const rows = await (0, db_1.q)(`SELECT fa.user_id FROM FolderAccess fa JOIN UserRoles ur ON ur.user_id = fa.user_id AND ur.role_id >= 2
       WHERE fa.permission = 'manage' AND fa.folder_id IN (SELECT TRY_CAST([value] AS UNIQUEIDENTIFIER) FROM OPENJSON(@ids))`, { ids: JSON.stringify(chain) });
        rows.forEach((r) => ids.add(r.user_id));
    }
    const admins = await (0, db_1.q)(`SELECT u.user_id FROM Users u JOIN UserRoles ur ON ur.user_id = u.user_id AND ur.role_id = 3 WHERE u.is_active = 1`);
    admins.forEach((r) => ids.add(r.user_id));
    return [...ids];
}
//# sourceMappingURL=permissions.js.map