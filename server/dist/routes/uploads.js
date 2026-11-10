"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const env_1 = require("../config/env");
const http_1 = require("../shared/http");
const router = (0, express_1.Router)();
const dir = path_1.default.resolve(env_1.env.uploadDir);
fs_1.default.mkdirSync(dir, { recursive: true });
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: dir,
        filename: (_req, file, cb) => cb(null, `${crypto_1.default.randomUUID()}${EXT[file.mimetype] ?? ''}`),
    }),
    limits: { fileSize: env_1.env.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype in EXT),
});
router.post('/uploads/image', (req, _res, next) => (req.user?.role === 'viewer' ? next((0, http_1.forbidden)('บทบาท Viewer อัปโหลดไฟล์ไม่ได้')) : next()), upload.single('file'), (0, http_1.ah)(async (req, res) => {
    if (!req.file)
        throw (0, http_1.badRequest)('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG, GIF, WEBP');
    (0, http_1.ok)(res, { url: `/uploads/${req.file.filename}`, size: req.file.size }, 201);
}));
exports.default = router;
//# sourceMappingURL=uploads.js.map