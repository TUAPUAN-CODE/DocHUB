"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceIngest = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const auth_1 = require("../../middleware/auth");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const sheetSettings_1 = require("../../services/sheetSettings");
const pipeline_1 = require("./pipeline");
const slip_1 = require("./slip");
const cellWriter_1 = require("../../services/cellWriter");
const gateway_1 = require("./gateway");
const rfidFrame_1 = require("./rfidFrame");
/** Public: an HTTP / IoT sender posts a value with its key (no login) */
exports.deviceIngest = (0, express_1.Router)();
exports.deviceIngest.post('/devices/ingest', (0, http_1.ah)(async (req, res) => {
    const key = String(req.get('x-device-key') ?? '');
    const { value } = (0, http_1.parse)(zod_1.z.object({ value: zod_1.z.string().min(1).max(300) }), req.body);
    if (key.length < 20)
        return void res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'device key ไม่ถูกต้อง' } });
    const hash = crypto_1.default.createHash('sha256').update(key).digest('hex');
    const d = await (0, db_1.q1)(`SELECT device_id, enabled FROM Devices WHERE kind = N'http' AND api_key_hash = @h`, { h: db_1.T.text(hash) });
    if (!d)
        return void res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'device key ไม่ถูกต้อง' } });
    if (!d.enabled)
        return void res.status(409).json({ success: false, error: { code: 'DISABLED', message: 'อุปกรณ์นี้ถูกปิดอยู่' } });
    (0, http_1.ok)(res, await (0, pipeline_1.handleDeviceValue)(d.device_id, value));
}));
const router = (0, express_1.Router)();
const admin = (0, auth_1.requireRole)('master', 'admin');
const map = (d) => ({ id: d.device_id, name: d.device_name, kind: d.kind, host: d.host, port: d.port, initHex: d.init_hex ?? null, startHex: d.start_hex ?? null, enabled: !!d.enabled, status: d.status, lastSeen: d.last_seen, lastError: d.last_error, bindings: Number(d.n_bind ?? 0) });
router.get('/devices', admin, (0, http_1.ah)(async (_req, res) => {
    const rows = await (0, db_1.q)(`SELECT d.device_id, d.device_name, d.kind, d.host, d.port, d.init_hex, d.start_hex, d.enabled, d.status, d.last_seen, d.last_error,
      (SELECT COUNT(*) FROM DeviceBindings b WHERE b.device_id = d.device_id AND b.enabled = 1) AS n_bind FROM Devices d ORDER BY d.device_name`);
    (0, http_1.ok)(res, { devices: rows.map(map), gateway: process.env.GATEWAY_ENABLED === '1' });
}));
const body = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(100), kind: zod_1.z.enum(['rfid_tcp', 'http']), host: zod_1.z.string().trim().max(200).nullish(), port: zod_1.z.number().int().min(1).max(65535).nullish(), initHex: zod_1.z.string().trim().max(200).nullish(), startHex: zod_1.z.string().trim().max(200).nullish() });
const hexOk = (h) => !h || (0, rfidFrame_1.isHex)(h);
router.post('/devices', admin, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(body, req.body);
    if (b.kind === 'rfid_tcp' && (!b.host || !b.port))
        throw (0, http_1.badRequest)('เครื่องอ่าน RFID ต้องระบุ IP และพอร์ต');
    if (!hexOk(b.initHex) || !hexOk(b.startHex))
        throw (0, http_1.badRequest)('คำสั่งเริ่มอ่านต้องเป็นเลขฐาน 16 เป็นคู่ เช่น 7CFFFF20');
    const apiKey = b.kind === 'http' ? crypto_1.default.randomBytes(24).toString('hex') : null;
    const r = await (0, db_1.q1)(`INSERT INTO Devices (device_name, kind, host, port, api_key_hash, init_hex, start_hex, created_by) OUTPUT inserted.device_id VALUES (@n, @k, @h, @p, @a, @i, @st, @u)`, { n: db_1.T.text(b.name), k: db_1.T.text(b.kind), i: db_1.T.text(b.kind === 'rfid_tcp' ? b.initHex || null : null), st: db_1.T.text(b.kind === 'rfid_tcp' ? b.startHex || null : null), h: db_1.T.text(b.kind === 'rfid_tcp' ? b.host ?? null : null), p: db_1.T.int(b.kind === 'rfid_tcp' ? b.port ?? null : null), a: db_1.T.text(apiKey ? crypto_1.default.createHash('sha256').update(apiKey).digest('hex') : null), u: db_1.T.uuid(req.user.id) });
    void (0, gateway_1.syncGatewayNow)();
    (0, http_1.ok)(res, { id: r.device_id, apiKey }, 201); // the key is shown only now
}));
router.put('/devices/:id', admin, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(body.partial().extend({ enabled: zod_1.z.boolean().optional() }), req.body);
    if (!hexOk(b.initHex) || !hexOk(b.startHex))
        throw (0, http_1.badRequest)('คำสั่งเริ่มอ่านต้องเป็นเลขฐาน 16 เป็นคู่ เช่น 7CFFFF20');
    const cur = await (0, db_1.q1)(`SELECT device_id, kind FROM Devices WHERE device_id = @d`, { d: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!cur)
        throw (0, http_1.notFound)('ไม่พบอุปกรณ์');
    await (0, db_1.q)(`UPDATE Devices SET device_name = ISNULL(@n, device_name), host = CASE WHEN kind = N'rfid_tcp' THEN ISNULL(@h, host) ELSE host END, port = CASE WHEN kind = N'rfid_tcp' THEN ISNULL(@p, port) ELSE port END,
           init_hex = CASE WHEN kind = N'rfid_tcp' AND @i IS NOT NULL THEN NULLIF(@i, N'-') ELSE init_hex END, start_hex = CASE WHEN kind = N'rfid_tcp' AND @st IS NOT NULL THEN NULLIF(@st, N'-') ELSE start_hex END,
           enabled = ISNULL(@e, enabled), status = CASE WHEN @e = 0 THEN N'off' ELSE status END WHERE device_id = @d`, { n: db_1.T.text(b.name ?? null), h: db_1.T.text(b.host ?? null), p: db_1.T.int(b.port ?? null), i: db_1.T.text(b.initHex === undefined || b.initHex === null ? null : b.initHex || '-'), st: db_1.T.text(b.startHex === undefined || b.startHex === null ? null : b.startHex || '-'), e: db_1.T.bit(b.enabled ?? null), d: db_1.T.uuid(cur.device_id) });
    void (0, gateway_1.syncGatewayNow)();
    (0, http_1.ok)(res, { saved: true });
}));
router.delete('/devices/:id', admin, (0, http_1.ah)(async (req, res) => {
    const d = db_1.T.uuid((0, http_1.pid)(req));
    await (0, db_1.q)(`DELETE FROM DeviceBindings WHERE device_id = @d`, { d });
    await (0, db_1.q)(`DELETE FROM DeviceEvents WHERE device_id = @d`, { d });
    await (0, db_1.q)(`DELETE FROM Devices WHERE device_id = @d`, { d });
    (0, http_1.ok)(res, { removed: true });
}));
router.get('/devices/:id/events', admin, (0, http_1.ah)(async (req, res) => {
    const rows = await (0, db_1.q)(`SELECT TOP 50 event_id, value, received_at, outcome, detail FROM DeviceEvents WHERE device_id = @d ORDER BY event_id DESC`, { d: db_1.T.uuid((0, http_1.pid)(req)) });
    (0, http_1.ok)(res, { events: rows.map((e) => ({ id: Number(e.event_id), value: e.value, at: e.received_at, outcome: e.outcome, detail: e.detail })) });
}));
/** Simulation: the same path a real reading takes (test the sheet setup without a reader) */
router.post('/devices/:id/test-event', admin, (0, http_1.ah)(async (req, res) => {
    const { value } = (0, http_1.parse)(zod_1.z.object({ value: zod_1.z.string().trim().min(1).max(300) }), req.body);
    const d = await (0, db_1.q1)(`SELECT device_id FROM Devices WHERE device_id = @d`, { d: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!d)
        throw (0, http_1.notFound)('ไม่พบอุปกรณ์');
    (0, http_1.ok)(res, await (0, pipeline_1.handleDeviceValue)(d.device_id, `${value}`));
}));
/* ---------------- slip printers (print-agent of PFCM) ---------------- */
const printerBody = zod_1.z.object({
    name: zod_1.z.string().trim().min(1).max(100),
    agentUrl: zod_1.z.string().trim().url().max(300),
    printerHost: zod_1.z.string().trim().max(200).nullish(), printerShare: zod_1.z.string().trim().max(100).nullish(),
    dotWidth: zod_1.z.number().int().min(100).max(1600).nullish(), enabled: zod_1.z.boolean().optional(),
});
const printerMap = (p) => ({ id: p.printer_id, name: p.printer_name, agentUrl: p.agent_url, printerHost: p.printer_host, printerShare: p.printer_share, dotWidth: p.dot_width, enabled: !!p.enabled });
router.get('/printers', admin, (0, http_1.ah)(async (_req, res) => {
    (0, http_1.ok)(res, { printers: (await (0, db_1.q)(`SELECT printer_id, printer_name, agent_url, printer_host, printer_share, dot_width, enabled FROM Printers ORDER BY printer_name`)).map(printerMap) });
}));
router.post('/printers', admin, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(printerBody, req.body);
    if (!!b.printerHost !== !!b.printerShare)
        throw (0, http_1.badRequest)('ถ้าพิมพ์ผ่านเครื่องที่แชร์เครื่องพิมพ์ ต้องใส่ทั้ง IP/ชื่อเครื่อง และชื่อ share');
    const r = await (0, db_1.q1)(`INSERT INTO Printers (printer_name, agent_url, printer_host, printer_share, dot_width, created_by) OUTPUT inserted.printer_id VALUES (@n, @a, @h, @s, @w, @u)`, { n: db_1.T.text(b.name), a: db_1.T.text(b.agentUrl), h: db_1.T.text(b.printerHost || null), s: db_1.T.text(b.printerShare || null), w: db_1.T.int(b.dotWidth ?? null), u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { id: r.printer_id }, 201);
}));
router.put('/printers/:id', admin, (0, http_1.ah)(async (req, res) => {
    const b = (0, http_1.parse)(printerBody.partial(), req.body);
    await (0, db_1.q)(`UPDATE Printers SET printer_name = ISNULL(@n, printer_name), agent_url = ISNULL(@a, agent_url), printer_host = CASE WHEN @hset = 1 THEN @h ELSE printer_host END, printer_share = CASE WHEN @hset = 1 THEN @s ELSE printer_share END,
          dot_width = CASE WHEN @wset = 1 THEN @w ELSE dot_width END, enabled = ISNULL(@e, enabled) WHERE printer_id = @p`, { n: db_1.T.text(b.name ?? null), a: db_1.T.text(b.agentUrl ?? null), hset: db_1.T.bit('printerHost' in b || 'printerShare' in b), h: db_1.T.text(b.printerHost || null), s: db_1.T.text(b.printerShare || null), wset: db_1.T.bit('dotWidth' in b), w: db_1.T.int(b.dotWidth ?? null), e: db_1.T.bit(b.enabled ?? null), p: db_1.T.uuid((0, http_1.pid)(req)) });
    (0, http_1.ok)(res, { saved: true });
}));
router.delete('/printers/:id', admin, (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`UPDATE DeviceBindings SET printer_id = NULL WHERE printer_id = @p`, { p: db_1.T.uuid((0, http_1.pid)(req)) });
    await (0, db_1.q)(`DELETE FROM Printers WHERE printer_id = @p`, { p: db_1.T.uuid((0, http_1.pid)(req)) });
    (0, http_1.ok)(res, { removed: true });
}));
/** A test slip, to see that the agent, the share and the paper work */
router.post('/printers/:id/test', admin, (0, http_1.ah)(async (req, res) => {
    const p = await (0, db_1.q1)(`SELECT printer_id, printer_name, agent_url, printer_host, printer_share, dot_width FROM Printers WHERE printer_id = @p`, { p: db_1.T.uuid((0, http_1.pid)(req)) });
    if (!p)
        throw (0, http_1.notFound)('ไม่พบเครื่องพิมพ์');
    try {
        const res2 = await fetch(`${String(p.agent_url).replace(/\/+$/, '')}/print-generic`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45_000),
            body: JSON.stringify({ identifier: `test:${p.printer_id}:${Date.now()}`, title: 'ทดสอบเครื่องพิมพ์', subtitle: p.printer_name, rows: [{ label: 'เครื่องพิมพ์', value: p.printer_name }, { label: 'เวลา', value: new Date().toLocaleString('th-TH') }], qr: 'DataSheet Pro', printerHost: p.printer_host || undefined, printerShare: p.printer_share || undefined, printerDotWidth: p.dot_width || undefined }),
        });
        const j = (await res2.json().catch(() => ({})));
        if (!res2.ok || !j.ok)
            throw new Error(j.error ?? `Print Agent ตอบ ${res2.status}`);
    }
    catch (e) {
        throw (0, http_1.badRequest)(`พิมพ์ทดสอบไม่สำเร็จ: ${e.message}`);
    }
    (0, http_1.ok)(res, { sent: true });
}));
/** For managers of a sheet: which devices write into this sheet */
router.get('/sheets/:id/devices', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const devices = await (0, db_1.q)(`SELECT device_id, device_name, kind, status FROM Devices ORDER BY device_name`);
    const binds = await (0, db_1.q)(`SELECT device_id, enabled, profile_id, printer_id, slip_json FROM DeviceBindings WHERE sheet_id = @s`, { s: db_1.T.uuid(sheetId) });
    const printers = await (0, db_1.q)(`SELECT printer_id, printer_name FROM Printers WHERE enabled = 1 ORDER BY printer_name`);
    const by = new Map(binds.map((b) => [String(b.device_id).toLowerCase(), b]));
    const cooldownMin = Number((await (0, sheetSettings_1.readSettings)(sheetId)).devices?.cooldownMin) || 0;
    (0, http_1.ok)(res, { cooldownMin, printers: printers.map((p) => ({ id: p.printer_id, name: p.printer_name })), devices: devices.map((d) => { const b = by.get(String(d.device_id).toLowerCase()); return { id: d.device_id, name: d.device_name, kind: d.kind, status: d.status, bound: !!b, enabled: !!b?.enabled, profileId: b?.profile_id ?? null, printerId: b?.printer_id ?? null, slip: (0, http_1.safeJson)(b?.slip_json, null) }; }) });
}));
router.put('/sheets/:id/devices/:deviceId', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const u = req.user;
    await (0, permissions_1.requireSheet)(u, sheetId, permissions_1.LV.manage);
    const b = (0, http_1.parse)(zod_1.z.object({
        enabled: zod_1.z.boolean(), profileId: zod_1.z.string().max(40).nullish(), printerId: http_1.zId.nullish(),
        slip: zod_1.z.object({ title: zod_1.z.string().max(80).nullish(), columnIds: zod_1.z.array(http_1.zId).max(30).nullish(), qr: zod_1.z.enum(['none', 'rowNo', 'column']).optional(), qrColumnId: http_1.zId.nullish(), onlyStampColumnId: http_1.zId.nullish() }).nullish(),
    }), req.body);
    if (b.printerId && !(await (0, db_1.q1)(`SELECT printer_id FROM Printers WHERE printer_id = @p`, { p: db_1.T.uuid(b.printerId) })))
        throw (0, http_1.badRequest)('ไม่พบเครื่องพิมพ์ที่เลือก');
    if (b.slip) {
        const cols = new Set((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => c.column_id));
        for (const id of [...(b.slip.columnIds ?? []), b.slip.qrColumnId, b.slip.onlyStampColumnId])
            if (id && !cols.has(id))
                throw (0, http_1.badRequest)('ไม่พบคอลัมน์ที่เลือกในสลิป (อาจถูกลบแล้ว)');
    }
    const dev = await (0, db_1.q1)(`SELECT device_id FROM Devices WHERE device_id = @d`, { d: db_1.T.uuid(String(req.params.deviceId)) });
    if (!dev)
        throw (0, http_1.notFound)('ไม่พบอุปกรณ์');
    await (0, db_1.q)(`MERGE DeviceBindings AS t USING (SELECT @d AS device_id, @s AS sheet_id) AS s ON t.device_id = s.device_id AND t.sheet_id = s.sheet_id
     WHEN MATCHED THEN UPDATE SET enabled = @e, profile_id = @p, run_as_user = @u, printer_id = CASE WHEN @prset = 1 THEN @pr ELSE printer_id END, slip_json = CASE WHEN @slset = 1 THEN @sl ELSE slip_json END
     WHEN NOT MATCHED THEN INSERT (device_id, sheet_id, enabled, profile_id, run_as_user, printer_id, slip_json) VALUES (@d, @s, @e, @p, @u, @pr, @sl);`, { d: db_1.T.uuid(dev.device_id), s: db_1.T.uuid(sheetId), e: db_1.T.bit(b.enabled), p: db_1.T.text(b.profileId ?? null), u: db_1.T.uuid(u.id), prset: db_1.T.bit('printerId' in b), slset: db_1.T.bit('slip' in b), pr: db_1.T.uuid(b.printerId ?? null), sl: db_1.T.text(b.slip ? JSON.stringify(b.slip) : null) });
    (0, http_1.ok)(res, { saved: true });
}));
/** Waiting time of a sheet: the same card is not used again within N minutes — shared by every reader that writes into the sheet */
router.put('/sheets/:id/devices-settings', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const b = (0, http_1.parse)(zod_1.z.object({ cooldownMin: zod_1.z.number().min(0).max(1440) }), req.body);
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'devices', b.cooldownMin > 0 ? { cooldownMin: b.cooldownMin } : null);
    (0, http_1.ok)(res, { saved: true });
}));
void http_1.zId;
void slip_1.printSlip;
exports.default = router;
//# sourceMappingURL=routes.js.map