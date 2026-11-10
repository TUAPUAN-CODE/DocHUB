"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileFormula = compileFormula;
exports.displayFormula = displayFormula;
exports.topoOrder = topoOrder;
const parser_1 = require("./parser");
const functions_1 = require("./functions");
const types_1 = require("./types");
const norm = (s) => s.trim().toLowerCase();
const escapeName = (n) => n.replace(/\]/g, ']]');
/** Parses `source`, binds [Column name] → [#id] and @alias[Column] → @{sheet}[#id], and checks function names / argument counts */
function compileFormula(source, cols, opts = {}) {
    const ast = (0, parser_1.parse)(source);
    const byName = new Map();
    for (const c of cols) {
        const k = norm(c.name);
        byName.set(k, [...(byName.get(k) ?? []), c]);
    }
    const byId = new Map(cols.map((c) => [c.id.toLowerCase(), c]));
    const refs = (0, parser_1.collectRefs)(ast);
    for (const r of refs) {
        if (r.id) {
            if (!byId.has(r.id))
                throw new types_1.FormulaSyntaxError(`ไม่พบคอลัมน์ที่อ้างอิง (อาจถูกลบแล้ว)`, r.start);
            continue;
        }
        const hit = byName.get(norm(r.raw)) ?? [];
        if (!hit.length)
            throw new types_1.FormulaSyntaxError(`ไม่พบคอลัมน์ชื่อ "${r.raw}"`, r.start);
        if (hit.length > 1)
            throw new types_1.FormulaSyntaxError(`มีคอลัมน์ชื่อ "${r.raw}" มากกว่าหนึ่งคอลัมน์`, r.start);
        r.id = hit[0].id.toLowerCase();
    }
    if (opts.selfId && refs.some((r) => r.id === opts.selfId.toLowerCase()))
        throw new types_1.FormulaSyntaxError('สูตรอ้างอิงคอลัมน์ตัวเองไม่ได้', refs.find((r) => r.id === opts.selfId.toLowerCase()).start);
    // columns of other sheets
    const sources = opts.sources ?? [];
    const sourceById = new Map(sources.map((s) => [s.sheetId.toLowerCase(), s]));
    const xrefs = (0, parser_1.collectXrefs)(ast);
    for (const x of xrefs) {
        if (!x.sheetId) {
            const s = sources.find((y) => norm(y.alias) === norm(x.alias));
            if (!s)
                throw new types_1.FormulaSyntaxError(`ไม่พบแหล่งข้อมูล @${x.alias} — เพิ่มแหล่งข้อมูลก่อนใช้`, x.start);
            x.sheetId = s.sheetId.toLowerCase();
        }
        else if (!sourceById.has(x.sheetId))
            throw new types_1.FormulaSyntaxError('แหล่งข้อมูลที่อ้างอิงถูกลบออกจากสูตรแล้ว', x.start);
        const scols = opts.sourceColumns?.get(x.sheetId) ?? [];
        if (!x.columnId) {
            const hit = scols.filter((c) => norm(c.name) === norm(x.col));
            if (!hit.length)
                throw new types_1.FormulaSyntaxError(`ไม่พบคอลัมน์ "${x.col}" ในแหล่งข้อมูล @${sourceById.get(x.sheetId)?.alias ?? x.alias}`, x.start);
            if (hit.length > 1)
                throw new types_1.FormulaSyntaxError(`มีคอลัมน์ชื่อ "${x.col}" มากกว่าหนึ่งคอลัมน์ในแหล่งข้อมูล`, x.start);
            x.columnId = hit[0].id.toLowerCase();
        }
        else if (!scols.some((c) => c.id.toLowerCase() === x.columnId))
            throw new types_1.FormulaSyntaxError('คอลัมน์ในแหล่งข้อมูลที่อ้างอิงถูกลบแล้ว', x.start);
    }
    const checkCalls = (n, inLookup = false) => {
        switch (n.t) {
            case 'call': {
                const f = (0, functions_1.getFunction)(n.name);
                if (!f)
                    throw new types_1.FormulaSyntaxError(`ไม่มีฟังก์ชัน ${n.name}`, n.pos);
                if (n.args.length < f.minArgs || n.args.length > f.maxArgs) {
                    const range = f.minArgs === f.maxArgs ? `${f.minArgs}` : Number.isFinite(f.maxArgs) ? `${f.minArgs}-${f.maxArgs}` : `อย่างน้อย ${f.minArgs}`;
                    throw new types_1.FormulaSyntaxError(`${n.name} ต้องมี ${range} ค่า (ใส่มา ${n.args.length})`, n.pos);
                }
                if (n.name === 'LOOKUP') {
                    const [a, b] = n.args;
                    if (a.t !== 'xref' || b.t !== 'xref')
                        throw new types_1.FormulaSyntaxError('LOOKUP ต้องใช้ @แหล่ง[คอลัมน์ผลลัพธ์] และ @แหล่ง[คอลัมน์ค้นหา] เป็นสองค่าแรก', n.pos);
                    if (a.sheetId !== b.sheetId)
                        throw new types_1.FormulaSyntaxError('LOOKUP: คอลัมน์ผลลัพธ์และคอลัมน์ค้นหาต้องมาจากแหล่งข้อมูลเดียวกัน', n.pos);
                    n.args.slice(2).forEach((x) => checkCalls(x));
                    return;
                }
                n.args.forEach((a) => checkCalls(a));
                return;
            }
            case 'un':
                checkCalls(n.arg);
                return;
            case 'bin':
                checkCalls(n.l);
                checkCalls(n.r);
                return;
            case 'xref':
                if (!inLookup)
                    throw new types_1.FormulaSyntaxError('@แหล่ง[คอลัมน์] ใช้ได้เฉพาะภายใน LOOKUP(…)', n.start);
                return;
            default:
        }
    };
    checkCalls(ast);
    // rewrite the source text: [..] → [#id] / [Name]; @alias[..] → @{sheet}[#id] / @alias[Name]
    const spans = [
        ...refs.map((r) => ({ start: r.start, end: r.end, canon: `[#${r.id}]`, disp: `[${escapeName(byId.get(r.id).name)}]` })),
        ...xrefs.map((x) => {
            const src = sourceById.get(x.sheetId);
            const col = (opts.sourceColumns?.get(x.sheetId) ?? []).find((c) => c.id.toLowerCase() === x.columnId);
            return { start: x.start, end: x.end, canon: `@{${x.sheetId}}[#${x.columnId}]`, disp: `@${src.alias}[${escapeName(col.name)}]` };
        }),
    ].sort((a, b) => a.start - b.start);
    const rewrite = (pick) => {
        let out = '';
        let last = 0;
        for (const s of spans) {
            out += source.slice(last, s.start) + s[pick];
            last = s.end;
        }
        return out + source.slice(last);
    };
    return {
        canonical: rewrite('canon'),
        display: rewrite('disp'),
        deps: [...new Set(refs.map((r) => r.id))],
        sourceSheets: [...new Set(xrefs.map((x) => x.sheetId))],
        ast,
    };
}
/** Display text of an already stored formula (ids → current names). Unknown ids are shown as [?] */
function displayFormula(canonical, cols, sources = [], sourceColumns = new Map()) {
    const byId = new Map(cols.map((c) => [c.id.toLowerCase(), c.name]));
    const alias = new Map(sources.map((s) => [s.sheetId.toLowerCase(), s.alias]));
    return canonical
        .replace(/@\{([0-9a-fA-F-]{36})\}\[#([0-9a-fA-F-]{36})\]/g, (_m, sid, cid) => {
        const name = (sourceColumns.get(sid.toLowerCase()) ?? []).find((c) => c.id.toLowerCase() === cid.toLowerCase())?.name ?? '?';
        return `@${alias.get(sid.toLowerCase()) ?? '?'}[${escapeName(name)}]`;
    })
        .replace(/(?<!@\{[0-9a-fA-F-]{36}\})\[#([0-9a-fA-F-]{36})\]/g, (_m, id) => `[${escapeName(byId.get(id.toLowerCase()) ?? '?')}]`);
}
/** Order in which the formula columns of a sheet must be computed; throws on a circular reference */
function topoOrder(formulas) {
    const ids = new Set(formulas.map((f) => f.id));
    const deps = new Map(formulas.map((f) => [f.id, f.deps.filter((d) => ids.has(d))]));
    const out = [];
    const state = new Map();
    const visit = (id, path) => {
        if (state.get(id) === 2)
            return;
        if (state.get(id) === 1)
            throw new types_1.FormulaSyntaxError('สูตรอ้างอิงกันเป็นวงกลม', 0);
        state.set(id, 1);
        for (const d of deps.get(id) ?? [])
            visit(d, [...path, id]);
        state.set(id, 2);
        out.push(id);
    };
    for (const f of formulas)
        visit(f.id, []);
    return out;
}
//# sourceMappingURL=compile.js.map