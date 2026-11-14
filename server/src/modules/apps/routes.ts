import { Router } from 'express';
import { z } from 'zod';
import { idList, jsonParam, q, q1, T } from '../../config/db';
import { AuthUser, isAdminRole, ROLE_SQL } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, forbidden, notFound, ok, parse, zId } from '../../shared/http';
import { LV, PermCtx } from '../../shared/permissions';
import { emitToAll } from '../../socket';
import { pagesFor, requirePage } from '../pageAccess/service';

/**
 * "Application": icons that open things.
 *   dash:<id>     every dashboard the user can open (read access to its file) — automatically
 *   page:<key>    built-in pages shown as an app (the plan import "แผนผลิต"), when the role has that page
 *   custom:<id>   added by an admin: a file, a folder, a dashboard or a web link
 * A row of Apps renames / gives an icon / hides / limits (roles, tags) an app; admins and root always see every app (hidden ones
 * marked) so they can bring them back. Who can open the thing itself never changes: an app is only a shortcut.
 */
const router = Router();
router.use('/apps', requirePage('apps'));

const PAGE_APPS: { key: string; name: string; to: string; color: string; description: string }[] = [
  { key: 'inkcodePlan', name: 'แผนผลิต', to: '/inkcode/plan', color: '#16A34A', description: 'นำเข้าแผนผลิตประจำวัน → ใบออกโค้ด InkCode' },
];

