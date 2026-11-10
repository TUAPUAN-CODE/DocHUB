"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reqMeta = exports.clamp = exports.likeEscape = exports.zColor = exports.zId = exports.isGuid = exports.ah = exports.conflict = exports.notFound = exports.forbidden = exports.unauthorized = exports.badRequest = exports.AppError = void 0;
exports.parse = parse;
exports.pid = pid;
exports.ok = ok;
exports.pageParams = pageParams;
exports.safeJson = safeJson;
const zod_1 = require("zod");
class AppError extends Error {
    constructor(status, code, message, details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
exports.AppError = AppError;
const badRequest = (m, d) => new AppError(400, 'BAD_REQUEST', m, d);
exports.badRequest = badRequest;
const unauthorized = (m = 'กรุณาเข้าสู่ระบบ', code = 'UNAUTHORIZED') => new AppError(401, code, m);
exports.unauthorized = unauthorized;
const forbidden = (m = 'คุณไม่มีสิทธิ์ดำเนินการนี้', code = 'FORBIDDEN', d) => new AppError(403, code, m, d);
exports.forbidden = forbidden;
const notFound = (m = 'ไม่พบข้อมูลที่ต้องการ') => new AppError(404, 'NOT_FOUND', m);
exports.notFound = notFound;
const conflict = (m, code = 'CONFLICT', d) => new AppError(409, code, m, d);
exports.conflict = conflict;
/** Wraps an async route so rejected promises reach the error middleware */
const ah = (fn) => (req, res, next) => {
    fn(req, res, next).catch(next);
};
exports.ah = ah;
function parse(schema, data) {
    const r = schema.safeParse(data);
    if (!r.success) {
        const issues = r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
        const first = issues[0];
        throw (0, exports.badRequest)(first ? `ข้อมูลไม่ถูกต้อง (${first.path || 'ค่า'}): ${first.message}` : 'ข้อมูลไม่ถูกต้อง', issues);
    }
    return r.data;
}
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGuid = (v) => typeof v === 'string' && GUID.test(v);
exports.isGuid = isGuid;
exports.zId = zod_1.z
    .string()
    .regex(GUID, 'รหัสอ้างอิงไม่ถูกต้อง')
    .transform((s) => s.toLowerCase());
exports.zColor = zod_1.z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'รูปแบบสีไม่ถูกต้อง');
function pid(req, name = 'id') {
    const v = req.params[name];
    if (!(0, exports.isGuid)(v))
        throw (0, exports.badRequest)('รหัสอ้างอิงไม่ถูกต้อง');
    return v.toLowerCase();
}
function ok(res, data, status = 200) {
    res.status(status).json({ success: true, data });
}
function pageParams(query, defSize = 25, maxSize = 200) {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(maxSize, Math.max(1, Number(query.pageSize) || defSize));
    return { page, pageSize, offset: (page - 1) * pageSize };
}
function safeJson(s, d) {
    if (s === null || s === undefined || s === '')
        return d;
    try {
        return JSON.parse(s);
    }
    catch {
        return d;
    }
}
/** Escapes LIKE wildcards for SQL Server */
const likeEscape = (s) => s.replace(/[[\]%_]/g, (m) => `[${m}]`);
exports.likeEscape = likeEscape;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
exports.clamp = clamp;
const reqMeta = (req) => ({
    ip: req?.ip ?? null,
    ua: req?.headers['user-agent']?.slice(0, 500) ?? null,
    socketId: req?.headers['x-socket-id'] ?? undefined,
});
exports.reqMeta = reqMeta;
//# sourceMappingURL=http.js.map