"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatChangeCount = exports.settingLabel = exports.formatSettings = void 0;
exports.diffFormats = diffFormats;
/** settings keys that are not the format (who filters what, the revision options …) */
const NOT_FORMAT = new Set(['revisions', 'filterColumns']);
const formatSettings = (settings) => Object.fromEntries(Object.entries(settings ?? {}).filter(([k, v]) => !NOT_FORMAT.has(k) && v !== undefined && v !== null));
exports.formatSettings = formatSettings;
const SETTING_TH = {
    formLayout: 'รูปแบบฟอร์มกรอกข้อมูล (Form layout)', lines: 'รายการย่อยของหัวเอกสาร', scanProfiles: 'การสแกน', mix: 'การผสม / ตั้งค่า Mix',
    devices: 'อุปกรณ์ (RFID/IoT)', timeLinks: 'การเชื่อมเวลา', docNumber: 'เลขที่เอกสาร',
};
const settingLabel = (k) => SETTING_TH[k] ?? k;
exports.settingLabel = settingLabel;
const stable = (v) => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
function diffFormats(prev, cur) {
    const p = new Map(prev.cols.map((c) => [c.id, c]));
    const c = new Map(cur.cols.map((x) => [x.id, x]));
    const changed = [];
    for (const col of cur.cols) {
        const o = p.get(col.id);
        if (!o)
            continue;
        const what = [];
        if (o.type !== col.type)
            what.push('ชนิดข้อมูล');
        if (o.required !== col.required)
            what.push(col.required ? 'เป็นช่องบังคับ' : 'ไม่บังคับแล้ว');
        if (stable(o.options) !== stable(col.options))
            what.push('ตัวเลือก');
        if (stable(o.validation) !== stable(col.validation))
            what.push('เงื่อนไข / สูตร / แหล่งตัวเลือก');
        if (stable(o.defaultValue) !== stable(col.defaultValue))
            what.push('ค่าเริ่มต้น');
        if ((o.placeholder ?? '') !== (col.placeholder ?? '') || (o.description ?? '') !== (col.description ?? ''))
            what.push('คำอธิบาย');
        if (what.length)
            changed.push({ name: col.name, what });
    }
    const order = (s) => s.cols.filter((x) => p.has(x.id) && c.has(x.id)).sort((a, b) => a.order - b.order).map((x) => x.id).join();
    const keys = new Set([...Object.keys(prev.settings), ...Object.keys(cur.settings)]);
    const pp = new Map(prev.pdf.map((t) => [t.id, t]));
    const cp = new Map(cur.pdf.map((t) => [t.id, t]));
    return {
        columns: {
            added: cur.cols.filter((x) => !p.has(x.id)).map((x) => x.name),
            removed: prev.cols.filter((x) => !c.has(x.id)).map((x) => x.name),
            renamed: cur.cols.filter((x) => p.has(x.id) && p.get(x.id).name !== x.name).map((x) => ({ from: p.get(x.id).name, to: x.name })),
            changed,
            reordered: order(prev) !== order({ ...cur, cols: cur.cols }),
        },
        settings: [...keys].filter((k) => stable(prev.settings[k]) !== stable(cur.settings[k])).map(exports.settingLabel),
        pdf: {
            added: cur.pdf.filter((t) => !pp.has(t.id)).map((t) => t.name),
            removed: prev.pdf.filter((t) => !cp.has(t.id)).map((t) => t.name),
            changed: cur.pdf.filter((t) => pp.has(t.id) && pp.get(t.id).json !== t.json).map((t) => t.name),
        },
    };
}
const formatChangeCount = (d) => d.columns.added.length + d.columns.removed.length + d.columns.renamed.length + d.columns.changed.length + (d.columns.reordered ? 1 : 0) +
    d.settings.length + d.pdf.added.length + d.pdf.removed.length + d.pdf.changed.length;
exports.formatChangeCount = formatChangeCount;
//# sourceMappingURL=format.js.map