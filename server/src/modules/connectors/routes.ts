import crypto from 'crypto';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../../config/env';
import { q, q1, T } from '../../config/db';
import { requireRole } from '../../middleware/auth';
import { audit } from '../../shared/audit';
import { ah, badRequest, forbidden, notFound, ok, parse, pid, safeJson, zId } from '../../shared/http';
import { LV, requireSheet } from '../../shared/permissions';
import { sheetNamesOf } from './parse';
import { runConnector } from './runner';
import { decryptJson, encryptJson } from './secret';
import { fetchSource, HttpConfig, msAuthorizeUrl, msConfigured, msExchangeCode, NeedsAuth, Secret } from './source';
import { parseRecords } from './parse';

const router = Router();
const MS_STATE = 'ms_connector_state';
const manage = requireRole('master', 'admin');

const cfgSchema = z.object({
  url: z.string().trim().min(8).max(2000),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string().max(2000)).default({}),
  body: z.string().max(20000).optional(),
  format: z.enum(['auto', 'json', 'csv', 'xlsx']).default('auto'),
  jsonPath: z.string().max(300).optional(),
  sheetName: z.string().max(200).optional(),
  headerRow: z.number().int().min(1).max(1000).optional(),
  delimiter: z.string().max(3).optional(),
});
const mappingSchema = z.array(z.object({ source: z.string().min(1).max(300), columnId: zId })).max(200);
const bodySchema = z.object({
  name: z.string().trim().min(1).max(200), kind: z.enum(['http', 'sharepoint']), config: cfgSchema,
  targetSheetId: zId.nullish(), mapping: mappingSchema.default([]), keyColumnId: zId.nullish(), scheduleMin: z.number().int().min(0).max(10080).default(0),
});

const map = (r: any) => ({
  id: r.connector_id, name: r.name, kind: r.kind, config: safeJson(r.config_json, {}), targetSheetId: r.target_sheet_id, mapping: safeJson(r.mapping_json, []), keyColumnId: r.key_column_id,
  scheduleMin: r.schedule_min, lastRunAt: r.last_run_at, lastStatus: r.last_status, lastMessage: r.last_message, running: !!r.running_since, createdBy: r.created_by,
  hasCredentials: !!decryptJson<Secret>(r.secret_enc) && (r.kind === 'sharepoint' ? !!decryptJson<Secret>(r.secret_enc)?.msRefresh : decryptJson<Secret>(r.secret_enc)?.type !== 'none'),
});

async function owned(req: any) {
  const r = await q1(`SELECT * FROM Connectors WHERE connector_id = @i AND is_deleted = 0`, { i: T.uuid(pid(req)) });
  if (!r) throw notFound('ไม่พบ connector');
  if (r.created_by.toLowerCase() !== req.user.id.toLowerCase() && req.user.role !== 'admin') throw forbidden('connector นี้เป็นของผู้ใช้อื่น');
  return r;
}
const needsAuthJson = (e: NeedsAuth) => ({ code: 'NEEDS_AUTH', kind: e.kind });

router.get('/connectors', manage, ah(async (req, res) => {
  const rows = await q(`SELECT * FROM Connectors WHERE is_deleted = 0 ${req.user!.role === 'admin' ? '' : 'AND created_by = @u'} ORDER BY name`, { u: T.uuid(req.user!.id) });
  ok(res, { items: rows.map(map), microsoft: msConfigured() });
}));

router.post('/connectors', manage, ah(async (req, res) => {
  const b = parse(bodySchema, req.body);
  if (b.targetSheetId) await requireSheet(req.user!, b.targetSheetId, LV.write);
  const r = await q1(
    `INSERT INTO Connectors (name, kind, config_json, target_sheet_id, mapping_json, key_column_id, schedule_min, created_by)
     OUTPUT inserted.connector_id VALUES (@n, @k, @c, @t, @m, @kc, @s, @u)`,
    { n: b.name, k: b.kind, c: T.text(JSON.stringify(b.config)), t: T.uuid(b.targetSheetId ?? null), m: T.text(JSON.stringify(b.mapping)), kc: T.uuid(b.keyColumnId ?? null), s: T.int(b.scheduleMin), u: T.uuid(req.user!.id) });
  await audit({ userId: req.user!.id, action: 'connector_create', entityType: 'connector', entityId: r!.connector_id, newValue: { name: b.name, kind: b.kind, host: safeHost(b.config.url) } }, req);
  ok(res, { id: r!.connector_id }, 201);
}));

