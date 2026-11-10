"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortSchema = exports.filterSchema = exports.sheetInput = exports.columnInput = exports.validationSchema = exports.optionSchema = void 0;
exports.checkColumnInput = checkColumnInput;
const zod_1 = require("zod");
const cellValue_1 = require("./cellValue");
const http_1 = require("./http");
exports.optionSchema = zod_1.z.object({
    value: zod_1.z.string().trim().min(1).max(200),
    label: zod_1.z.string().trim().min(1).max(200),
    color: zod_1.z.string().max(20).nullish(),
});
exports.validationSchema = zod_1.z
    .object({
    min: zod_1.z.number().nullish(),
    max: zod_1.z.number().nullish(),
    decimals: zod_1.z.number().int().min(0).max(10).nullish(),
    maxLength: zod_1.z.number().int().min(1).max(20000).nullish(),
    maxDigits: zod_1.z.number().int().min(1).max(30).nullish(),
    pattern: zod_1.z.string().max(500).nullish(),
    patternMessage: zod_1.z.string().max(200).nullish(),
    minDate: zod_1.z.string().max(30).nullish(),
    maxDate: zod_1.z.string().max(30).nullish(),
    maxSelections: zod_1.z.number().int().min(1).max(500).nullish(),
    allowEmpty: zod_1.z.boolean().nullish(),
    /** filled by the server whenever the row changes: today's date (date columns) / the editor's name (text columns) */
    autoStamp: zod_1.z.enum(['updatedAt', 'updatedBy']).nullish(),
    formula: zod_1.z.object({ expr: zod_1.z.string().trim().min(1).max(2000), sources: zod_1.z.array(zod_1.z.object({ alias: zod_1.z.string().trim().min(1).max(40), sheetId: zod_1.z.string().max(60) })).max(10).optional() }).nullish(),
    alert: zod_1.z
        .object({
        startColumnId: http_1.zId,
        endColumnId: http_1.zId.nullish(),
        limitColumnId: http_1.zId,
        normalColor: zod_1.z.string().max(9).nullish(),
        notify: zod_1.z.object({ targetId: zod_1.z.string().trim().min(5).max(64), levelIdx: zod_1.z.array(zod_1.z.number().int().min(0).max(7)).max(8).nullish(), labelColumnIds: zod_1.z.array(http_1.zId).max(4).nullish() }).nullish(),
        levels: zod_1.z.array(zod_1.z.object({ atPct: zod_1.z.number().min(0).max(100000), color: zod_1.z.string().max(9), label: zod_1.z.string().max(40).nullish() })).min(1).max(8),
    })
        .nullish(),
    docNumber: zod_1.z
        .object({
        template: zod_1.z.string().trim().min(1).max(100),
        prefixes: zod_1.z.array(zod_1.z.string().trim().min(1).max(50)).max(200).nullish(),
        prefixLookup: zod_1.z.object({ sheetId: http_1.zId, columnId: http_1.zId }).nullish(),
        dateColumnId: http_1.zId.nullish(),
    })
        .nullish(),
    lookup: zod_1.z
        .object({
        sheetId: zod_1.z.union([http_1.zId, zod_1.z.literal('')]).optional(),
        columnId: zod_1.z.union([http_1.zId, zod_1.z.literal('')]).optional(),
        parent: zod_1.z.object({ localColumnId: http_1.zId, foreignColumnId: http_1.zId }).nullish(),
        users: zod_1.z.object({ tag: zod_1.z.string().trim().max(100).nullish() }).nullish(),
    })
        .refine((l) => !!l.users || (!!l.sheetId && !!l.columnId), 'เลือกตารางและคอลัมน์ต้นทางของตัวเลือก หรือเลือกดึงจากรายชื่อผู้ใช้')
        .nullish(),
})
    .partial();
