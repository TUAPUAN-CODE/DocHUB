"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const http_1 = require("../shared/http");
const logger_1 = require("../shared/logger");
const body = (code, message, details) => ({
    success: false,
    error: { code, message, details },
});
const errorHandler = (err, req, res, _next) => {
    if (err instanceof http_1.AppError) {
        res.status(err.status).json(body(err.code, err.message, err.details));
        return;
    }
    const sqlNumber = err?.number ?? err?.originalError?.info?.number;
    if (sqlNumber === 8169 || sqlNumber === 8114 || sqlNumber === 245) {
        res.status(400).json(body('BAD_REQUEST', 'รูปแบบข้อมูลไม่ถูกต้อง'));
        return;
    }
    if (sqlNumber === 2627 || sqlNumber === 2601) {
        res.status(409).json(body('CONFLICT', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว'));
        return;
    }
    if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
        res.status(413).json(body('TOO_LARGE', 'ข้อมูลมีขนาดใหญ่เกินกำหนด'));
        return;
    }
    if (err?.type === 'entity.parse.failed') {
        res.status(400).json(body('BAD_JSON', 'รูปแบบ JSON ไม่ถูกต้อง'));
        return;
    }
    logger_1.logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err?.message}`, { stack: err?.stack });
    res.status(500).json(body('INTERNAL', 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง'));
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=error.js.map