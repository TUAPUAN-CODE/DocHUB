"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findRowByValue = findRowByValue;
const db_1 = require("../config/db");
/** First (lowest row number; newest = highest) live row whose cell in `column` equals `value` (text: case-insensitive; numbers: numeric) */
async function findRowByValue(sheetId, column, value, newest = false) {
    const t = column.data_type;
    const isNum = t === 'int' || t === 'float';
    const num = Number(value.replace(/,/g, ''));
    if (isNum && !Number.isFinite(num))
        return null;
    const cond = t === 'int' ? 'c.value_int = @n' : t === 'float' ? 'ABS(c.value_float - @n) < 0.0000001' : 'c.value_text = @v';
    const r = await (0, db_1.q1)(`SELECT TOP 1 r.row_id, r.row_order FROM Rows r JOIN Cells c ON c.row_id = r.row_id AND c.column_id = @c
     WHERE r.sheet_id = @s AND r.is_deleted = 0 AND ${cond} ORDER BY r.row_order ${newest ? 'DESC' : ''}`, { s: db_1.T.uuid(sheetId), c: db_1.T.uuid(column.column_id), v: db_1.T.text(value), n: isNum ? db_1.T.float(num) : db_1.T.float(0) });
    return r ? { rowId: r.row_id, rowNo: Number(r.row_order) } : null;
}
//# sourceMappingURL=rowFind.js.map