import { q, q1, T } from '../../config/db';
import { AuthUser } from '../../middleware/auth';
import { badRequest } from '../../shared/http';
import { fetchSource, msConfigured, NeedsAuth } from '../connectors/source';
import { safeFetch } from '../connectors/safeFetch';

/**
 * A plan file given as a link (OneDrive / SharePoint / Google Drive / Dropbox / any direct link) instead of an upload — for computers
 * that only have Excel on the web. Anonymous links ("anyone with the link") are fetched straight away; a OneDrive / SharePoint link that
 * needs a login uses the Microsoft sign-in of the user (the same sign-in as the data connectors, kept as a connector named MS_CONNECTOR_NAME).
 */
export const MS_CONNECTOR_NAME = 'Microsoft ของฉัน (นำเข้าแผนผลิต)';
const isXlsx = (b: Buffer) => b.length > 200 && b[0] === 0x50 && b[1] === 0x4b;   // "PK" — an .xlsx is a zip
const MS_HOST = /(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms|sharepoint-df\.com)$/i;

/** Direct-download candidates of a share link (first = best guess) */
export function downloadCandidates(raw: string): string[] {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw badRequest('ลิงก์ไม่ถูกต้อง'); }
  if (u.protocol !== 'https:') throw badRequest('รองรับเฉพาะลิงก์ https');
  const h = u.hostname.toLowerCase();
  if (h === 'drive.google.com') {
    const id = /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
    return id ? [`https://drive.google.com/uc?export=download&id=${id}`] : [u.toString()];
  }
  if (h === 'docs.google.com') {
    const id = /\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname)?.[1];
    return id ? [`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`] : [u.toString()];
  }
  if (h.endsWith('dropbox.com')) { u.searchParams.set('dl', '1'); return [u.toString()]; }
  if (MS_HOST.test(h)) {
    const d = new URL(u); d.searchParams.set('download', '1');
    return [d.toString(), u.toString()];
  }
  return [u.toString()];
}

const nameFrom = (h: Headers, url: string): string => {
  const cd = h.get('content-disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  try { if (m) return decodeURIComponent(m[1] ?? m[2]); } catch { /* keep going */ }
  try { const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? ''); if (/\.xlsx?$/i.test(last)) return last; } catch { /* default */ }
  return 'แผนผลิต.xlsx';
};

async function myConnector(user: AuthUser, create: boolean) {
  const have = await q1(`SELECT connector_id, secret_enc FROM Connectors WHERE is_deleted = 0 AND created_by = @u AND name = @n`, { u: T.uuid(user.id), n: MS_CONNECTOR_NAME });
  if (have || !create) return have;
  return q1(`INSERT INTO Connectors (name, kind, config_json, schedule_min, created_by) OUTPUT inserted.connector_id, inserted.secret_enc VALUES (@n, N'sharepoint', @c, 0, @u)`,
    { n: MS_CONNECTOR_NAME, c: T.text(JSON.stringify({ url: 'https://graph.microsoft.com/', method: 'GET', format: 'xlsx' })), u: T.uuid(user.id) });
}
/** Connector row that carries the Microsoft sign-in of this user (created on first use) */
export async function ensureMsConnector(user: AuthUser): Promise<{ id: string; configured: boolean }> {
  const c = await myConnector(user, true);
  return { id: c!.connector_id as string, configured: msConfigured() };
}

export type LinkResult = { file: { buf: Buffer; name: string } } | { needsMicrosoft: { connectorId: string; configured: boolean; message: string } };

export async function fetchPlanFromLink(user: AuthUser, rawUrl: string): Promise<LinkResult> {
  const cands = downloadCandidates(rawUrl);
  let last = '';
  for (const url of cands) {
    try {
      const r = await safeFetch(url, { headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' } });
      if (r.status < 400 && isXlsx(r.body)) return { file: { buf: r.body, name: nameFrom(r.headers, r.finalUrl) } };
      last = r.status >= 400 ? `HTTP ${r.status}` : 'ไม่ใช่ไฟล์ Excel (อาจเป็นหน้าเข้าสู่ระบบ)';
    } catch (e) { last = (e as Error).message; }
  }
  const host = new URL(cands[0]).hostname;
  if (MS_HOST.test(host)) {
    const c = await ensureMsConnector(user);
    const enc = (await myConnector(user, false))?.secret_enc ?? null;
    try {
      const f = await fetchSource('sharepoint', { url: rawUrl.trim(), format: 'xlsx' } as never, enc, async (e) => { await q(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: T.text(e), i: T.uuid(c.id) }); });
      if (isXlsx(f.body)) return { file: { buf: f.body, name: nameFrom(new Headers({ 'content-type': f.contentType }), f.finalUrl) } };
      throw badRequest('ลิงก์นี้ไม่ใช่ไฟล์ Excel (.xlsx)');
    } catch (e) {
      if (e instanceof NeedsAuth || /MS_CLIENT_ID/.test((e as Error).message)) return { needsMicrosoft: { connectorId: c.id, configured: msConfigured(), message: (e as Error).message } };
      throw e;
    }
  }
  throw badRequest(`ดึงไฟล์จากลิงก์ไม่ได้ (${last}) — ตั้งการแชร์เป็น "ทุกคนที่มีลิงก์" หรือดาวน์โหลดไฟล์แล้วลากมาวาง`);
}
