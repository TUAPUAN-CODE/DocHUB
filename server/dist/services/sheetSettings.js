"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSettings = readSettings;
exports.writeSettingsKey = writeSettingsKey;
exports.remapIds = remapIds;
exports.assertRowRoom = assertRowRoom;
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
/** Sheet settings JSON is shared by several modules: each reads / writes only its own key */
/** `tx`: inside a transaction that created / changed the sheet (reading outside it would wait for that same transaction) */
async function readSettings(sheetId, tx) {
    const r = await (0, db_1.q1)(`SELECT settings_json FROM Sheets WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) }, tx);
    return (0, http_1.safeJson)(r?.settings_json, {}) ?? {};
}
async function writeSettingsKey(sheetId, key, value, tx) {
    const cur = await readSettings(sheetId, tx);
    if (value === null || value === undefined)
        delete cur[key];
    else
        cur[key] = value;
    await (0, db_1.q)(`UPDATE Sheets SET settings_json = @j, updated_at = SYSUTCDATETIME() WHERE sheet_id = @s`, { j: db_1.T.text(JSON.stringify(cur)), s: db_1.T.uuid(sheetId) }, tx);
    return cur;
}
/** Replaces column ids inside a settings value (used after a sheet copy) */
function remapIds(value, map) {
    const walk = (v) => {
        if (typeof v === 'string')
            return map.get(v.toLowerCase()) ?? v;
        if (Array.isArray(v))
            return v.map(walk);
        if (v && typeof v === 'object')
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
        return v;
    };
    return walk(value);
}
/**
 * A sheet marked `singleRow` (settings) keeps ONE row — e.g. the header of a form file where 1 file = 1 document. Called before rows are added
 * (`adding` = how many): refuses when the sheet would then have more than one live row. Deleted rows (trash) do not count.
 */
async function assertRowRoom(sheetId, adding, tx) {
    const s = await readSettings(sheetId, tx);
    if (!s.singleRow)
        return;
    const n = await (0, db_1.q1)(`SELECT COUNT(*) AS n FROM Rows WHERE sheet_id = @s AND is_deleted = 0`, { s: db_1.T.uuid(sheetId) }, tx);
    if (Number(n?.n ?? 0) + adding > 1)
        throw (0, http_1.badRequest)('ชีตนี้เก็บได้แถวเดียว (1 ไฟล์ = 1 เอกสาร) — ถ้าจะทำเอกสารใหม่ ให้ทำสำเนาไฟล์');
}
//# sourceMappingURL=sheetSettings.js.map