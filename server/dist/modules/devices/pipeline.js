"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDeviceValue = handleDeviceValue;
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const permissions_1 = require("../../shared/permissions");
const logger_1 = require("../../shared/logger");
const http_1 = require("../../shared/http");
const sheetSettings_1 = require("../../services/sheetSettings");
const routes_1 = require("../scan/routes");
const cooldown_1 = require("./cooldown");
const slip_1 = require("./slip");
const DEBOUNCE_MS = Math.max(0, Number(process.env.DEVICE_DEBOUNCE_MS) || 3000);
const recent = new Map(); // device|value → last time (a tag in front of the reader is read many times a second)
const skipLogged = new Map(); // sheet|value → when a "skipped" line was last written (one per minute, not one per reading)
const touched = new Map();
/** "last read" of a device, written at most every 10 s */
function touch(deviceId, now) {
    if (now - (touched.get(deviceId) ?? 0) < 10_000)
        return;
    touched.set(deviceId, now);
    void (0, db_1.q)(`UPDATE Devices SET last_seen = SYSUTCDATETIME() WHERE device_id = @d`, { d: db_1.T.uuid(deviceId) }).catch(() => undefined);
}
const msgOf = (e) => (e.message ?? String(e)).slice(0, 300);
/**
 * One value from a device: written into every sheet bound to it, with that binding's scan format, in the name (and rights) of
 * the person who switched the binding on. Runs on the server so it works with nobody's page open.
 */
async function handleDeviceValue(deviceId, raw) {
    const value = raw.trim().slice(0, 300);
    if (!value)
        return { outcome: 'error', detail: 'ค่าว่าง' };
    const now = Date.now();
    const key = `${deviceId}|${value}`;
    if (now - (recent.get(key) ?? 0) < DEBOUNCE_MS)
        return { outcome: 'duplicate', detail: '' };
    recent.set(key, now);
    if (recent.size > 5000)
        for (const [k, t] of recent)
            if (now - t > DEBOUNCE_MS)
                recent.delete(k);
    const bindings = await (0, db_1.q)(`SELECT b.sheet_id, b.profile_id, b.run_as_user, b.printer_id, b.slip_json, sh.sheet_name
     FROM DeviceBindings b JOIN Sheets sh ON sh.sheet_id = b.sheet_id WHERE b.device_id = @d AND b.enabled = 1 AND sh.is_deleted = 0`, { d: db_1.T.uuid(deviceId) });
    const parts = [];
    let failed = false;
    let skipped = 0;
    for (const b of bindings) {
        let claimed = false;
        try {
            // per sheet, shared by all readers: the same card is not used again within the sheet's waiting time
            const waitMin = Number((await (0, sheetSettings_1.readSettings)(b.sheet_id)).devices?.cooldownMin) || 0;
            const c = await (0, cooldown_1.claimReading)(b.sheet_id, value, waitMin * 60);
            if (!c.ok) {
                skipped++;
                const k = `${b.sheet_id}|${value}`;
                if (now - (skipLogged.get(k) ?? 0) > 60_000) {
                    skipLogged.set(k, now);
                    parts.push(`${b.sheet_name}: ข้าม — อ่านการ์ดนี้ซ้ำภายใน ${waitMin} นาที (เหลือ ~${Math.ceil(c.remainingSec / 60)} นาที)`);
                }
                continue;
            }
            claimed = waitMin > 0;
            const user = await (0, auth_1.loadAuthUser)(b.run_as_user);
            if (!user)
                throw new Error('ผู้ที่เปิดการผูกนี้ถูกปิดการใช้งานแล้ว');
            const { sheet } = await (0, permissions_1.requireSheet)(user, b.sheet_id, permissions_1.LV.write);
            const r = await (0, routes_1.runScan)(user, sheet, b.sheet_id, value, b.profile_id);
            let printed = '';
            if (b.printer_id && r.action !== 'ignored') {
                // slip: the printer chosen for this reader → sheet; failing to print never undoes the reading itself
                try {
                    const cfg = (0, http_1.safeJson)(b.slip_json, {}) ?? {};
                    if (cfg.onlyStampColumnId && r.stampedColumnId?.toLowerCase() !== cfg.onlyStampColumnId.toLowerCase())
                        printed = ' · ไม่พิมพ์ (ไม่ใช่ช่วงที่ตั้งให้พิมพ์)';
                    else {
                        const printer = await (0, slip_1.loadPrinter)(b.printer_id);
                        if (!printer)
                            printed = ' · พิมพ์ไม่ได้ (เครื่องพิมพ์ถูกปิดหรือลบแล้ว)';
                        else {
                            await (0, slip_1.printSlip)(printer, { sheetName: b.sheet_name, sheetId: b.sheet_id, rowId: r.rowId, rowNo: r.rowNo, cfg, stamped: r.stamped, action: r.action });
                            printed = ` · พิมพ์สลิปที่ ${printer.printer_name}`;
                        }
                    }
                }
                catch (e) {
                    printed = ` · พิมพ์สลิปไม่สำเร็จ: ${msgOf(e)}`;
                    failed = true;
                }
            }
            parts.push(`${b.sheet_name}: ${r.action === 'created' ? 'เพิ่ม' : r.action === 'ignored' ? 'ไม่เปลี่ยน (ครบทุกช่องแล้ว)' : 'อัปเดต'}แถว #${r.rowNo}${r.stamped ? ` (ลงเวลา “${r.stamped}”)` : ''}${printed}`);
        }
        catch (e) {
            failed = true;
            parts.push(`${b.sheet_name}: ${msgOf(e)}`);
            if (claimed)
                await (0, cooldown_1.releaseReading)(b.sheet_id, value);
        }
    }
    touch(deviceId, now);
    if (bindings.length && skipped === bindings.length && !parts.length)
        return { outcome: 'duplicate', detail: '' }; // only skipped, already written once
    const outcome = !bindings.length ? 'unbound' : failed ? 'error' : 'ok';
    const detail = (bindings.length ? parts.join(' | ') : 'ยังไม่มีชีตที่ผูกกับอุปกรณ์นี้').slice(0, 1000);
    try {
        await (0, db_1.q)(`INSERT INTO DeviceEvents (device_id, value, outcome, detail) VALUES (@d, @v, @o, @t)`, { d: db_1.T.uuid(deviceId), v: db_1.T.text(value), o: db_1.T.text(outcome), t: db_1.T.text(detail) });
    }
    catch (e) {
        logger_1.logger.error(`device event log failed: ${msgOf(e)}`);
    }
    return { outcome, detail };
}
//# sourceMappingURL=pipeline.js.map