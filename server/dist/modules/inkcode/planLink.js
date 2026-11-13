"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MS_CONNECTOR_NAME = void 0;
exports.downloadCandidates = downloadCandidates;
exports.ensureMsConnector = ensureMsConnector;
exports.fetchPlanFromLink = fetchPlanFromLink;
const db_1 = require("../../config/db");
const http_1 = require("../../shared/http");
const source_1 = require("../connectors/source");
const safeFetch_1 = require("../connectors/safeFetch");
/**
 * A plan file given as a link (OneDrive / SharePoint / Google Drive / Dropbox / any direct link) instead of an upload — for computers
 * that only have Excel on the web. Anonymous links ("anyone with the link") are fetched straight away; a OneDrive / SharePoint link that
 * needs a login uses the Microsoft sign-in of the user (the same sign-in as the data connectors, kept as a connector named MS_CONNECTOR_NAME).
 */
exports.MS_CONNECTOR_NAME = 'Microsoft ของฉัน (นำเข้าแผนผลิต)';
const isXlsx = (b) => b.length > 200 && b[0] === 0x50 && b[1] === 0x4b; // "PK" — an .xlsx is a zip
const MS_HOST = /(^|\.)(sharepoint\.com|onedrive\.live\.com|1drv\.ms|sharepoint-df\.com)$/i;
/** Direct-download candidates of a share link (first = best guess) */
function downloadCandidates(raw) {
    let u;
    try {
        u = new URL(raw.trim());
    }
    catch {
        throw (0, http_1.badRequest)('ลิงก์ไม่ถูกต้อง');
    }
    if (u.protocol !== 'https:')
        throw (0, http_1.badRequest)('รองรับเฉพาะลิงก์ https');
    const h = u.hostname.toLowerCase();
    if (h === 'drive.google.com') {
        const id = /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? u.searchParams.get('id');
        return id ? [`https://drive.google.com/uc?export=download&id=${id}`] : [u.toString()];
    }
    if (h === 'docs.google.com') {
        const id = /\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname)?.[1];
        return id ? [`https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`] : [u.toString()];
    }
    if (h.endsWith('dropbox.com')) {
        u.searchParams.set('dl', '1');
        return [u.toString()];
    }
    if (MS_HOST.test(h)) {
        const d = new URL(u);
        d.searchParams.set('download', '1');
        return [d.toString(), u.toString()];
    }
    return [u.toString()];
}
const nameFrom = (h, url) => {
    const cd = h.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
    try {
        if (m)
            return decodeURIComponent(m[1] ?? m[2]);
    }
    catch { /* keep going */ }
    try {
        const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
        if (/\.xlsx?$/i.test(last))
            return last;
    }
    catch { /* default */ }
    return 'แผนผลิต.xlsx';
};
async function myConnector(user, create) {
    const have = await (0, db_1.q1)(`SELECT connector_id, secret_enc FROM Connectors WHERE is_deleted = 0 AND created_by = @u AND name = @n`, { u: db_1.T.uuid(user.id), n: exports.MS_CONNECTOR_NAME });
    if (have || !create)
        return have;
    return (0, db_1.q1)(`INSERT INTO Connectors (name, kind, config_json, schedule_min, created_by) OUTPUT inserted.connector_id, inserted.secret_enc VALUES (@n, N'sharepoint', @c, 0, @u)`, { n: exports.MS_CONNECTOR_NAME, c: db_1.T.text(JSON.stringify({ url: 'https://graph.microsoft.com/', method: 'GET', format: 'xlsx' })), u: db_1.T.uuid(user.id) });
}
/** Connector row that carries the Microsoft sign-in of this user (created on first use) */
async function ensureMsConnector(user) {
    const c = await myConnector(user, true);
    return { id: c.connector_id, configured: (0, source_1.msConfigured)() };
}
async function fetchPlanFromLink(user, rawUrl) {
    const cands = downloadCandidates(rawUrl);
    let last = '';
    for (const url of cands) {
        try {
            const r = await (0, safeFetch_1.safeFetch)(url, { headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' } });
            if (r.status < 400 && isXlsx(r.body))
                return { file: { buf: r.body, name: nameFrom(r.headers, r.finalUrl) } };
            last = r.status >= 400 ? `HTTP ${r.status}` : 'ไม่ใช่ไฟล์ Excel (อาจเป็นหน้าเข้าสู่ระบบ)';
        }
        catch (e) {
            last = e.message;
        }
    }
    const host = new URL(cands[0]).hostname;
    if (MS_HOST.test(host)) {
        const c = await ensureMsConnector(user);
        const enc = (await myConnector(user, false))?.secret_enc ?? null;
        try {
            const f = await (0, source_1.fetchSource)('sharepoint', { url: rawUrl.trim(), format: 'xlsx' }, enc, async (e) => { await (0, db_1.q)(`UPDATE Connectors SET secret_enc = @s WHERE connector_id = @i`, { s: db_1.T.text(e), i: db_1.T.uuid(c.id) }); });
            if (isXlsx(f.body))
                return { file: { buf: f.body, name: nameFrom(new Headers({ 'content-type': f.contentType }), f.finalUrl) } };
            throw (0, http_1.badRequest)('ลิงก์นี้ไม่ใช่ไฟล์ Excel (.xlsx)');
        }
        catch (e) {
            if (e instanceof source_1.NeedsAuth || /MS_CLIENT_ID/.test(e.message))
                return { needsMicrosoft: { connectorId: c.id, configured: (0, source_1.msConfigured)(), message: e.message } };
            throw e;
        }
    }
    throw (0, http_1.badRequest)(`ดึงไฟล์จากลิงก์ไม่ได้ (${last}) — ตั้งการแชร์เป็น "ทุกคนที่มีลิงก์" หรือดาวน์โหลดไฟล์แล้วลากมาวาง`);
}
//# sourceMappingURL=planLink.js.map