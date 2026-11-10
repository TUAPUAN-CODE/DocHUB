"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fmtDuration = exports.sortedLevels = void 0;
exports.ratioPct = ratioPct;
exports.levelToNotify = levelToNotify;
exports.buildMessage = buildMessage;
const sortedLevels = (levels) => [...levels].sort((a, b) => a.atPct - b.atPct);
exports.sortedLevels = sortedLevels;
/** elapsed / limit in % (null when it can not be told) */
function ratioPct(startMs, endMs, nowMs, limitMin) {
    if (!Number.isFinite(startMs) || !Number.isFinite(limitMin) || limitMin <= 0)
        return null;
    return (((endMs ?? nowMs) - startMs) / 60000 / limitMin) * 100;
}
/** Highest level (index in the sorted list) reached by `pct` that the manager asked to be told about; -1 when none */
function levelToNotify(levels, pct, only) {
    const s = (0, exports.sortedLevels)(levels);
    let hit = -1;
    s.forEach((l, i) => { if (pct >= l.atPct && (!only?.length || only.includes(i)))
        hit = i; });
    return hit;
}
const fmtDuration = (min) => {
    const m = Math.max(0, Math.round(min));
    return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} น.` : `${m} น.`;
};
exports.fmtDuration = fmtDuration;
/** One LINE text for all rows of a column that crossed a level in this run (LINE text limit is 5000 chars) */
function buildMessage(title, items, link) {
    const lines = [`⚠️ ${title}`];
    for (const it of items) {
        lines.push(`• แถว ${it.rowNo}${it.labels.length ? ` | ${it.labels.join(' | ')}` : ''}`);
        lines.push(`  ${it.levelLabel} ${Math.round(it.pct)}% (ผ่านไป ${(0, exports.fmtDuration)(it.elapsedMin)} / มาตรฐาน ${(0, exports.fmtDuration)(it.limitMin)}) เริ่ม ${it.startedAt}`);
    }
    if (link)
        lines.push('', link);
    let text = lines.join('\n');
    if (text.length > 4800)
        text = `${text.slice(0, 4750)}\n… (ตัดข้อความ ดูต่อในระบบ)`;
    return text;
}
//# sourceMappingURL=logic.js.map