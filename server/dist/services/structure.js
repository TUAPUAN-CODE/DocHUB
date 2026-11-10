"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertColumn = insertColumn;
exports.assertUniqueNames = assertUniqueNames;
const db_1 = require("../config/db");
const http_1 = require("../shared/http");
const schemas_1 = require("../shared/schemas");
/** Inserts a column definition (validated) and returns the new row */
async function insertColumn(tx, sheetId, input, order, userId) {
    const checked = (0, schemas_1.checkColumnInput)(input);
    return (0, db_1.q1)(`INSERT INTO Columns (sheet_id, column_name, data_type, display_order, width, is_required, default_value, placeholder,
        validation_rule, select_options, description, created_by)
     OUTPUT inserted.*
     VALUES (@s, @n, @t, @o, @w, @r, @dv, @ph, @vr, @so, @d, @u)`, {
        s: db_1.T.uuid(sheetId),
        n: input.name,
        t: input.dataType,
        o: db_1.T.int(order),
        w: db_1.T.int(input.width ?? 160),
        r: db_1.T.bit(!!input.isRequired),
        dv: db_1.T.text(checked.defaultValue === null ? null : JSON.stringify(checked.defaultValue)),
        ph: db_1.T.text(input.placeholder ?? null),
        vr: db_1.T.text(checked.validation ? JSON.stringify(checked.validation) : null),
        so: db_1.T.text(checked.options ? JSON.stringify(checked.options) : null),
        d: db_1.T.text(input.description ?? null),
        u: db_1.T.uuid(userId),
    }, tx);
}
function assertUniqueNames(names, what = 'คอลัมน์') {
    const seen = new Set();
    for (const n of names) {
        const k = n.trim().toLowerCase();
        if (seen.has(k))
            throw (0, http_1.badRequest)(`ชื่อ${what} "${n}" ซ้ำกัน`);
        seen.add(k);
    }
}
//# sourceMappingURL=structure.js.map