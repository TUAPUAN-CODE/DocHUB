"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncGatewayNow = syncGatewayNow;
exports.startGateway = startGateway;
const net_1 = __importDefault(require("net"));
const db_1 = require("../../config/db");
const logger_1 = require("../../shared/logger");
const rfidFrame_1 = require("./rfidFrame");
const pipeline_1 = require("./pipeline");
const cooldown_1 = require("./cooldown");
/**
 * Keeps one TCP connection per enabled "rfid_tcp" device (reconnects with back-off, cuts a silent half-open line) and feeds EPCs to the pipeline.
 * Off unless GATEWAY_ENABLED=1: a reader accepts ONE connection, so only ONE program may talk to it — do not enable it
 * while PFCM's RFIDc1.js is connected to the same reader.
 */
const SYNC_MS = 15_000;
const CONNECT_TIMEOUT_MS = 10_000;
const SILENCE_MS = Number(process.env.RFID_SILENCE_RECONNECT_MS ?? 10 * 60_000) || 0;
const conns = new Map();
const setStatus = (id, status, error = null) => (0, db_1.q)(`UPDATE Devices SET status = @s, last_error = @e WHERE device_id = @d`, { s: db_1.T.text(status), e: db_1.T.text(error), d: db_1.T.uuid(id) }).catch(() => undefined);
function connect(id, name, host, port, initHex, startHex) {
    let sock = null;
    let timer = null;
    let silence = null;
    let stopped = false;
    let attempt = 0;
    const parser = (0, rfidFrame_1.createFrameParser)();
    const armSilence = () => {
        if (!SILENCE_MS)
            return;
        if (silence)
            clearTimeout(silence);
        silence = setTimeout(() => { logger_1.logger.warn(`RFID ${name}: ไม่มีข้อมูลนาน ต่อใหม่`); sock?.destroy(); }, SILENCE_MS);
    };
    const retry = () => {
        if (stopped)
            return;
        const wait = Math.min(30_000, 2000 * 2 ** Math.min(attempt++, 4));
        timer = setTimeout(open, wait);
    };
    function open() {
        if (stopped)
            return;
        parser.reset();
        sock = net_1.default.createConnection({ host, port });
        sock.setTimeout(CONNECT_TIMEOUT_MS, () => { if (!sock?.remoteAddress)
            sock?.destroy(new Error('เชื่อมต่อหมดเวลา'));
        else
            sock.setTimeout(0); });
        sock.setKeepAlive(true, 15_000);
        sock.on('connect', () => {
            attempt = 0;
            sock?.setTimeout(0);
            void setStatus(id, 'connected');
            logger_1.logger.info(`RFID ${name}: เชื่อมต่อ ${host}:${port}`);
            armSilence();
            // the reader sends tags only after these two commands (same as PFCM's RFIDc1.js)
            const i = initHex && (0, rfidFrame_1.isHex)(initHex) ? initHex : rfidFrame_1.DEFAULT_INIT_HEX;
            const st = startHex && (0, rfidFrame_1.isHex)(startHex) ? startHex : rfidFrame_1.DEFAULT_START_HEX;
            sock?.write((0, rfidFrame_1.withChecksum)(i));
            sock?.write(Buffer.from(st, 'hex'));
        });
        sock.on('data', (d) => {
            armSilence();
            for (const epc of parser.push(d))
                if ((0, rfidFrame_1.isValidEpc)(epc))
                    void (0, pipeline_1.handleDeviceValue)(id, epc).catch((e) => logger_1.logger.error(`RFID ${name}: ${e.message}`));
        });
        sock.on('error', (e) => { void setStatus(id, 'error', e.message.slice(0, 300)); });
        sock.on('close', () => { if (silence)
            clearTimeout(silence); if (!stopped) {
            void setStatus(id, 'disconnected');
            retry();
        } });
    }
    open();
    return { key: `${host}:${port}|${name}|${initHex ?? ''}|${startHex ?? ''}`, stop: () => { stopped = true; if (timer)
            clearTimeout(timer); if (silence)
            clearTimeout(silence); sock?.destroy(); void setStatus(id, 'off'); } };
}
async function syncGatewayNow() {
    if (process.env.GATEWAY_ENABLED === '1')
        await sync().catch((e) => logger_1.logger.error(`RFID gateway sync failed: ${e.message}`));
}
async function sync() {
    const rows = await (0, db_1.q)(`SELECT device_id, device_name, host, port, init_hex, start_hex FROM Devices WHERE kind = N'rfid_tcp' AND enabled = 1 AND host IS NOT NULL AND port IS NOT NULL`);
    const want = new Map(rows.map((r) => [String(r.device_id).toLowerCase(), r]));
    for (const [id, c] of conns) {
        const w = want.get(id);
        if (!w || c.key !== `${w.host}:${w.port}|${w.device_name}|${w.init_hex ?? ''}|${w.start_hex ?? ''}`) {
            c.stop();
            conns.delete(id);
        }
    }
    for (const [id, r] of want)
        if (!conns.has(id))
            conns.set(id, connect(id, r.device_name, r.host, Number(r.port), r.init_hex ?? null, r.start_hex ?? null));
}
function startGateway() {
    if (process.env.GATEWAY_ENABLED !== '1') {
        logger_1.logger.info('RFID gateway off (set GATEWAY_ENABLED=1 on the servers allowed to run it)');
        return;
    }
    const tick = () => void sync().catch((e) => logger_1.logger.error(`RFID gateway sync failed: ${e.message}`));
    tick();
    const timers = [
        setInterval(tick, SYNC_MS),
        setInterval(() => void (0, db_1.q)(`DELETE FROM DeviceEvents WHERE received_at < DATEADD(DAY, -30, SYSUTCDATETIME())`).catch(() => undefined), 6 * 3600_000),
        setInterval(() => void (0, cooldown_1.purgeCooldowns)(), 6 * 3600_000),
    ];
    timers.forEach((t) => t.unref());
    logger_1.logger.info('RFID gateway on');
    // losing the lease: drop every reader connection so the server that takes over can connect (a reader accepts ONE connection)
    return () => { timers.forEach(clearInterval); for (const [id, c] of conns) {
        c.stop();
        conns.delete(id);
    } };
}
//# sourceMappingURL=gateway.js.map