router.put('/connectors/:id', manage, ah(async (req, res) => {
  const cur = await owned(req);
  const b = parse(bodySchema, req.body);
  if (b.targetSheetId) await requireSheet(req.user!, b.targetSheetId, LV.write);
  const urlChanged = safeJson<HttpConfig>(cur.config_json, { url: '' } as HttpConfig).url !== b.config.url;
  await q(`UPDATE Connectors SET name = @n, kind = @k, config_json = @c, target_sheet_id = @t, mapping_json = @m, key_column_id = @kc, schedule_min = @s,
           secret_enc = CASE WHEN @reset = 1 THEN NULL ELSE secret_enc END WHERE connector_id = @i`,
    { n: b.name, k: b.kind, c: T.text(JSON.stringify(b.config)), t: T.uuid(b.targetSheetId ?? null), m: T.text(JSON.stringify(b.mapping)), kc: T.uuid(b.keyColumnId ?? null), s: T.int(b.scheduleMin), reset: T.int(urlChanged || cur.kind !== b.kind ? 1 : 0), i: T.uuid(cur.connector_id) });
  await audit({ userId: req.user!.id, action: 'connector_update', entityType: 'connector', entityId: cur.connector_id, newValue: { name: b.name } }, req);
  ok(res, { saved: true, credentialsReset: urlChanged });
}));

router.delete('/connectors/:id', manage, ah(async (req, res) => {
  const cur = await owned(req);
  await q(`UPDATE Connectors SET is_deleted = 1 WHERE connector_id = @i`, { i: T.uuid(cur.connector_id) });
  await audit({ userId: req.user!.id, action: 'connector_delete', entityType: 'connector', entityId: cur.connector_id, newValue: { name: cur.name } }, req);
  ok(res, { deleted: true });
}));

/** Credentials typed into the popup — stored encrypted, never sent back */
router.put('/connectors/:id/credentials', manage, ah(async (req, res) => {
  const cur = await owned(req);
  const b = parse(z.object({ type: z.enum(['none', 'basic', 'bearer', 'header']), username: z.string().max(300).optional(), password: z.string().max(500).optional(), token: z.string().max(4000).optional(), headerName: z.string().max(100).optional() }), req.body);
  await q(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: T.text(encryptJson(b)), i: T.uuid(cur.connector_id) });
  await audit({ userId: req.user!.id, action: 'connector_credentials', entityType: 'connector', entityId: cur.connector_id, newValue: { type: b.type } }, req);
  ok(res, { saved: true });
}));

/** Looks at the source without writing anything: field names + the first rows, so the user can define the format / mapping */
router.post('/connectors/preview', manage, ah(async (req, res) => {
  const b = parse(z.object({ id: zId.optional(), kind: z.enum(['http', 'sharepoint']), config: cfgSchema, credentials: z.object({ type: z.enum(['none', 'basic', 'bearer', 'header']), username: z.string().optional(), password: z.string().optional(), token: z.string().optional(), headerName: z.string().optional() }).optional() }), req.body);
  let enc: string | null = null;
  if (b.id) { const cur = await q1(`SELECT * FROM Connectors WHERE connector_id = @i AND is_deleted = 0`, { i: T.uuid(b.id) }); if (cur && (cur.created_by.toLowerCase() === req.user!.id.toLowerCase() || req.user!.role === 'admin')) enc = cur.secret_enc; }
  if (b.credentials) enc = encryptJson(b.credentials);
  try {
    const f = await fetchSource(b.kind, b.config, enc, b.id ? async (e) => { await q(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: T.text(e), i: T.uuid(b.id!) }); } : undefined);
    const recs = parseRecords(f.body, b.config, f.contentType, f.finalUrl);
    const fields = [...new Set(recs.slice(0, 200).flatMap((r) => Object.keys(r)))];
    ok(res, { total: recs.length, fields, rows: recs.slice(0, 20), sheetNames: sheetNamesOf(f.body) });
  } catch (e) {
    if (e instanceof NeedsAuth) return void res.status(401).json({ success: false, error: { code: 'NEEDS_AUTH', message: e.message, details: needsAuthJson(e) } });
    throw badRequest((e as Error).message);
  }
}));

