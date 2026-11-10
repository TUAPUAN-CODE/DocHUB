"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPrinter = void 0;
exports.slipRows = slipRows;
exports.printSlip = printSlip;
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const cellValue_1 = require("../../shared/cellValue");
const cellWriter_1 = require("../../services/cellWriter");
const logger_1 = require("../../shared/logger");
const pad = (n) => String(n).padStart(2, '0');
const localText = (d) => { const t = new Date(d.getTime() + env_1.env.tzOffsetMinutes * 60000); return `${pad(t.getUTCDate())}/${pad(t.getUTCMonth() + 1)}/${t.getUTCFullYear() + 543} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`; };
/** The rows the slip shows: "column name: value" in the order the manager chose */
async function slipRows(sheetId, rowId, columnIds) {
    if (!columnIds.length)
        return [];
    const cols = new Map((await (0, cellWriter_1.loadColumns)(sheetId)).map((c) => [String(c.column_id).toLowerCase(), c]));
    const cells = await (0, db_1.q)(`SELECT column_id, value_text, value_int, value_float, value_date, value_bool, value_json FROM Cells WHERE row_id = @r AND column_id IN ${(0, db_1.idList)('@cc')}`, { r: db_1.T.uuid(rowId), cc: (0, db_1.jsonParam)(columnIds) });
    const byCol = new Map(cells.map((c) => [String(c.column_id).toLowerCase(), c]));
    const out = [];
    for (const id of columnIds) {
        const c = cols.get(id.toLowerCase());
        if (!c)
            continue;
        const def = (0, cellValue_1.toColumnDef)(c);
        const v = (0, cellValue_1.fromStorage)(def.data_type, byCol.get(id.toLowerCase()));
        let text = '';
        if (v === null || v === '')
            text = '-';
        else if (def.data_type === 'datetime')
            text = `${localText(new Date(String(v)))} น.`;
        else if (def.data_type === 'date') {
            const [y, m, d] = String(v).split('-');
            text = `${d}/${m}/${Number(y) + 543}`;
        }
        else if (def.data_type === 'boolean')
            text = v ? 'ใช่' : 'ไม่ใช่';
        else if (def.data_type === 'select')
            text = def.options.find((o) => o.value === v)?.label ?? String(v);
        else if (Array.isArray(v))
            text = def.data_type === 'multi_select' ? v.map((x) => def.options.find((o) => o.value === x)?.label ?? x).join(', ') : `${v.length} รูป`;
        else
            text = String(v);
        out.push({ label: def.column_name, value: text });
    }
    return out;
}
/** Sends the slip of a row to the print-agent of the printer (same agent, same printers as PFCM) */
async function printSlip(printer, args) {
    const { cfg } = args;
    const rows = await slipRows(args.sheetId, args.rowId, cfg.columnIds ?? []);
    if (args.stamped)
        rows.unshift({ label: 'บันทึกเวลา', value: `${args.stamped} ${localText(new Date())} น.` });
    let qr = null;
    if (cfg.qr === 'rowNo')
        qr = `${args.sheetName}#${args.rowNo}`;
    else if (cfg.qr === 'column' && cfg.qrColumnId)
        qr = (await slipRows(args.sheetId, args.rowId, [cfg.qrColumnId]))[0]?.value ?? null;
    const body = {
        identifier: `${args.sheetId}:${args.rowId}:${args.stamped ?? args.action}`,
        title: cfg.title || args.sheetName,
        subtitle: `แถว #${args.rowNo}`,
        rows, qr: qr && qr !== '-' ? qr : undefined,
        footer: localText(new Date()),
        printerHost: printer.printer_host || undefined,
        printerShare: printer.printer_share || undefined,
        printerDotWidth: printer.dot_width || undefined,
    };
    const res = await fetch(`${printer.agent_url.replace(/\/+$/, '')}/print-generic`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok || !json.ok)
        throw new Error(json.error ?? `Print Agent ตอบ ${res.status}`);
    logger_1.logger.info(`slip printed (${printer.printer_name}) row #${args.rowNo}${json.deduped ? ' [deduped by the agent]' : ''}`);
}
const loadPrinter = (id) => (0, db_1.q1)(`SELECT printer_id, printer_name, agent_url, printer_host, printer_share, dot_width FROM Printers WHERE printer_id = @p AND enabled = 1`, { p: db_1.T.uuid(id) });
exports.loadPrinter = loadPrinter;
//# sourceMappingURL=slip.js.map