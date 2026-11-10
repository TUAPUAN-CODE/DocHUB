"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("../../config/db");
const hooks_1 = require("../../services/hooks");
/**
 * Colour alerts by "% of the standard time" (validation.alert on any column). The colours are computed in the browser from
 * three columns of the same row, so the only thing the server has to keep right is the column ids when a sheet is copied.
 */
(0, hooks_1.registerAfterSheetCopied)(async ({ tx, newSheetId, columnMap }) => {
    const map = new Map(columnMap.map((m) => [m.old_id.toLowerCase(), m.new_id.toLowerCase()]));
    const rows = await (0, db_1.q)(`SELECT column_id, validation_rule FROM Columns WHERE sheet_id = @s AND validation_rule LIKE N'%"alert"%'`, { s: db_1.T.uuid(newSheetId) }, tx);
    for (const r of rows) {
        let v = null;
        try {
            v = JSON.parse(r.validation_rule);
        }
        catch {
            continue;
        }
        const a = v?.alert;
        if (!a)
            continue;
        for (const k of ['startColumnId', 'endColumnId', 'limitColumnId'])
            if (a[k])
                a[k] = map.get(String(a[k]).toLowerCase()) ?? a[k];
        await (0, db_1.q)(`UPDATE Columns SET validation_rule = @v WHERE column_id = @c`, { v: db_1.T.text(JSON.stringify(v)), c: db_1.T.uuid(r.column_id) }, tx);
    }
});
exports.default = {};
//# sourceMappingURL=module.js.map