router.post('/connectors/:id/run', manage, ah(async (req, res) => {
  const cur = await owned(req);
  try {
    const r = await runConnector(cur.connector_id, { userId: req.user!.id });
    await audit({ userId: req.user!.id, action: 'connector_run', entityType: 'connector', entityId: cur.connector_id, newValue: { name: cur.name, ...r, errors: undefined } }, req);
    ok(res, r);
  } catch (e) {
    if (e instanceof NeedsAuth) return void res.status(401).json({ success: false, error: { code: 'NEEDS_AUTH', message: e.message, details: needsAuthJson(e) } });
    throw badRequest((e as Error).message);
  }
}));

/* ---------- Microsoft sign-in popup (SharePoint / OneDrive links) ---------- */
const baseUrl = (req: any) => env.publicUrl || `${req.protocol}://${req.get('host')}`;
router.get('/connectors/:id/ms/start', manage, ah(async (req, res) => {
  const cur = await owned(req);
  if (!msConfigured()) throw badRequest('ยังไม่ได้ตั้งค่า MS_CLIENT_ID / MS_CLIENT_SECRET บนเซิร์ฟเวอร์');
  const nonce = crypto.randomBytes(16).toString('hex');
  const st = jwt.sign({ c: cur.connector_id, u: req.user!.id, n: nonce }, env.jwt.secret, { expiresIn: '10m' });
  res.cookie(MS_STATE, st, { httpOnly: true, sameSite: 'lax', secure: env.cookieSecure, maxAge: 600_000, path: '/api/connectors/ms' });
  ok(res, { url: msAuthorizeUrl(baseUrl(req), nonce) });
}));
// the browser comes back from Microsoft without the API token: identity = signed state cookie
router.get('/connectors/ms/callback', ah(async (req, res) => {
  const done = (okFlag: boolean, msg: string) => res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:24px"><p>${okFlag ? '✅' : '❌'} ${msg.replace(/[<>&]/g, '')}</p><script>try{window.opener&&window.opener.postMessage({type:'ms-connector',ok:${okFlag}},window.location.origin)}catch(e){};setTimeout(()=>window.close(),okFlag?800:4000)</script>`);
  try {
    if (req.query.error) return done(false, String(req.query.error_description || req.query.error).slice(0, 200));
    const st = jwt.verify(String(req.cookies?.[MS_STATE] ?? ''), env.jwt.secret) as { c: string; u: string; n: string };
    res.clearCookie(MS_STATE, { path: '/api/connectors/ms' });
    if (st.n !== req.query.state || !req.query.code) return done(false, 'ข้อมูลยืนยันไม่ถูกต้อง');
    const tok = await msExchangeCode(baseUrl(req), String(req.query.code));
    if (!tok.refresh_token) return done(false, 'Microsoft ไม่ได้ส่ง refresh token (ตรวจสิทธิ์ offline_access ของแอป)');
    await q(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i AND is_deleted = 0`, { s: T.text(encryptJson({ type: 'none', msRefresh: tok.refresh_token })), i: T.uuid(st.c) });
    await audit({ userId: st.u, action: 'connector_ms_signin', entityType: 'connector', entityId: st.c }, req);
    done(true, 'เข้าสู่ระบบ Microsoft สำเร็จ — กลับไปที่หน้าเดิมได้เลย');
  } catch (e) { done(false, `เข้าสู่ระบบไม่สำเร็จ: ${(e as Error).message}`); }
}));

function safeHost(u: string) { try { return new URL(u).host; } catch { return ''; } }
export default router;
