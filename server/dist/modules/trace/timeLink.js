"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interval = interval;
exports.overlap = overlap;
/** [start, end] of a row; an unfinished row (no end) runs until `now`. Null when there is no start. */
function interval(start, end, now) {
    if (!start)
        return null;
    const s = start.getTime();
    const e = (end ?? now).getTime();
    return { s, e: Math.max(s, e) };
}
/** minutes the two intervals overlap (0 = they only touch / are apart but within tolerance) and whether they count as linked */
function overlap(a, b, toleranceMin = 0) {
    const tol = Math.max(0, toleranceMin) * 60_000;
    const minutes = Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s)) / 60_000;
    const linked = a.s <= b.e + tol && b.s <= a.e + tol;
    return { linked, minutes: Math.round(minutes * 10) / 10 };
}
//# sourceMappingURL=timeLink.js.map