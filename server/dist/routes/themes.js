"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../config/db");
const auth_1 = require("../middleware/auth");
const http_1 = require("../shared/http");
const router = (0, express_1.Router)();
const ORG_KEY = 'org_default_theme';
const themeBody = zod_1.z.object({ theme: zod_1.z.record(zod_1.z.any()) });
function check(theme) {
    const s = JSON.stringify(theme);
    if (s.length > 60_000)
        throw (0, http_1.badRequest)('ข้อมูลธีมมีขนาดใหญ่เกินไป');
    return s;
}
router.get('/themes/me', (0, http_1.ah)(async (req, res) => {
    const mine = await (0, db_1.q1)(`SELECT theme_json FROM UserThemes WHERE user_id = @u`, { u: db_1.T.uuid(req.user.id) });
    const org = await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k: ORG_KEY });
    (0, http_1.ok)(res, { theme: (0, http_1.safeJson)(mine?.theme_json, null), orgDefault: (0, http_1.safeJson)(org?.setting_value, null) });
}));
router.put('/themes/me', (0, http_1.ah)(async (req, res) => {
    const { theme } = (0, http_1.parse)(themeBody, req.body);
    const json = check(theme);
    await (0, db_1.q)(`MERGE UserThemes AS t USING (SELECT @u AS user_id) AS s ON t.user_id = s.user_id
       WHEN MATCHED THEN UPDATE SET theme_json = @j, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (user_id, theme_json) VALUES (s.user_id, @j);`, { u: db_1.T.uuid(req.user.id), j: db_1.T.text(json) });
    (0, http_1.ok)(res, { saved: true });
}));
router.delete('/themes/me', (0, http_1.ah)(async (req, res) => {
    await (0, db_1.q)(`DELETE FROM UserThemes WHERE user_id = @u`, { u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { reset: true });
}));
router.put('/themes/org', (0, auth_1.requireRole)('admin'), (0, http_1.ah)(async (req, res) => {
    const { theme } = (0, http_1.parse)(themeBody, req.body);
    const json = check(theme);
    await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
       WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
       WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (s.setting_key, @v, @u);`, { k: ORG_KEY, v: db_1.T.text(json), u: db_1.T.uuid(req.user.id) });
    (0, http_1.ok)(res, { saved: true });
}));
router.delete('/themes/org', (0, auth_1.requireRole)('admin'), (0, http_1.ah)(async (_req, res) => {
    await (0, db_1.q)(`DELETE FROM SystemSettings WHERE setting_key = @k`, { k: ORG_KEY });
    (0, http_1.ok)(res, { reset: true });
}));
exports.default = router;
//# sourceMappingURL=themes.js.map