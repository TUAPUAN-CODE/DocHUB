import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { q, q1, T } from '../../config/db';
import { env } from '../../config/env';
import { requireRole } from '../../middleware/auth';
import { broadcast, onBroadcast } from '../../services/cluster';
import { audit } from '../../shared/audit';
import { ah, ok, parse } from '../../shared/http';

/**
 * The app's name ("Quality" by default): left bar, sign-in page, browser tab and the name under the icon on a phone's
 * home screen (manifest + apple-mobile-web-app-title). Set by an admin on ตั้งค่า → ชื่อระบบ.
 */
export const DEFAULT_APP_NAME = 'Quality';
const KEY = 'app_name';
let cache: { at: number; name: string } | null = null;
onBroadcast('appInfo', () => { cache = null; });

export async function appName() {
  if (cache && Date.now() - cache.at < 60_000) return cache.name;
  const r = await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: KEY }).catch(() => null);
  cache = { at: Date.now(), name: (r?.setting_value as string | undefined)?.trim() || DEFAULT_APP_NAME };
  return cache.name;
}

/**
 * The app's icon, uploaded on ตั้งค่า → ชื่อระบบ: the browser makes three square PNGs (512, 192, 180 px) and the server keeps their
 * /uploads paths (SystemSettings app_icon = {"512": …, "192": …, "180": …}). They replace the built-in icon files of the browser tab,
 * the phone home screen (manifest + apple-touch-icon), the left bar and the sign-in page. null = the built-in icon.
 */
type Icons = { '512': string; '192': string; '180': string };
const ICON_KEY = 'app_icon';
let iconCache: { at: number; v: Icons | null } | null = null;
onBroadcast('appInfo', () => { iconCache = null; });
export async function appIcons(): Promise<Icons | null> {
  if (iconCache && Date.now() - iconCache.at < 60_000) return iconCache.v;
  const r = await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: ICON_KEY }).catch(() => null);
  let v: Icons | null = null;
  try { const j = JSON.parse(r?.setting_value ?? 'null'); if (j && j['512'] && j['192'] && j['180']) v = j; } catch { /* none */ }
  iconCache = { at: Date.now(), v };
  return v;
}
const uploadPath = (url: string) => { const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(url); return m ? path.resolve(env.uploadDir, m[1]) : null; };

/** before sign-in */
export const publicRouter = Router();
publicRouter.get('/app-info', ah(async (_req, res) => ok(res, { name: await appName(), icon: (await appIcons())?.['192'] ?? null })));

/** the web app manifest with the configured name (served before the static files of client/dist) */
export const manifestRouter = Router();
manifestRouter.get('/manifest.webmanifest', ah(async (_req, res, next) => {
  const file = env.serveClientDir ? path.resolve(env.serveClientDir, 'manifest.webmanifest') : '';
  if (!file || !fs.existsSync(file)) return next();
  const m = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = await appName();
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({ ...m, name, short_name: name.slice(0, 12) }));
}));

/** the uploaded icon in place of the built-in files (registered before the static files of client/dist) */
const serveIcon = (size: keyof Icons) => ah(async (_req, res, next) => {
  const icons = await appIcons();
  const file = icons ? uploadPath(icons[size]) : null;
  if (!file || !fs.existsSync(file)) return next();
  res.type('image/png').set('Cache-Control', 'no-cache').sendFile(file);
});
manifestRouter.get('/apple-touch-icon.png', serveIcon('180'));
manifestRouter.get('/icons/icon-192.png', serveIcon('192'));
manifestRouter.get('/icons/icon-512.png', serveIcon('512'));
manifestRouter.get('/icons/icon-maskable-512.png', serveIcon('512'));

/** signed in: admins change it */
export const router = Router();
router.put('/app-info', requireRole('admin'), ah(async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(1, 'กรุณาใส่ชื่อ').max(40, 'ไม่เกิน 40 ตัวอักษร') }), req.body);
  const before = await appName();
  await q(
    `MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
     WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (s.setting_key, @v, @u);`,
    { k: KEY, v: name, u: T.uuid(req.user!.id) },
  );
  cache = null;
  broadcast('appInfo');
  await audit({ userId: req.user!.id, action: 'app_name_update', entityType: 'system', entityId: KEY, oldValue: { name: before }, newValue: { name } }, req);
  ok(res, { name });
}));

const zUp = z.string().max(300).regex(/^\/uploads\/[A-Za-z0-9._-]+$/, 'ไอคอนไม่ถูกต้อง');
router.put('/app-info/icon', requireRole('admin'), ah(async (req, res) => {
  const { icons } = parse(z.object({ icons: z.object({ '512': zUp, '192': zUp, '180': zUp }).nullable() }), req.body);
  const before = await appIcons();
  if (icons) {
    await q(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
             WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
             WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (s.setting_key, @v, @u);`, { k: ICON_KEY, v: JSON.stringify(icons), u: T.uuid(req.user!.id) });
  } else await q(`DELETE FROM SystemSettings WHERE setting_key = @k`, { k: ICON_KEY });
  iconCache = null;
  broadcast('appInfo');
  await audit({ userId: req.user!.id, action: 'app_icon_update', entityType: 'system', entityId: ICON_KEY, oldValue: before, newValue: icons }, req);
  ok(res, { icon: icons?.['192'] ?? null });
}));
