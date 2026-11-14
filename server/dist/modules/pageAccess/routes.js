"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const db_1 = require("../../config/db");
const socket_1 = require("../../socket");
const audit_1 = require("../../shared/audit");
const http_1 = require("../../shared/http");
const registry_1 = require("./registry");
const service_1 = require("./service");
const router = (0, express_1.Router)();
/** Pages the signed-in user sees (the web app also gets them with /auth/me) */
router.get('/page-access/mine', (0, http_1.ah)(async (req, res) => (0, http_1.ok)(res, { pages: await (0, service_1.pagesFor)(req.user.role), labels: await (0, service_1.pageLabels)(), order: await (0, service_1.pageOrder)() })));
/** admin and root set which role sees which page and rename the items of the left bar */
const rootOnly = (req, _res, next) => (req.user?.role === 'root' || req.user?.role === 'admin' ? next() : next((0, http_1.forbidden)('หน้านี้สำหรับ Admin / Root เท่านั้น')));
async function matrix() {
    const saved = await (0, service_1.savedAccess)();
    const last = await (0, db_1.q)(`SELECT TOP 1 a.updated_at, u.display_name FROM RolePageAccess a LEFT JOIN Users u ON u.user_id = a.updated_by ORDER BY a.updated_at DESC`);
    return {
        roles: registry_1.CONFIG_ROLES,
        pages: registry_1.PAGES.map((p) => ({
            key: p.key, label: p.label, kind: p.kind, hint: p.hint ?? null, floor: p.floor ?? null, always: !!p.always, rootOnly: !!p.rootOnly, defaults: p.defaults,
            lockedFor: p.lockedFor ?? [], notInNav: !!p.notInNav,
        })),
        labels: await (0, service_1.pageLabels)(),
        order: await (0, service_1.pageOrder)(),
        allowed: Object.fromEntries(registry_1.CONFIG_ROLES.map((r) => [r, registry_1.PAGES.filter((p) => (0, service_1.isAllowed)(p, r, saved)).map((p) => p.key)])),
        updatedAt: last[0]?.updated_at ?? null,
        updatedBy: last[0]?.display_name ?? null,
    };
}
router.get('/page-access', rootOnly, (0, http_1.ah)(async (_req, res) => (0, http_1.ok)(res, await matrix())));
const keys = zod_1.z.array(zod_1.z.string().max(50)).max(100);
router.put('/page-access', rootOnly, (0, http_1.ah)(async (req, res) => {
    const { allowed, labels, order } = (0, http_1.parse)(zod_1.z.object({
        allowed: zod_1.z.object({ viewer: keys, user: keys, master: keys, admin: keys }),
        labels: zod_1.z.record(zod_1.z.string().max(50), zod_1.z.string().trim().max(60)).optional(),
        order: zod_1.z.array(zod_1.z.string().max(50)).max(100).optional(),
    }), req.body);
    const before = (await matrix()).allowed;
    await (0, db_1.withTx)(async (tx) => {
        for (const role of registry_1.CONFIG_ROLES)
            for (const p of registry_1.PAGES.filter((x) => (0, service_1.configurable)(x, role)))
                await (0, db_1.q)(`MERGE RolePageAccess AS t USING (SELECT @r AS role_name, @k AS page_key) s ON t.role_name = s.role_name AND t.page_key = s.page_key
             WHEN MATCHED THEN UPDATE SET allowed = @a, updated_by = @by, updated_at = SYSUTCDATETIME()
             WHEN NOT MATCHED THEN INSERT (role_name, page_key, allowed, updated_by) VALUES (@r, @k, @a, @by);`, { r: role, k: p.key, a: allowed[role].includes(p.key), by: db_1.T.uuid(req.user.id) }, tx);
        if (labels) {
            // only known pages; an empty name or the built-in name = no rename
            const clean = Object.fromEntries(Object.entries(labels).filter(([k, v]) => v && registry_1.PAGES.some((p) => p.key === k && p.label !== v)));
            await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT N'pageLabels' AS setting_key) s ON t.setting_key = s.setting_key
                 WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @by, updated_at = SYSUTCDATETIME()
                 WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (N'pageLabels', @v, @by);`, { v: JSON.stringify(clean), by: db_1.T.uuid(req.user.id) }, tx);
        }
        if (order) {
            const clean = [...new Set(order.filter((k) => registry_1.PAGES.some((p) => p.key === k)))];
            await (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT N'pageOrder' AS setting_key) s ON t.setting_key = s.setting_key
                 WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @by, updated_at = SYSUTCDATETIME()
                 WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (N'pageOrder', @v, @by);`, { v: JSON.stringify(clean), by: db_1.T.uuid(req.user.id) }, tx);
        }
        await (0, audit_1.audit)({ userId: req.user.id, action: 'page_access_update', entityType: 'system', entityId: 'page-access', oldValue: before, newValue: { allowed, labels, order } }, req, tx);
    });
    (0, service_1.invalidatePageAccess)();
    (0, socket_1.emitToAll)('pages:changed', {});
    (0, http_1.ok)(res, await matrix());
}));
exports.default = router;
//# sourceMappingURL=routes.js.map