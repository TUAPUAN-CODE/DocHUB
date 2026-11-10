"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumQty = void 0;
exports.cut = cut;
exports.firstMismatch = firstMismatch;
const round6 = (n) => Math.round(n * 1e6) / 1e6;
/** remaining after cutting `qty`; throws a Thai message the user can act on */
function cut(current, qty, rowNo, integer) {
    if (!Number.isFinite(qty) || qty <= 0)
        throw new Error(`แถว ${rowNo}: จำนวนที่ใช้ต้องมากกว่า 0`);
    if (integer && !Number.isInteger(qty))
        throw new Error(`แถว ${rowNo}: คอลัมน์ที่ตัดเป็นจำนวนเต็ม แต่ใส่ ${qty}`);
    if (current === null || !Number.isFinite(current))
        throw new Error(`แถว ${rowNo}: ยังไม่มีค่าคงเหลือให้ตัด`);
    if (qty > current + 1e-9)
        throw new Error(`แถว ${rowNo}: ใช้ ${qty} เกินคงเหลือ ${current}`);
    return round6(current - qty);
}
const sumQty = (qtys) => round6(qtys.reduce((a, b) => a + b, 0));
exports.sumQty = sumQty;
/** the first column whose values differ between inputs (so mixing is refused), or null */
function firstMismatch(rows, columnIds) {
    const norm = (v) => String(v ?? '').trim().toLowerCase();
    for (const id of columnIds)
        if (new Set(rows.map((r) => norm(r[id]))).size > 1)
            return id;
    return null;
}
//# sourceMappingURL=logic.js.map