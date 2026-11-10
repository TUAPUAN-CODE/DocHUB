"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toBool = void 0;
exports.evaluate = evaluate;
const convert_1 = require("./convert");
Object.defineProperty(exports, "toBool", { enumerable: true, get: function () { return convert_1.toBool; } });
const functions_1 = require("./functions");
const types_1 = require("./types");
const isDate = (v) => (0, types_1.isDateV)(v);
function compare(op, l, r) {
    if (l === null || r === null) {
        const bothEmpty = (l === null || l === '') && (r === null || r === '');
        if (op === '=')
            return bothEmpty;
        if (op === '<>')
            return !bothEmpty;
        return false;
    }
    let c;
    if (isDate(l) || isDate(r)) {
        const a = (0, convert_1.toDate)(l);
        const b = (0, convert_1.toDate)(r);
        if (!a || !b)
            return op === '<>';
        c = a.ms - b.ms;
    }
    else if (typeof l === 'string' && typeof r === 'string') {
        c = op === '=' || op === '<>' ? (l.toLowerCase() === r.toLowerCase() ? 0 : 1) : l.localeCompare(r, 'th');
    }
    else if (typeof l === 'boolean' && typeof r === 'boolean') {
        c = Number(l) - Number(r);
    }
    else {
        const a = (0, convert_1.toNumber)(l);
        const b = (0, convert_1.toNumber)(r);
        if (a === null || b === null)
            return op === '<>' ? (0, convert_1.toText)(l) !== (0, convert_1.toText)(r) : op === '=' ? (0, convert_1.toText)(l) === (0, convert_1.toText)(r) : false;
        c = a - b;
    }
    switch (op) {
        case '=': return c === 0;
        case '<>': return c !== 0;
        case '<': return c < 0;
        case '<=': return c <= 0;
        case '>': return c > 0;
        default: return c >= 0;
    }
}
function arithmetic(op, l, r) {
    if (l === null || r === null)
        return null;
    // dates: date - date = days, date ± days = date
    if (isDate(l) && isDate(r) && op === '-')
        return (l.ms - r.ms) / convert_1.DAY_MS;
    if (isDate(l) && !isDate(r) && (op === '+' || op === '-')) {
        const n = (0, convert_1.toNumber)(r);
        return n === null ? null : { kind: l.kind === 'date' && !Number.isInteger(n) ? 'datetime' : l.kind, ms: l.ms + (op === '+' ? n : -n) * convert_1.DAY_MS };
    }
    if (isDate(r) && !isDate(l) && op === '+') {
        const n = (0, convert_1.toNumber)(l);
        return n === null ? null : { kind: r.kind, ms: r.ms + n * convert_1.DAY_MS };
    }
    const a = (0, convert_1.toNumber)(l);
    const b = (0, convert_1.toNumber)(r);
    if (a === null || b === null)
        return null;
    switch (op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? null : a / b;
        default: return b === 0 ? null : a % b;
    }
}
/** Evaluates a parsed (and resolved) formula for one row. Throws FormulaEvalError for a value that makes no sense. */
function evaluate(n, ctx) {
    switch (n.t) {
        case 'num': return n.v;
        case 'str': return n.v;
        case 'bool': return n.v;
        case 'null': return null;
        case 'ref':
            if (!n.id)
                throw new types_1.FormulaEvalError(`คอลัมน์ [${n.raw}] ยังไม่ได้ผูก`);
            return ctx.get(n.id);
        case 'un': {
            const v = evaluate(n.arg, ctx);
            if (v === null)
                return null;
            const x = (0, convert_1.toNumber)(v);
            return x === null ? null : n.op === '-' ? -x : x;
        }
        case 'bin': {
            const l = evaluate(n.l, ctx);
            const r = evaluate(n.r, ctx);
            if (n.op === '&')
                return (0, convert_1.toText)(l) + (0, convert_1.toText)(r);
            if (['=', '<>', '<', '<=', '>', '>='].includes(n.op))
                return compare(n.op, l, r);
            return arithmetic(n.op, l, r);
        }
        case 'xref': throw new types_1.FormulaEvalError('@แหล่ง[คอลัมน์] ใช้ได้เฉพาะภายใน LOOKUP');
        case 'call': {
            const f = (0, functions_1.getFunction)(n.name);
            if (!f)
                throw new types_1.FormulaEvalError(`ไม่มีฟังก์ชัน ${n.name}`);
            if (f.raw)
                return f.fn(n.args, ctx, (x) => evaluate(x, ctx));
            const args = f.lazy ? n.args.map((a) => () => evaluate(a, ctx)) : n.args.map((a) => evaluate(a, ctx));
            return f.fn(args, ctx);
        }
    }
}
//# sourceMappingURL=evaluator.js.map