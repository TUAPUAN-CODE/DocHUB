"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApps = listApps;
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const socket_1 = require("../../socket");
const service_1 = require("../pageAccess/service");
/**
 * "Application": icons that open things.
 *   dash:<id>     every dashboard the user can open (read access to its file) — automatically
 *   page:<key>    built-in pages shown as an app (the plan import "แผนผลิต"), when the role has that page
 *   custom:<id>   added by an admin: a file, a folder, a dashboard or a web link
 * A row of Apps renames / gives an icon / hides / limits (roles, tags) an app; admins and root always see every app (hidden ones
 * marked) so they can bring them back. Who can open the thing itself never changes: an app is only a shortcut.
 */
const router = (0, express_1.Router)();
router.use('/apps', (0, service_1.requirePage)('apps'));
const PAGE_APPS = [
    { key: 'inkcodePlan', name: 'แผนผลิต', to: '/inkcode/plan', color: '#16A34A', description: 'นำเข้าแผนผลิตประจำวัน → ใบออกโค้ด InkCode' },
];
const arr = (s) => { try {
    const v = JSON.parse(s ?? 'null');
    return Array.isArray(v) ? v.map(String) : [];
}
catch {
    return [];
} };
const lower = (s) => String(s ?? '').toLowerCase();
async function myTags(u) {
    return new Set((await (0, db_1.q)(`SELECT tag_id FROM UserTagsAll WHERE user_id = @u`, { u: db_1.T.uuid(u.id) })).map((r) => lower(r.tag_id)));
}
/** Every app the user may see (admins: all, hidden ones marked) */
async function listApps(u) {
    const ctx = await permissions_1.PermCtx.load(u);
    const admin = (0, auth_1.isAdminRole)(u.role);
    const rows = (await (0, db_1.q)(`SELECT * FROM Apps`));
    const byKey = new Map(rows.map((r) => [lower(r.app_key), r]));
    const tags = admin ? new Set() : await myTags(u);
    const pages = await (0, service_1.pagesFor)(u.role);
    const base = [];
    // dashboards
    for (const d of await (0, db_1.q)(`SELECT d.dashboard_id, d.dashboard_name, d.file_id, f.file_name, f.folder_id, f.created_by, f.color
                           FROM Dashboards d JOIN Files f ON f.file_id = d.file_id AND f.is_deleted = 0 ORDER BY d.dashboard_name`)) {
        if (ctx.fileLevel(d) < permissions_1.LV.read)
            continue;
        base.push({ key: `dash:${lower(d.dashboard_id)}`, kind: 'dashboard', defaultName: d.dashboard_name, color: d.color || '#1552F0', description: null,
            to: `/files/${d.file_id}/dashboards/${d.dashboard_id}`, external: null, source: [ctx.pathText(d.folder_id), d.file_name].filter(Boolean).join(' / '), custom: false });
    }
    // built-in pages
    for (const p of PAGE_APPS)
        if (pages.includes(p.key))
            base.push({ key: `page:${p.key}`, kind: 'page', defaultName: p.name, color: p.color, description: p.description, to: p.to, external: null, source: 'หน้าในระบบ', custom: false });
    // added by an admin
    for (const r of rows.filter((x) => x.app_key.startsWith('custom:'))) {
        if (r.kind === 'url' && r.url) {
            base.push({ key: r.app_key, kind: 'url', defaultName: r.url, color: '#0EA5E9', description: null, to: null, external: r.url, source: r.url, custom: true });
            continue;
        }
        if (r.kind === 'file' && r.ref_id) {
            const f = await (0, db_1.q1)(`SELECT file_id, file_name, folder_id, created_by, color FROM Files WHERE file_id = TRY_CAST(@id AS UNIQUEIDENTIFIER) AND is_deleted = 0`, { id: r.ref_id });
            if (f && ctx.fileLevel(f) >= permissions_1.LV.read)
                base.push({ key: r.app_key, kind: 'file', defaultName: f.file_name, color: f.color || '#1552F0', description: null, to: `/files/${f.file_id}`, external: null, source: [ctx.pathText(f.folder_id), f.file_name].filter(Boolean).join(' / '), custom: true });
            continue;
        }
        if (r.kind === 'folder' && r.ref_id) {
            const node = [...ctx.index.map.values()].find((x) => lower(x.id) === lower(r.ref_id));
            if (node && ctx.folderLevel(node.id) >= permissions_1.LV.read)
                base.push({ key: r.app_key, kind: 'folder', defaultName: node.name, color: '#F59E0B', description: null, to: `/folders/${node.id}`, external: null, source: ctx.pathText(node.id), custom: true });
        }
    }
    const out = [];
    for (const b of base) {
        const o = byKey.get(lower(b.key));
        const roles = arr(o?.roles_json ?? null), tagIds = arr(o?.tags_json ?? null).map(lower);
        const hidden = !!o?.is_hidden;
        if (!admin) {
            if (hidden)
                continue;
            if (roles.length && !roles.includes(u.role))
                continue;
            if (tagIds.length && !tagIds.some((t) => tags.has(t)))
                continue;
        }
        out.push({ ...b, name: o?.app_name || b.defaultName, iconUrl: o?.icon_url ?? null, color: o?.color || b.color, description: o?.description ?? b.description,
            hidden, roles, tagIds, sortOrder: o?.sort_order ?? null, type: o?.app_type?.trim() || null });
    }
    return out.sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || a.name.localeCompare(b.name, 'th'));
}
router.get('/apps', (0, http_1.ah)(async (req, res) => (0, http_1.ok)(res, await listApps(req.user))));
/** The type the page opens with (e.g. QC); '' = all apps */
router.get('/apps/settings', (0, http_1.ah)(async (_req, res) => {
    const r = await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = N'apps.defaultType'`);
    (0, http_1.ok)(res, { defaultType: r?.setting_value ?? '' });
}));
router.put('/apps/settings', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    adminOnly(u);
    const { defaultType } = (0, http_1.parse)(zod_1.z.object({ defaultType: zod_1.z.string().trim().max(50) }), req.body);
    await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT N'apps.defaultType' AS setting_key) s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (N'apps.defaultType', @v, @u);`, { v: defaultType, u: db_1.T.uuid(u.id) });
    (0, socket_1.emitToAll)('apps:changed', {});
    (0, http_1.ok)(res, { defaultType });
}));
/** Where an app takes its data from and who can open it */
router.get('/apps/details', (0, http_1.ah)(async (req, res) => {
    const key = String(req.query.key ?? '');
    const app = (await listApps(req.user)).find((a) => lower(a.key) === lower(key));
    if (!app)
        throw (0, http_1.notFound)('ไม่พบแอป หรือคุณไม่มีสิทธิ์เห็นแอปนี้');
    const ctx = await permissions_1.PermCtx.load(req.user);
    // the file (or folder) behind the app
    let fileId = null, folderId = null;
    if (app.kind === 'dashboard') {
        const d = await (0, db_1.q1)(`SELECT d.file_id, f.folder_id FROM Dashboards d JOIN Files f ON f.file_id = d.file_id WHERE d.dashboard_id = @d`, { d: db_1.T.uuid(key.slice(5)) });
        fileId = d?.file_id ?? null;
        folderId = d?.folder_id ?? null;
    }
    if (app.kind === 'file') {
        const r = await (0, db_1.q1)(`SELECT a.ref_id, f.folder_id FROM Apps a JOIN Files f ON f.file_id = TRY_CAST(a.ref_id AS UNIQUEIDENTIFIER) WHERE a.app_key = @k`, { k: key });
        fileId = r?.ref_id ?? null;
        folderId = r?.folder_id ?? null;
    }
    if (app.kind === 'folder') {
        const r = await (0, db_1.q1)(`SELECT ref_id FROM Apps WHERE app_key = @k`, { k: key });
        folderId = r?.ref_id ?? null;
    }
    // folders from the root down to the source (grants on any of them reach it)
    const realFolder = folderId ? [...ctx.index.map.keys()].find((id) => lower(id) === lower(folderId)) : undefined;
    const chain = realFolder ? ctx.path(realFolder).map((f) => f.id) : [];
    const users = [];
    const tags = [];
    const userCols = `u.display_name, ${auth_1.ROLE_SQL} AS role`;
    if (fileId) {
        const f = await (0, db_1.q1)(`SELECT u.display_name, ${auth_1.ROLE_SQL} AS role FROM Files fi JOIN Users u ON u.user_id = fi.created_by WHERE fi.file_id = @f`, { f: db_1.T.uuid(fileId) });
        if (f)
            users.push({ name: f.display_name, role: f.role, permission: 'manage', via: 'เจ้าของไฟล์' });
        for (const r of await (0, db_1.q)(`SELECT ${userCols}, fa.permission FROM FileAccess fa JOIN Users u ON u.user_id = fa.user_id AND u.is_active = 1 WHERE fa.file_id = @f AND (fa.expires_at IS NULL OR fa.expires_at > SYSUTCDATETIME())`, { f: db_1.T.uuid(fileId) }))
            users.push({ name: r.display_name, role: r.role, permission: r.permission, via: 'แชร์ไฟล์นี้' });
        for (const r of await (0, db_1.q)(`SELECT t.tag_name, t.color, ta.permission FROM FileTagAccess ta JOIN Tags t ON t.tag_id = ta.tag_id WHERE ta.file_id = @f AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`, { f: db_1.T.uuid(fileId) }))
            tags.push({ name: r.tag_name, color: r.color, permission: r.permission, via: 'แชร์ไฟล์นี้' });
    }
    if (chain.length) {
        const names = new Map(chain.map((id) => [lower(id), ctx.index.map.get(id)?.name ?? '']));
        for (const r of await (0, db_1.q)(`SELECT ${userCols}, fa.permission, fa.folder_id FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id AND u.is_active = 1 WHERE fa.folder_id IN ${(0, db_1.idList)('@f')} AND (fa.expires_at IS NULL OR fa.expires_at > SYSUTCDATETIME())`, { f: (0, db_1.jsonParam)(chain) }))
            users.push({ name: r.display_name, role: r.role, permission: r.permission, via: `โฟลเดอร์ ${names.get(lower(r.folder_id))}` });
        for (const r of await (0, db_1.q)(`SELECT t.tag_name, t.color, ta.permission, ta.folder_id FROM FolderTagAccess ta JOIN Tags t ON t.tag_id = ta.tag_id WHERE ta.folder_id IN ${(0, db_1.idList)('@f')} AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`, { f: (0, db_1.jsonParam)(chain) }))
            tags.push({ name: r.tag_name, color: r.color, permission: r.permission, via: `โฟลเดอร์ ${names.get(lower(r.folder_id))}` });
        for (const r of await (0, db_1.q)(`SELECT ${userCols}, fo.folder_id FROM Folders fo JOIN Users u ON u.user_id = fo.created_by AND u.is_active = 1 WHERE fo.folder_id IN ${(0, db_1.idList)('@f')}`, { f: (0, db_1.jsonParam)(chain) }))
            users.push({ name: r.display_name, role: r.role, permission: 'manage', via: `ผู้สร้างโฟลเดอร์ ${names.get(lower(r.folder_id))}` });
    }
    const limitTags = app.tagIds.length ? await (0, db_1.q)(`SELECT tag_name, color FROM Tags WHERE tag_id IN ${(0, db_1.idList)('@t')}`, { t: (0, db_1.jsonParam)(app.tagIds) }) : [];
    (0, http_1.ok)(res, {
        app,
        source: { kind: app.kind, path: app.source, link: app.to ?? app.external, fileId, folderId },
        access: {
            note: app.kind === 'page' ? 'แอปนี้คือหน้าในระบบ: เห็นตามสิทธิ์ของ role ที่ตั้งในหน้า จัดการสิทธิ์' : app.kind === 'url' ? 'ลิงก์ภายนอก: ทุกคนที่เห็นแอปเปิดได้' : 'Admin / Root เปิดได้ทุกไฟล์; คนอื่นตามสิทธิ์ด้านล่าง (Viewer อ่านได้อย่างเดียว)',
            users, tags,
            limitRoles: app.roles, limitTags: limitTags.map((t) => ({ name: t.tag_name, color: t.color })),
        },
    });
}));
// ---- admin: rename / icon / hide / limit, add and remove
const adminOnly = (u) => { if (!(0, auth_1.isAdminRole)(u.role))
    throw (0, http_1.forbidden)('เฉพาะ Admin / Root'); };
