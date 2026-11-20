"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchDelayMapping = fetchDelayMapping;
exports.externalValues = externalValues;
const http_1 = require("../../shared/http");
const bootstrap_1 = require("../delayReport/bootstrap");
const safeFetch_1 = require("../connectors/safeFetch");
const logger_1 = require("../../shared/logger");
const parse_1 = require("./parse");
/** null = DelayHUB does not know the number; throws when DelayHUB cannot be reached */
async function fetchDelayMapping(id) {
    if (!(0, bootstrap_1.delayHubConfigured)())
        throw new Error('ยังไม่ได้ตั้ง DELAYHUB_URL / DELAYHUB_EXPORT_KEY ใน .env ของ DocHUB');
    const u = await (0, safeFetch_1.assertAllowedUrl)(`${(0, bootstrap_1.delayHubUrl)()}/api/export/mapping/${id}`);
    const r = await fetch(u, { headers: { 'x-export-key': String(process.env.DELAYHUB_EXPORT_KEY ?? '') }, signal: AbortSignal.timeout(8000) });
    if (r.status === 404)
        return null;
    if (!r.ok)
        throw new Error(`DelayHUB ตอบ ${r.status}`);
    const j = (await r.json());
    return j.data ?? null;
}
/** Values (column id → text) that DelayHUB gives for the mapping_id in the scanned text; what the QR itself carried is kept by the caller */
async function externalValues(profile, text, scanned) {
    const ex = profile.external;
    if (!ex)
        return {};
    const piece = (0, parse_1.splitScan)(text, profile.delimiter)[ex.pieceIndex - 1] ?? '';
    const id = /^\d{1,10}$/.test(piece) ? Number(piece) : 0;
    const miss = (why) => { if (ex.onMiss === 'reject')
        throw (0, http_1.badRequest)(why); return {}; };
    if (!id)
        return miss(`QR นี้ไม่มี mapping_id ในช่องที่ ${ex.pieceIndex} (“${piece}”)`);
    let m;
    try {
        m = await fetchDelayMapping(id);
    }
    catch (e) {
        logger_1.logger.warn(`scan external: mapping ${id}: ${e.message}`);
        return miss(`อ่านข้อมูล mapping_id ${id} จาก DelayHUB ไม่สำเร็จ: ${e.message}`);
    }
    if (!m)
        return miss(`ไม่พบ mapping_id ${id} ใน DelayHUB`);
    const out = {};
    for (const f of ex.fill) {
        const v = m[f.field];
        if (v !== null && v !== undefined && String(v).trim() !== '' && !(f.toColumnId in scanned))
            out[f.toColumnId] = String(v).trim();
    }
    return out;
}
//# sourceMappingURL=external.js.map