interface AppRow {
  app_key: string; kind: string; ref_id: string | null; url: string | null; app_name: string | null; icon_url: string | null; color: string | null;
  description: string | null; roles_json: string | null; tags_json: string | null; is_hidden: boolean; sort_order: number | null; app_type?: string | null;
}
const arr = (s: string | null): string[] => { try { const v = JSON.parse(s ?? 'null'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const lower = (s: unknown) => String(s ?? '').toLowerCase();

export interface AppOut {
  key: string; kind: string; name: string; defaultName: string; iconUrl: string | null; color: string; description: string | null;
  to: string | null; external: string | null; hidden: boolean; roles: string[]; tagIds: string[]; source: string; sortOrder: number | null; custom: boolean; type: string | null;
}

async function myTags(u: AuthUser): Promise<Set<string>> {
  return new Set((await q(`SELECT tag_id FROM UserTagsAll WHERE user_id = @u`, { u: T.uuid(u.id) })).map((r: any) => lower(r.tag_id)));
}

/** Every app the user may see (admins: all, hidden ones marked) */
export async function listApps(u: AuthUser): Promise<AppOut[]> {
  const ctx = await PermCtx.load(u);
  const admin = isAdminRole(u.role);
  const rows = (await q(`SELECT * FROM Apps`)) as AppRow[];
  const byKey = new Map(rows.map((r) => [lower(r.app_key), r]));
  const tags = admin ? new Set<string>() : await myTags(u);
  const pages = await pagesFor(u.role);
  const base: (Omit<AppOut, 'name' | 'iconUrl' | 'color' | 'description' | 'hidden' | 'roles' | 'tagIds' | 'sortOrder' | 'type'> & { color: string; description: string | null })[] = [];

  // dashboards
  for (const d of await q(`SELECT d.dashboard_id, d.dashboard_name, d.file_id, f.file_name, f.folder_id, f.created_by, f.color
                           FROM Dashboards d JOIN Files f ON f.file_id = d.file_id AND f.is_deleted = 0 ORDER BY d.dashboard_name`)) {
    if (ctx.fileLevel(d) < LV.read) continue;
    base.push({ key: `dash:${lower(d.dashboard_id)}`, kind: 'dashboard', defaultName: d.dashboard_name, color: d.color || '#1552F0', description: null,
      to: `/files/${d.file_id}/dashboards/${d.dashboard_id}`, external: null, source: [ctx.pathText(d.folder_id), d.file_name].filter(Boolean).join(' / '), custom: false });
  }
  // built-in pages
  for (const p of PAGE_APPS) if (pages.includes(p.key)) base.push({ key: `page:${p.key}`, kind: 'page', defaultName: p.name, color: p.color, description: p.description, to: p.to, external: null, source: 'หน้าในระบบ', custom: false });
  // added by an admin
  for (const r of rows.filter((x) => x.app_key.startsWith('custom:'))) {
    if (r.kind === 'url' && r.url) { base.push({ key: r.app_key, kind: 'url', defaultName: r.url, color: '#0EA5E9', description: null, to: null, external: r.url, source: r.url, custom: true }); continue; }
    if (r.kind === 'file' && r.ref_id) {
      const f = await q1(`SELECT file_id, file_name, folder_id, created_by, color FROM Files WHERE file_id = TRY_CAST(@id AS UNIQUEIDENTIFIER) AND is_deleted = 0`, { id: r.ref_id });
      if (f && ctx.fileLevel(f) >= LV.read) base.push({ key: r.app_key, kind: 'file', defaultName: f.file_name, color: f.color || '#1552F0', description: null, to: `/files/${f.file_id}`, external: null, source: [ctx.pathText(f.folder_id), f.file_name].filter(Boolean).join(' / '), custom: true });
      continue;
    }
    if (r.kind === 'folder' && r.ref_id) {
      const node = [...ctx.index.map.values()].find((x) => lower(x.id) === lower(r.ref_id));
      if (node && ctx.folderLevel(node.id) >= LV.read) base.push({ key: r.app_key, kind: 'folder', defaultName: node.name, color: '#F59E0B', description: null, to: `/folders/${node.id}`, external: null, source: ctx.pathText(node.id), custom: true });
    }
  }

  const out: AppOut[] = [];
  for (const b of base) {
    const o = byKey.get(lower(b.key));
    const roles = arr(o?.roles_json ?? null), tagIds = arr(o?.tags_json ?? null).map(lower);
    const hidden = !!o?.is_hidden;
    if (!admin) {
      if (hidden) continue;
      if (roles.length && !roles.includes(u.role)) continue;
      if (tagIds.length && !tagIds.some((t) => tags.has(t))) continue;
    }
    out.push({ ...b, name: o?.app_name || b.defaultName, iconUrl: o?.icon_url ?? null, color: o?.color || b.color, description: o?.description ?? b.description,
      hidden, roles, tagIds, sortOrder: o?.sort_order ?? null, type: o?.app_type?.trim() || null });
  }
  return out.sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || a.name.localeCompare(b.name, 'th'));
}

router.get('/apps', ah(async (req, res) => ok(res, await listApps(req.user!))));

/** The type the page opens with (e.g. QC); '' = all apps */
router.get('/apps/settings', ah(async (_req, res) => {
  const r = await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = N'apps.defaultType'`);
  ok(res, { defaultType: r?.setting_value ?? '' });
}));
router.put('/apps/settings', ah(async (req, res) => {
  const u = req.user!; adminOnly(u);
  const { defaultType } = parse(z.object({ defaultType: z.string().trim().max(50) }), req.body);
  await q(`MERGE SystemSettings AS t USING (SELECT N'apps.defaultType' AS setting_key) s ON t.setting_key = s.setting_key
           WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
           WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (N'apps.defaultType', @v, @u);`, { v: defaultType, u: T.uuid(u.id) });
  emitToAll('apps:changed', {});
  ok(res, { defaultType });
}));

/** Where an app takes its data from and who can open it */
router.get('/apps/details', ah(async (req, res) => {
  const key = String(req.query.key ?? '');
  const app = (await listApps(req.user!)).find((a) => lower(a.key) === lower(key));
  if (!app) throw notFound('ไม่พบแอป หรือคุณไม่มีสิทธิ์เห็นแอปนี้');
  const ctx = await PermCtx.load(req.user!);
  // the file (or folder) behind the app
  let fileId: string | null = null, folderId: string | null = null;
  if (app.kind === 'dashboard') { const d = await q1(`SELECT d.file_id, f.folder_id FROM Dashboards d JOIN Files f ON f.file_id = d.file_id WHERE d.dashboard_id = @d`, { d: T.uuid(key.slice(5)) }); fileId = d?.file_id ?? null; folderId = d?.folder_id ?? null; }
  if (app.kind === 'file') { const r = await q1(`SELECT a.ref_id, f.folder_id FROM Apps a JOIN Files f ON f.file_id = TRY_CAST(a.ref_id AS UNIQUEIDENTIFIER) WHERE a.app_key = @k`, { k: key }); fileId = r?.ref_id ?? null; folderId = r?.folder_id ?? null; }
  if (app.kind === 'folder') { const r = await q1(`SELECT ref_id FROM Apps WHERE app_key = @k`, { k: key }); folderId = r?.ref_id ?? null; }
  // folders from the root down to the source (grants on any of them reach it)
  const realFolder = folderId ? [...ctx.index.map.keys()].find((id) => lower(id) === lower(folderId)) : undefined;
  const chain = realFolder ? ctx.path(realFolder).map((f) => f.id) : [];
  const users: { name: string; role: string; permission: string; via: string }[] = [];
  const tags: { name: string; color: string; permission: string; via: string }[] = [];
  const userCols = `u.display_name, ${ROLE_SQL} AS role`;
  if (fileId) {
    const f = await q1(`SELECT u.display_name, ${ROLE_SQL} AS role FROM Files fi JOIN Users u ON u.user_id = fi.created_by WHERE fi.file_id = @f`, { f: T.uuid(fileId) });
    if (f) users.push({ name: f.display_name, role: f.role, permission: 'manage', via: 'เจ้าของไฟล์' });
    for (const r of await q(`SELECT ${userCols}, fa.permission FROM FileAccess fa JOIN Users u ON u.user_id = fa.user_id AND u.is_active = 1 WHERE fa.file_id = @f AND (fa.expires_at IS NULL OR fa.expires_at > SYSUTCDATETIME())`, { f: T.uuid(fileId) }))
      users.push({ name: r.display_name, role: r.role, permission: r.permission, via: 'แชร์ไฟล์นี้' });
    for (const r of await q(`SELECT t.tag_name, t.color, ta.permission FROM FileTagAccess ta JOIN Tags t ON t.tag_id = ta.tag_id WHERE ta.file_id = @f AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`, { f: T.uuid(fileId) }))
      tags.push({ name: r.tag_name, color: r.color, permission: r.permission, via: 'แชร์ไฟล์นี้' });
  }
  if (chain.length) {
    const names = new Map(chain.map((id) => [lower(id), ctx.index.map.get(id)?.name ?? '']));
    for (const r of await q(`SELECT ${userCols}, fa.permission, fa.folder_id FROM FolderAccess fa JOIN Users u ON u.user_id = fa.user_id AND u.is_active = 1 WHERE fa.folder_id IN ${idList('@f')} AND (fa.expires_at IS NULL OR fa.expires_at > SYSUTCDATETIME())`, { f: jsonParam(chain) }))
      users.push({ name: r.display_name, role: r.role, permission: r.permission, via: `โฟลเดอร์ ${names.get(lower(r.folder_id))}` });
    for (const r of await q(`SELECT t.tag_name, t.color, ta.permission, ta.folder_id FROM FolderTagAccess ta JOIN Tags t ON t.tag_id = ta.tag_id WHERE ta.folder_id IN ${idList('@f')} AND (ta.expires_at IS NULL OR ta.expires_at > SYSUTCDATETIME())`, { f: jsonParam(chain) }))
      tags.push({ name: r.tag_name, color: r.color, permission: r.permission, via: `โฟลเดอร์ ${names.get(lower(r.folder_id))}` });
    for (const r of await q(`SELECT ${userCols}, fo.folder_id FROM Folders fo JOIN Users u ON u.user_id = fo.created_by AND u.is_active = 1 WHERE fo.folder_id IN ${idList('@f')}`, { f: jsonParam(chain) }))
      users.push({ name: r.display_name, role: r.role, permission: 'manage', via: `ผู้สร้างโฟลเดอร์ ${names.get(lower(r.folder_id))}` });
  }
  const limitTags = app.tagIds.length ? await q(`SELECT tag_name, color FROM Tags WHERE tag_id IN ${idList('@t')}`, { t: jsonParam(app.tagIds) }) : [];
  ok(res, {
    app,
    source: { kind: app.kind, path: app.source, link: app.to ?? app.external, fileId, folderId },
    access: {
      note: app.kind === 'page' ? 'แอปนี้คือหน้าในระบบ: เห็นตามสิทธิ์ของ role ที่ตั้งในหน้า จัดการสิทธิ์' : app.kind === 'url' ? 'ลิงก์ภายนอก: ทุกคนที่เห็นแอปเปิดได้' : 'Admin / Root เปิดได้ทุกไฟล์; คนอื่นตามสิทธิ์ด้านล่าง (Viewer อ่านได้อย่างเดียว)',
      users, tags,
      limitRoles: app.roles, limitTags: limitTags.map((t: any) => ({ name: t.tag_name, color: t.color })),
    },
  });
}));

// ---- admin: rename / icon / hide / limit, add and remove
const adminOnly = (u: AuthUser) => { if (!isAdminRole(u.role)) throw forbidden('เฉพาะ Admin / Root'); };
const zRole = z.enum(['viewer', 'user', 'master', 'admin']);
const editBody = z.object({
  name: z.string().trim().max(100).nullish(),
  iconUrl: z.string().max(300).regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'ไอคอนไม่ถูกต้อง').nullish(),
  color: z.string().max(20).regex(/^#[0-9A-Fa-f]{3,8}$/).nullish(),
  description: z.string().trim().max(500).nullish(),
  roles: z.array(zRole).max(4).default([]),
  tagIds: z.array(zId).max(50).default([]),
  hidden: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(100000).nullish(),
  type: z.string().trim().max(50).nullish(),
});
const keyOk = (k: string) => /^(dash:[0-9a-f-]{36}|page:[A-Za-z]{1,40}|custom:[0-9a-f-]{36})$/i.test(k);

async function saveOverride(u: AuthUser, key: string, kind: string, refId: string | null, url: string | null, b: z.infer<typeof editBody>) {
  await q(`MERGE Apps AS t USING (SELECT @k AS app_key) s ON t.app_key = s.app_key
    WHEN MATCHED THEN UPDATE SET app_name = @n, icon_url = @i, color = @c, description = @d, roles_json = @r, tags_json = @t, is_hidden = @h, sort_order = @o, app_type = @ty, updated_by = @u, updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT (app_key, kind, ref_id, url, app_name, icon_url, color, description, roles_json, tags_json, is_hidden, sort_order, app_type, created_by, updated_by)
      VALUES (@k, @kind, @ref, @url, @n, @i, @c, @d, @r, @t, @h, @o, @ty, @u, @u);`, {
    k: key, kind, ref: T.text(refId), url: T.text(url), n: T.text(b.name || null), i: T.text(b.iconUrl ?? null), c: T.text(b.color ?? null), d: T.text(b.description || null),
    r: T.text(b.roles.length ? JSON.stringify(b.roles) : null), t: T.text(b.tagIds.length ? JSON.stringify(b.tagIds.map(lower)) : null), h: T.bit(b.hidden), o: b.sortOrder ?? null, ty: T.text(b.type || null), u: T.uuid(u.id),
  });
}

router.put('/apps/item', ah(async (req, res) => {
  const u = req.user!; adminOnly(u);
  const key = String(req.query.key ?? '');
  if (!keyOk(key)) throw badRequest('รหัสแอปไม่ถูกต้อง');
  const b = parse(editBody, req.body);
  const app = (await listApps(u)).find((a) => lower(a.key) === lower(key));
  if (!app) throw notFound('ไม่พบแอป');
  await saveOverride(u, key, app.kind, key.startsWith('dash:') ? key.slice(5) : key.startsWith('page:') ? key.slice(5) : null, null, b);
  await audit({ userId: u.id, action: 'app_update', entityType: 'system', entityId: key, newValue: b }, req);
  emitToAll('apps:changed', {});
  ok(res, (await listApps(u)).find((a) => lower(a.key) === lower(key)));
}));

const addBody = editBody.extend({ kind: z.enum(['file', 'folder', 'dashboard', 'url']), refId: z.string().max(100).nullish(), url: z.string().trim().max(1000).nullish() });
router.post('/apps', ah(async (req, res) => {
  const u = req.user!; adminOnly(u);
  const b = parse(addBody, req.body);
  if (b.kind === 'url') { if (!b.url || !/^(https?:\/\/|\/)/i.test(b.url)) throw badRequest('ลิงก์ต้องขึ้นต้นด้วย http(s):// หรือ /'); }
  else if (!b.refId) throw badRequest('เลือกไฟล์ / โฟลเดอร์ / แดชบอร์ด');
  if (b.kind === 'dashboard') {
    // a dashboard is already an app: give that app the settings instead of a second icon
    const d = await q1(`SELECT dashboard_id FROM Dashboards WHERE dashboard_id = TRY_CAST(@d AS UNIQUEIDENTIFIER)`, { d: b.refId });
    if (!d) throw notFound('ไม่พบแดชบอร์ด');
    const key = `dash:${lower(d.dashboard_id)}`;
    await saveOverride(u, key, 'dashboard', lower(d.dashboard_id), null, b);
    emitToAll('apps:changed', {});
    return ok(res, { key }, 201);
  }
  const id = (await q1(`SELECT LOWER(CONVERT(NVARCHAR(36), NEWID())) AS id`))!.id as string;
  const key = `custom:${id}`;
  await saveOverride(u, key, b.kind, b.kind === 'url' ? null : lower(b.refId), b.kind === 'url' ? b.url! : null, b);
  await audit({ userId: u.id, action: 'app_create', entityType: 'system', entityId: key, newValue: b }, req);
  emitToAll('apps:changed', {});
  ok(res, { key }, 201);
}));

/** custom app: removed · dashboard / page app: its settings are reset (it stays an app) */
router.delete('/apps/item', ah(async (req, res) => {
  const u = req.user!; adminOnly(u);
  const key = String(req.query.key ?? '');
  if (!keyOk(key)) throw badRequest('รหัสแอปไม่ถูกต้อง');
  await q(`DELETE FROM Apps WHERE app_key = @k`, { k: key });
  await audit({ userId: u.id, action: 'app_delete', entityType: 'system', entityId: key }, req);
  emitToAll('apps:changed', {});
  ok(res, { deleted: true });
}));

export default router;