const zRole = zod_1.z.enum(['viewer', 'user', 'master', 'admin']);
const editBody = zod_1.z.object({
    name: zod_1.z.string().trim().max(100).nullish(),
    iconUrl: zod_1.z.string().max(300).regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'ไอคอนไม่ถูกต้อง').nullish(),
    color: zod_1.z.string().max(20).regex(/^#[0-9A-Fa-f]{3,8}$/).nullish(),
    description: zod_1.z.string().trim().max(500).nullish(),
    roles: zod_1.z.array(zRole).max(4).default([]),
    tagIds: zod_1.z.array(http_1.zId).max(50).default([]),
    hidden: zod_1.z.boolean().default(false),
    sortOrder: zod_1.z.number().int().min(0).max(100000).nullish(),
    type: zod_1.z.string().trim().max(50).nullish(),
});
const keyOk = (k) => /^(dash:[0-9a-f-]{36}|page:[A-Za-z]{1,40}|custom:[0-9a-f-]{36})$/i.test(k);
async function saveOverride(u, key, kind, refId, url, b) {
    await (0, db_1.q)(`MERGE Apps AS t USING (SELECT @k AS app_key) s ON t.app_key = s.app_key
    WHEN MATCHED THEN UPDATE SET app_name = @n, icon_url = @i, color = @c, description = @d, roles_json = @r, tags_json = @t, is_hidden = @h, sort_order = @o, app_type = @ty, updated_by = @u, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (app_key, kind, ref_id, url, app_name, icon_url, color, description, roles_json, tags_json, is_hidden, sort_order, app_type, created_by, updated_by)
      VALUES (@k, @kind, @ref, @url, @n, @i, @c, @d, @r, @t, @h, @o, @ty, @u, @u);`, {
        k: key, kind, ref: db_1.T.text(refId), url: db_1.T.text(url), n: db_1.T.text(b.name || null), i: db_1.T.text(b.iconUrl ?? null), c: db_1.T.text(b.color ?? null), d: db_1.T.text(b.description || null),
        r: db_1.T.text(b.roles.length ? JSON.stringify(b.roles) : null), t: db_1.T.text(b.tagIds.length ? JSON.stringify(b.tagIds.map(lower)) : null), h: db_1.T.bit(b.hidden), o: b.sortOrder ?? null, ty: db_1.T.text(b.type || null), u: db_1.T.uuid(u.id),
    });
}
router.put('/apps/item', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    adminOnly(u);
    const key = String(req.query.key ?? '');
    if (!keyOk(key))
        throw (0, http_1.badRequest)('รหัสแอปไม่ถูกต้อง');
    const b = (0, http_1.parse)(editBody, req.body);
    const app = (await listApps(u)).find((a) => lower(a.key) === lower(key));
    if (!app)
        throw (0, http_1.notFound)('ไม่พบแอป');
    await saveOverride(u, key, app.kind, key.startsWith('dash:') ? key.slice(5) : key.startsWith('page:') ? key.slice(5) : null, null, b);
    await (0, audit_1.audit)({ userId: u.id, action: 'app_update', entityType: 'system', entityId: key, newValue: b }, req);
    (0, socket_1.emitToAll)('apps:changed', {});
    (0, http_1.ok)(res, (await listApps(u)).find((a) => lower(a.key) === lower(key)));
}));
const addBody = editBody.extend({ kind: zod_1.z.enum(['file', 'folder', 'dashboard', 'url']), refId: zod_1.z.string().max(100).nullish(), url: zod_1.z.string().trim().max(1000).nullish() });
router.post('/apps', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    adminOnly(u);
    const b = (0, http_1.parse)(addBody, req.body);
    if (b.kind === 'url') {
        if (!b.url || !/^(https?:\/\/|\/)/i.test(b.url))
            throw (0, http_1.badRequest)('ลิงก์ต้องขึ้นต้นด้วย http(s):// หรือ /');
    }
    else if (!b.refId)
        throw (0, http_1.badRequest)('เลือกไฟล์ / โฟลเดอร์ / แดชบอร์ด');
    if (b.kind === 'dashboard') {
        // a dashboard is already an app: give that app the settings instead of a second icon
        const d = await (0, db_1.q1)(`SELECT dashboard_id FROM Dashboards WHERE dashboard_id = TRY_CAST(@d AS UNIQUEIDENTIFIER)`, { d: b.refId });
        if (!d)
            throw (0, http_1.notFound)('ไม่พบแดชบอร์ด');
        const key = `dash:${lower(d.dashboard_id)}`;
        await saveOverride(u, key, 'dashboard', lower(d.dashboard_id), null, b);
        (0, socket_1.emitToAll)('apps:changed', {});
        return (0, http_1.ok)(res, { key }, 201);
    }
    const id = (await (0, db_1.q1)(`SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())) AS id`)).id;
    const key = `custom:${id}`;
    await saveOverride(u, key, b.kind, b.kind === 'url' ? null : lower(b.refId), b.kind === 'url' ? b.url : null, b);
    await (0, audit_1.audit)({ userId: u.id, action: 'app_create', entityType: 'system', entityId: key, newValue: b }, req);
    (0, socket_1.emitToAll)('apps:changed', {});
    (0, http_1.ok)(res, { key }, 201);
}));
/** custom app: removed · dashboard / page app: its settings are reset (it stays an app) */
router.delete('/apps/item', (0, http_1.ah)(async (req, res) => {
    const u = req.user;
    adminOnly(u);
    const key = String(req.query.key ?? '');
    if (!keyOk(key))
        throw (0, http_1.badRequest)('รหัสแอปไม่ถูกต้อง');
    await (0, db_1.q)(`DELETE FROM Apps WHERE app_key = @k`, { k: key });
    await (0, audit_1.audit)({ userId: u.id, action: 'app_delete', entityType: 'system', entityId: key }, req);
    (0, socket_1.emitToAll)('apps:changed', {});
    (0, http_1.ok)(res, { deleted: true });
}));
exports.default = router;
//# sourceMappingURL=routes.js.map