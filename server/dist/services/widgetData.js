"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeWidgetData = computeWidgetData;
const db_1 = require("../config/db");
const cellValue_1 = require("../shared/cellValue");
const http_1 = require("../shared/http");
const permissions_1 = require("../shared/permissions");
const cellWriter_1 = require("./cellWriter");
const rowQuery_1 = require("./rowQuery");
const A2 = { 2: 1.88, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const stdev = (a) => {
    if (a.length < 2)
        return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};
const AGG_TH = {
    sum: 'ผลรวม',
    avg: 'ค่าเฉลี่ย',
    count: 'จำนวน',
    count_distinct: 'จำนวนไม่ซ้ำ',
    min: 'ต่ำสุด',
    max: 'สูงสุด',
    none: '',
};
const BLANK = '(ว่าง)';
function isoWeek(d) {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const w = Math.ceil(((+t - +y0) / 86400000 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}
function bucketOf(v, bucket) {
    const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
    if (Number.isNaN(+d))
        return v;
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    switch (bucket) {
        case 'year':
            return String(y);
        case 'quarter':
            return `${y}-Q${Math.ceil(m / 3)}`;
        case 'month':
            return `${y}-${String(m).padStart(2, '0')}`;
        case 'week':
            return isoWeek(d);
        default:
            return d.toISOString().slice(0, 10);
    }
}
function categoryKeys(v, col, bucket) {
    if (v === null || v === undefined || v === '')
        return [BLANK];
    const t = col.data_type;
    const options = (0, http_1.safeJson)(col.select_options, []) ?? [];
    const label = (s) => options.find((o) => o.value === s)?.label ?? s;
    if (t === 'multi_select' && Array.isArray(v))
        return v.length ? v.map((x) => label(String(x))) : [BLANK];
    if (t === 'select')
        return [label(String(v))];
    if (t === 'boolean')
        return [v ? 'ใช่' : 'ไม่ใช่'];
    if ((t === 'date' || t === 'datetime') && bucket !== 'none')
        return [bucketOf(String(v), bucket)];
    if (t === 'datetime')
        return [String(v).slice(0, 10)];
    return [String(v)];
}
const numeric = (v) => {
    if (typeof v === 'number')
        return v;
    if (typeof v === 'boolean')
        return v ? 1 : 0;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)))
        return Number(v);
    return null;
};
function aggregate(values, agg) {
    if (agg === 'count')
        return values.length;
    if (agg === 'count_distinct')
        return new Set(values.filter((v) => v !== null && v !== undefined).map((v) => JSON.stringify(v))).size;
    const nums = values.map(numeric).filter((n) => n !== null);
    if (!nums.length)
        return agg === 'sum' ? 0 : null;
    switch (agg) {
        case 'sum':
        case 'none':
            return nums.reduce((a, b) => a + b, 0);
        case 'avg':
            return nums.reduce((a, b) => a + b, 0) / nums.length;
        case 'min':
            return Math.min(...nums);
        case 'max':
            return Math.max(...nums);
    }
    return null;
}
const collator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
async function computeWidgetData(user, ds) {
    await (0, permissions_1.requireSheet)(user, ds.sheetId, permissions_1.LV.read);
    const cols = await (0, cellWriter_1.loadColumns)(ds.sheetId);
    const colMap = new Map(cols.map((c) => [c.column_id, c]));
    const need = [ds.xColumnId, ds.groupByColumnId, ...ds.series.map((s) => s.columnId)].filter((x) => !!x);
    for (const id of need)
        if (!colMap.has(id))
            throw (0, http_1.badRequest)('คอลัมน์ที่เลือกไม่มีอยู่แล้ว กรุณาเลือกใหม่');
    const p = new rowQuery_1.Params();
    const where = (0, rowQuery_1.baseWhere)(ds.sheetId, colMap, p, { filters: ds.filters });
    const rowIds = await (0, db_1.q)(`SELECT TOP 200000 r.row_id FROM Rows r WHERE ${where} ORDER BY r.row_order, r.created_at`, p.values);
    const records = new Map(rowIds.map((r) => [r.row_id, {}]));
    const uniqueNeed = [...new Set(need)];
    if (uniqueNeed.length && records.size) {
        const cells = await (0, db_1.q)(`SELECT wc.row_id, wc.column_id, wc.value_text, wc.value_int, wc.value_float, wc.value_date, wc.value_bool, wc.value_json
       FROM Cells wc JOIN Rows r ON r.row_id = wc.row_id
       WHERE ${where} AND wc.column_id IN ${(0, db_1.idList)('@wcols')}`, { ...p.values, wcols: (0, db_1.jsonParam)(uniqueNeed) });
        for (const c of cells) {
            const rec = records.get(c.row_id);
            if (rec)
                rec[c.column_id] = (0, cellValue_1.fromStorage)(colMap.get(c.column_id).data_type, c);
        }
    }
    const all = [...records.values()];
    const seriesName = (s) => s.label || (s.aggregation === 'count' && !s.columnId ? 'จำนวนแถว' : `${AGG_TH[s.aggregation]} ${colMap.get(s.columnId ?? '')?.column_name ?? ''}`.trim());
    // Statistical modes (histogram / X chart / X-bar chart)
    if (ds.kind && ds.xColumnId) {
        const vCol = ds.series[0]?.columnId;
        const valueId = ds.kind === 'histogram' ? ds.xColumnId : vCol;
        if (!valueId)
            throw (0, http_1.badRequest)('กรุณาเลือกคอลัมน์ตัวเลข');
        const rowsIn = all.map((r) => ({ x: r[ds.xColumnId], v: numeric(r[valueId]) })).filter((r) => r.v !== null);
        if (ds.kind === 'histogram') {
            const vals = rowsIn.map((r) => r.v);
            const nb = (0, http_1.clamp)(ds.bins ?? 10, 2, 100);
            const lo = vals.length ? Math.min(...vals) : 0;
            const hi = vals.length ? Math.max(...vals) : 0;
            const width = hi === lo ? 1 : (hi - lo) / nb;
            const counts = new Array(nb).fill(0);
            for (const v of vals)
                counts[Math.min(nb - 1, Math.floor((v - lo) / width))]++;
            const fmt = (n) => String(Math.round(n * 100) / 100);
            return {
                categories: counts.map((_, i) => `${fmt(lo + i * width)}–${fmt(lo + (i + 1) * width)}`),
                series: [{ key: 's0', name: 'จำนวน', values: counts }],
                points: [],
                totalRows: all.length,
                stats: { mean: mean(vals), sd: stdev(vals), min: lo, max: hi, n: vals.length },
            };
        }
        if (ds.kind === 'xchart') {
            const vals = rowsIn.map((r) => r.v);
            const cl = mean(vals);
            const mr = mean(vals.slice(1).map((v, i) => Math.abs(v - vals[i])));
            const stats = { cl, ucl: cl + 2.66 * mr, lcl: cl - 2.66 * mr };
            return {
                categories: rowsIn.slice(0, 500).map((r, i) => (r.x === null || r.x === undefined || r.x === '' ? String(i + 1) : String(r.x))),
                series: [{ key: 's0', name: 'ค่าแต่ละตัว', values: vals.slice(0, 500) }],
                points: [],
                totalRows: all.length,
                stats,
            };
        }
        // xbar: subgroup means with limits from average range (A2) or pooled sigma
        const groupsMap = new Map();
        for (const r of rowsIn) {
            const k = r.x === null || r.x === undefined || r.x === '' ? BLANK : String(r.x);
            if (!groupsMap.has(k))
                groupsMap.set(k, []);
            groupsMap.get(k).push(r.v);
        }
        const subs = [...groupsMap.entries()].slice(0, 500);
        const means = subs.map(([, g]) => mean(g));
        const cl = mean(means);
        const sizes = subs.map(([, g]) => g.length);
        const nAvg = Math.round(mean(sizes)) || 1;
        let half;
        if (nAvg >= 2 && nAvg <= 10)
            half = A2[nAvg] * mean(subs.map(([, g]) => Math.max(...g) - Math.min(...g)));
        else if (nAvg > 10)
            half = (3 * mean(subs.map(([, g]) => stdev(g)))) / Math.sqrt(nAvg);
        else
            half = 2.66 * mean(means.slice(1).map((v, i) => Math.abs(v - means[i])));
        return {
            categories: subs.map(([k]) => k),
            series: [{ key: 's0', name: 'ค่าเฉลี่ยกลุ่มย่อย', values: means }],
            points: [],
            totalRows: all.length,
            stats: { cl, ucl: cl + half, lcl: cl - half },
        };
    }
    // KPI / single value mode
    if (!ds.xColumnId) {
        return {
            categories: ['ทั้งหมด'],
            series: ds.series.map((s, i) => ({
                key: `s${i}`,
                name: seriesName(s),
                values: [aggregate(s.columnId ? all.map((r) => r[s.columnId] ?? null) : all.map(() => 1), s.aggregation)],
            })),
            points: [],
            totalRows: all.length,
        };
    }
    const xCol = colMap.get(ds.xColumnId);
    const bucket = ds.xBucket ?? 'none';
    // Scatter / raw points mode
    if (ds.series[0]?.aggregation === 'none') {
        const s = ds.series[0];
        const points = all
            .map((r) => ({ x: numeric(r[ds.xColumnId]) ?? r[ds.xColumnId], y: numeric(r[s.columnId ?? '']) }))
            .filter((pt) => pt.x !== null && pt.x !== undefined && pt.y !== null)
            .slice(0, 5000);
        return { categories: [], series: [{ key: 's0', name: seriesName(s), values: [] }], points, totalRows: all.length };
    }
    const groups = new Map();
    const seriesKeys = [];
    if (ds.groupByColumnId) {
        const s = ds.series[0];
        const gCol = colMap.get(ds.groupByColumnId);
        const seen = new Set();
        for (const r of all) {
            const gk = categoryKeys(r[ds.groupByColumnId], gCol, 'none')[0];
            if (!seen.has(gk)) {
                seen.add(gk);
                seriesKeys.push({ key: `g:${gk}`, name: gk, agg: s.aggregation });
            }
            for (const xk of categoryKeys(r[ds.xColumnId], xCol, bucket)) {
                if (!groups.has(xk))
                    groups.set(xk, new Map());
                const g = groups.get(xk);
                if (!g.has(`g:${gk}`))
                    g.set(`g:${gk}`, []);
                g.get(`g:${gk}`).push(s.columnId ? r[s.columnId] ?? null : 1);
            }
        }
        seriesKeys.sort((a, b) => collator.compare(a.name, b.name));
    }
    else {
        ds.series.forEach((s, i) => seriesKeys.push({ key: `s${i}`, name: seriesName(s), agg: s.aggregation }));
        for (const r of all) {
            for (const xk of categoryKeys(r[ds.xColumnId], xCol, bucket)) {
                if (!groups.has(xk))
                    groups.set(xk, new Map());
                const g = groups.get(xk);
                ds.series.forEach((s, i) => {
                    if (!g.has(`s${i}`))
                        g.set(`s${i}`, []);
                    g.get(`s${i}`).push(s.columnId ? r[s.columnId] ?? null : 1);
                });
            }
        }
    }
    let categories = [...groups.keys()];
    const firstTotal = (c) => aggregate(groups.get(c).get(seriesKeys[0]?.key ?? '') ?? [], seriesKeys[0]?.agg ?? 'count') ?? 0;
    const numericX = xCol.data_type === 'int' || xCol.data_type === 'float';
    const xCompare = (a, b) => a === BLANK ? 1 : b === BLANK ? -1 : numericX ? Number(a) - Number(b) : collator.compare(a, b);
    switch (ds.sort ?? 'x_asc') {
        case 'x_desc':
            categories.sort((a, b) => -xCompare(a, b));
            break;
        case 'value_asc':
            categories.sort((a, b) => firstTotal(a) - firstTotal(b));
            break;
        case 'value_desc':
            categories.sort((a, b) => firstTotal(b) - firstTotal(a));
            break;
        default:
            categories.sort(xCompare);
    }
    categories = categories.slice(0, (0, http_1.clamp)(ds.limit ?? 50, 1, 500));
    return {
        categories,
        series: seriesKeys.map((s) => ({
            key: s.key,
            name: s.name,
            values: categories.map((c) => {
                const vals = groups.get(c)?.get(s.key);
                return vals ? aggregate(vals, s.agg) : null;
            }),
        })),
        points: [],
        totalRows: all.length,
    };
}
//# sourceMappingURL=widgetData.js.map