exports.columnInput = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'กรุณาตั้งชื่อคอลัมน์').max(200),
    dataType: zod_1.z.enum(cellValue_1.DATA_TYPES),
    isRequired: zod_1.z.boolean().default(false),
    width: zod_1.z.number().int().min(40).max(1200).default(160),
    defaultValue: zod_1.z.any().optional(),
    placeholder: zod_1.z.string().max(300).nullish(),
    description: zod_1.z.string().max(500).nullish(),
    validation: exports.validationSchema.nullish(),
    options: zod_1.z.array(exports.optionSchema).max(500).nullish(),
});
exports.sheetInput = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, 'กรุณาตั้งชื่อชีต').max(200),
    tabColor: http_1.zColor.nullish(),
    columns: zod_1.z.array(exports.columnInput).max(300).default([]),
});
exports.filterSchema = zod_1.z.object({
    columnId: zod_1.z.string().max(60).transform((s) => s.toLowerCase()),
    mode: zod_1.z.enum(['include', 'exclude']).optional(),
    values: zod_1.z.array(zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean()])).max(5000).optional(),
    blank: zod_1.z.boolean().optional(),
    op: zod_1.z
        .enum([
        'contains',
        'not_contains',
        'starts_with',
        'ends_with',
        'eq',
        'neq',
        'gt',
        'gte',
        'lt',
        'lte',
        'between',
        'is_empty',
        'not_empty',
    ])
        .optional(),
    value: zod_1.z.any().optional(),
    value2: zod_1.z.any().optional(),
});
exports.sortSchema = zod_1.z.object({
    columnId: zod_1.z.string().max(60).transform((s) => s.toLowerCase()),
    dir: zod_1.z.enum(['asc', 'desc']),
});
/**
 * Validates a column definition beyond its shape: options for select types,
 * a compilable pattern, min <= max, and a default value that satisfies the column.
 * Returns the values to persist.
 */
function checkColumnInput(input) {
    const isSelect = input.dataType === 'select' || input.dataType === 'multi_select';
    const hasLookup = isSelect && !!input.validation?.lookup;
    if (input.dataType === 'doc_number' && !input.validation?.docNumber?.template)
        throw (0, http_1.badRequest)(`คอลัมน์ "${input.name}": กรุณากำหนดรูปแบบเลขที่`);
    let options = [];
    if (isSelect && !hasLookup) {
        options = (input.options ?? []).map((o) => ({ value: o.value, label: o.label, color: o.color ?? null }));
        if (!options.length)
            throw (0, http_1.badRequest)(`คอลัมน์ "${input.name}" ต้องมีตัวเลือกอย่างน้อย 1 รายการ`);
        const seen = new Set();
        for (const o of options) {
            if (seen.has(o.value))
                throw (0, http_1.badRequest)(`ตัวเลือก "${o.value}" ซ้ำในคอลัมน์ "${input.name}"`);
            seen.add(o.value);
        }
    }
    const validation = { ...(input.validation ?? {}) };
    if (validation.autoStamp) {
        const ok = validation.autoStamp === 'updatedAt' ? ['date', 'datetime'].includes(input.dataType) : ['varchar', 'text'].includes(input.dataType);
        if (!ok)
            throw (0, http_1.badRequest)(validation.autoStamp === 'updatedAt' ? `"${input.name}": เติมวันที่อัตโนมัติได้เฉพาะคอลัมน์วันที่` : `"${input.name}": เติมชื่อผู้แก้ไขอัตโนมัติได้เฉพาะคอลัมน์ข้อความ`);
    }
    if (validation.pattern) {
        try {
            new RegExp(validation.pattern);
        }
        catch {
            throw (0, http_1.badRequest)(`รูปแบบ (Regex) ของคอลัมน์ "${input.name}" ไม่ถูกต้อง`);
        }
    }
    if (validation.min != null && validation.max != null && validation.min > validation.max)
        throw (0, http_1.badRequest)(`ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด ในคอลัมน์ "${input.name}"`);
    let defaultValue = null;
    if (!hasLookup && input.dataType !== 'doc_number' && !input.validation?.formula?.expr && input.defaultValue !== undefined && input.defaultValue !== null && input.defaultValue !== '') {
        const def = {
            column_id: '',
            column_name: input.name,
            data_type: input.dataType,
            is_required: false,
            validation,
            options,
        };
        const n = (0, cellValue_1.normalizeValue)(def, input.defaultValue);
        if (!n.ok)
            throw (0, http_1.badRequest)(`ค่าเริ่มต้นของ "${input.name}" ไม่ถูกต้อง: ${n.error}`);
        defaultValue = n.value;
    }
    return {
        validation: Object.keys(validation).length ? validation : null,
        options: isSelect ? options : null,
        defaultValue,
    };
}
//# sourceMappingURL=schemas.js.map