import { Router } from 'express';
import { z } from 'zod';
import { q, T, withTx } from '../../config/db';
import { requireRole, Role } from '../../middleware/auth';
import { emitToAll } from '../../socket';
import { audit } from '../../shared/audit';
import { ah, forbidden, ok, parse } from '../../shared/http';
import { CONFIG_ROLES, PAGES } from './registry';
import { configurable, invalidatePageAccess, isAllowed, pagesFor, savedAccess } from './service';

const router = Router();

/** Pages the signed-in user sees (the web app also gets them with /auth/me) */
router.get('/page-access/mine', ah(async (req, res) => ok(res, { pages: await pagesFor(req.user!.role) })));

const rootOnly: ReturnType<typeof requireRole> = (req, _res, next) => (req.user?.role === 'root' ? next() : next(forbidden('หน้านี้สำหรับผู้ใช้ Root เท่านั้น')));

async function matrix() {
  const saved = await savedAccess();
  const last = await q(`SELECT TOP 1 a.updated_at, u.display_name FROM RolePageAccess a LEFT JOIN Users u ON u.user_id = a.updated_by ORDER BY a.updated_at DESC`);
  return {
    roles: CONFIG_ROLES,
    pages: PAGES.map((p) => ({
      key: p.key, label: p.label, kind: p.kind, hint: p.hint ?? null, floor: p.floor ?? null, always: !!p.always, rootOnly: !!p.rootOnly, defaults: p.defaults,
    })),
    allowed: Object.fromEntries(CONFIG_ROLES.map((r) => [r, PAGES.filter((p) => isAllowed(p, r, saved)).map((p) => p.key)])),
    updatedAt: last[0]?.updated_at ?? null,
    updatedBy: last[0]?.display_name ?? null,
  };
}

router.get('/page-access', rootOnly, ah(async (_req, res) => ok(res, await matrix())));

const keys = z.array(z.string().max(50)).max(100);
router.put(
  '/page-access',
  rootOnly,
  ah(async (req, res) => {
    const { allowed } = parse(z.object({ allowed: z.object({ viewer: keys, user: keys, master: keys, admin: keys }) }), req.body);
    const before = (await matrix()).allowed;
    await withTx(async (tx) => {
      for (const role of CONFIG_ROLES)
        for (const p of PAGES.filter((x) => configurable(x, role)))
          await q(
            `MERGE RolePageAccess AS t USING (SELECT @r AS role_name, @k AS page_key) s ON t.role_name = s.role_name AND t.page_key = s.page_key
             WHEN MATCHED THEN UPDATE SET allowed = @a, updated_by = @by, updated_at = SYSUTCDATETIME()
             WHEN NOT MATCHED THEN INSERT (role_name, page_key, allowed, updated_by) VALUES (@r, @k, @a, @by);`,
            { r: role, k: p.key, a: allowed[role as Exclude<Role, 'root'>].includes(p.key), by: T.uuid(req.user!.id) },
            tx,
          );
      await audit({ userId: req.user!.id, action: 'page_access_update', entityType: 'system', entityId: 'page-access', oldValue: before, newValue: allowed }, req, tx);
    });
    invalidatePageAccess();
    emitToAll('pages:changed', {});
    ok(res, await matrix());
  }),
);

export default router;
