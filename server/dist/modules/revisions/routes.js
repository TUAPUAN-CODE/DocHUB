"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const sheetSettings_1 = require("../../services/sheetSettings");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const permissions_1 = require("../../shared/permissions");
const socket_1 = require("../../socket");
const diff_1 = require("./diff");
const service_1 = require("./service");
const router = (0, express_1.Router)();
/** Revisions of a sheet + a quick count of rows touched since the latest one */
router.get('/sheets/:id/revisions', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const { level } = await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read, undefined, true);
    const revisions = await (0, service_1.listRevisions)(sheetId);
    const docType = await (0, service_1.sheetDocType)(sheetId);
    const pending = revisions.length ? await (0, service_1.pendingCounts)(sheetId, revisions[0].createdAt) : null;
    // a form's data never waits for a revision; only its format does
    (0, http_1.ok)(res, { revisions, pending: docType === 'record' ? null : pending, pendingFormat: revisions.length ? await (0, service_1.pendingFormatCount)(sheetId) : null,
        docType, keyColumnIds: await (0, service_1.keyColumnIds)(sheetId), canIssue: level >= permissions_1.LV.write });
}));
/** Exactly what changed since the latest revision (what "ออก Rev" would record) */
router.get('/sheets/:id/revisions/pending', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read, undefined, true);
    (0, http_1.ok)(res, await (0, service_1.pendingDiff)(sheetId));
}));
/** Columns that name a row in the change list, e.g. Sub Doc No. + Short Code */
router.put('/sheets/:id/revisions/settings', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.manage);
    const body = (0, http_1.parse)(zod_1.z.object({ keyColumnIds: zod_1.z.array(http_1.zId).max(5) }), req.body);
    await (0, sheetSettings_1.writeSettingsKey)(sheetId, 'revisions', { keyColumnIds: body.keyColumnIds });
    (0, http_1.ok)(res, { keyColumnIds: body.keyColumnIds });
}));
/** One revision (number, or "latest") with its changes since the previous one */
router.get('/sheets/:id/revisions/:rev', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.read, undefined, true);
    const raw = String(req.params.rev);
    const n = raw === 'latest' ? null : Number(raw);
    if (n !== null && (!Number.isInteger(n) || n < 0))
        throw (0, http_1.badRequest)('เลข Rev ไม่ถูกต้อง');
    const r = await (0, service_1.getRevision)(sheetId, n);
    if (!r)
        throw (0, http_1.notFound)(n === null ? 'ชีตนี้ยังไม่เคยออก Rev' : `ไม่พบ Rev.${n}`);
    (0, http_1.ok)(res, r);
}));
/** "ออก Rev ใหม่": freeze the sheet as the next revision */
router.post('/sheets/:id/revisions', (0, http_1.ah)(async (req, res) => {
    const sheetId = (0, http_1.pid)(req);
    const { sheet } = await (0, permissions_1.requireSheet)(req.user, sheetId, permissions_1.LV.write);
    const body = (0, http_1.parse)(zod_1.z.object({ note: zod_1.z.string().trim().max(1000).nullish(), firstRevNo: zod_1.z.number().int().min(0).max(100000).nullish() }), req.body ?? {});
    const r = await (0, db_1.withTx)((tx) => (0, service_1.createRevision)(tx, sheetId, req.user.id, body.note || null, body.firstRevNo ?? null));
    if ('error' in r)
        throw (0, http_1.badRequest)(r.error);
    await (0, audit_1.audit)({ userId: req.user.id, action: 'revision_create', entityType: 'sheet', entityId: sheetId, fileId: sheet.file_id, sheetId,
        newValue: { revNo: r.revNo, note: body.note || null, rows: r.rowCount, ...(r.diff ? (0, diff_1.diffCounts)(r.diff) : {}) } }, req);
    (0, socket_1.emitToSheet)(sheetId, 'sheet:revision', { revNo: r.revNo });
    (0, http_1.ok)(res, { revNo: r.revNo, rowCount: r.rowCount, diff: r.diff, formatDiff: r.formatDiff, kind: r.kind }, 201);
}));
exports.default = router;
//# sourceMappingURL=routes.js.map