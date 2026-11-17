"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = exports.cleanEmails = exports.DEFAULT_CONFIG = void 0;
exports.getConfig = getConfig;
exports.saveConfig = saveConfig;
exports.qhRowsFor = qhRowsFor;
exports.buildMail = buildMail;
exports.notifyQhMail = notifyQhMail;
exports.sendTestMail = sendTestMail;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../../config/db");
const env_1 = require("../../config/env");
const cellWriter_1 = require("../../services/cellWriter");
const rowQuery_1 = require("../../services/rowQuery");
const outlook_1 = require("../connectors/outlook");
const smtp_1 = require("../connectors/smtp");
const core_1 = require("./core");
/**
 * E-mail when an imported plan has a Doc No that is in Quality Highlight: one mail per plan to the people typed on the plan page
 * (To / CC / subject / intro), listing the plan lines and, for each Doc No, the Quality Highlight rows (Material, Short Code, note, update).
 * Sent from the Outlook mailbox an admin connected (connectors/outlook.ts). The same plan (same days, docs and people) is not mailed twice.
 */
const KEY = 'inkcode.qhMail';
const SENT_KEY = 'inkcode.qhMail.sent';
exports.DEFAULT_CONFIG = {
    enabled: false, channel: 'smtp', to: [], cc: [],
    subject: 'Quality Highlight · แผนผลิตวันที่ {date} มี {count} รายการที่ต้องแจ้ง',
    intro: 'แผนผลิตวันที่ {date} (ไฟล์ {file}) มีสินค้าที่ Doc No ตรงกับ Quality Highlight — รายละเอียดด้านล่าง',
};
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const cleanEmails = (xs) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL.test(x)))].slice(0, 50);
exports.cleanEmails = cleanEmails;
const getSetting = async (k) => (await (0, db_1.q1)(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k }))?.setting_value;
const setSetting = (k, v, userId) => (0, db_1.q)(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
  WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k, v: db_1.T.text(v), u: db_1.T.uuid(userId) });
async function getConfig() {
    try {
        const v = JSON.parse((await getSetting(KEY)) ?? 'null');
        if (v)
            return { ...exports.DEFAULT_CONFIG, ...v, to: (0, exports.cleanEmails)(v.to ?? []), cc: (0, exports.cleanEmails)(v.cc ?? []) };
    }
    catch { /* default */ }
    return { ...exports.DEFAULT_CONFIG };
}
async function saveConfig(c, userId) {
    const v = { enabled: !!c.enabled, channel: c.channel === 'outlook' ? 'outlook' : 'smtp', to: (0, exports.cleanEmails)(c.to), cc: (0, exports.cleanEmails)(c.cc), subject: c.subject.trim().slice(0, 200) || exports.DEFAULT_CONFIG.subject, intro: c.intro.trim().slice(0, 2000) };
    await setSetting(KEY, JSON.stringify(v), userId);
    return v;
}
/** The sheet "Master" of the file Quality Highlight - Master (also spelled "Hilight") */
async function qhMaster() {
    const r = await (0, db_1.q1)(`SELECT TOP 1 f.file_id, s.sheet_id FROM Files f JOIN Sheets s ON s.file_id = f.file_id AND s.is_deleted = 0 AND s.sheet_name = N'Master'
                      WHERE f.is_deleted = 0 AND f.file_name IN (N'Quality Highlight - Master', N'Quality Hilight - Master') ORDER BY f.created_at`);
    return r ? { fileId: String(r.file_id), sheetId: String(r.sheet_id) } : null;
}
const COLS = { subDoc: 'Sub Doc No.', material: 'Material', shortCode: 'Short Code', updated: 'วันที่ Update ข้อมูล', by: 'Updated by' };
/** The description column of Quality Highlight: "รายละเอียด" (the name on the live sheet); older copies call it "ให้Spread" */
const NOTE_COLS = ['รายละเอียด', 'ให้Spread', 'Description', 'Note'];
/** Quality Highlight rows whose Sub Doc No. is one of `docs` (compared without case / spaces), by Doc No. */
async function qhRowsFor(docs) {
    const m = await qhMaster();
    if (!m)
        return null;
    const cols = await (0, cellWriter_1.loadColumns)(m.sheetId);
    const id = (n) => cols.find((c) => c.column_name === n)?.column_id;
    const cs = id(COLS.subDoc);
    if (!cs)
        return null;
    const uniq = [...new Set(docs.map((d) => String(d ?? '').trim()).filter(Boolean))];
    const byDoc = new Map();
    const txt = (v) => (v === null || v === undefined ? '' : String(v).trim());
    for (let i = 0; i < uniq.length; i += 100) {
        const r = await (0, rowQuery_1.queryRows)(m.sheetId, cols, { page: 1, pageSize: 1000, filters: [{ columnId: cs, values: uniq.slice(i, i + 100) }] });
        for (const row of r.rows) {
            const v = row.values;
            const k = (0, core_1.norm)(v[cs]);
            const g = (n) => (id(n) ? txt(v[id(n)]) : '');
            const noteCol = NOTE_COLS.map(id).find(Boolean);
            byDoc.set(k, [...(byDoc.get(k) ?? []), { subDoc: txt(v[cs]), material: g(COLS.material), shortCode: g(COLS.shortCode), note: noteCol ? txt(v[noteCol]) : '', updated: g(COLS.updated).slice(0, 10), by: g(COLS.by) }]);
        }
    }
    return { fileId: m.fileId, byDoc };
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fill = (t, v) => t.replace(/\{(date|count|file)\}/g, (_, k) => v[k] ?? '');
const dmy = (d) => { const [y, m, dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };
/** One message through the channel picked on the plan page */
const sendMail = (channel, m) => (channel === 'outlook' ? (0, outlook_1.sendOutlookMail)(m) : (0, smtp_1.sendSmtpMail)(m));
exports.sendMail = sendMail;
function buildMail(cfg, date, file, lines, qh) {
    const hit = lines.filter((l) => qh.byDoc.has((0, core_1.norm)(l.doc)));
    const vars = { date: dmy(date), count: String(new Set(hit.map((l) => (0, core_1.norm)(l.doc))).size), file };
    const th = 'style="border:1px solid #d5dbe8;padding:6px 8px;background:#eef2fb;text-align:left;font-size:13px"';
    const td = 'style="border:1px solid #d5dbe8;padding:6px 8px;font-size:13px;vertical-align:top"';
    const rows = hit.sort((a, b) => `${a.time ?? ''}${a.line}`.localeCompare(`${b.time ?? ''}${b.line}`)).map((l) => {
        const qr = qh.byDoc.get((0, core_1.norm)(l.doc));
        return `<tr><td ${td}>${esc(l.time ?? '')}</td><td ${td}>${esc(l.line)}</td><td ${td}>${esc(l.product)}</td><td ${td}>${esc(l.country)}</td><td ${td}><b>${esc(l.doc)}</b></td>
      <td ${td}>${qr.map((r) => `<div style="margin-bottom:6px"><b>${esc(r.material)}</b>${r.shortCode ? ` · Short Code ${esc(r.shortCode)}` : ''}${r.note ? `<br><span style="color:#667">รายละเอียด:</span> ${esc(r.note).replace(/\n/g, '<br>')}` : ''}${r.updated ? `<br><span style="color:#667">อัปเดต ${esc(r.updated)}${r.by ? ` โดย ${esc(r.by)}` : ''}</span>` : ''}</div>`).join('')}</td></tr>`;
    }).join('');
    const link = env_1.env.publicUrl ? `<p style="font-size:13px">ดูทั้งหมดใน DocHUB: <a href="${esc(env_1.env.publicUrl)}/files/${esc(qh.fileId)}">Quality Highlight - Master</a></p>` : '';
    const html = `<div style="font-family:Segoe UI,Tahoma,sans-serif;color:#1d2433"><p>${esc(fill(cfg.intro, vars)).replace(/\n/g, '<br>')}</p>
    <table style="border-collapse:collapse"><tr><th ${th}>เวลา</th><th ${th}>ไลน์</th><th ${th}>Product</th><th ${th}>ประเทศ</th><th ${th}>Doc No</th><th ${th}>Quality Highlight</th></tr>${rows}</table>${link}
    <p style="font-size:12px;color:#889">อีเมลนี้ส่งอัตโนมัติจาก DocHUB เมื่อนำเข้าแผนผลิต</p></div>`;
    // the same content as plain text (for the "open in my mail program" draft)
    const text = [fill(cfg.intro, vars), '',
        ...hit.map((l) => [`• ${[l.time, l.line, l.product, l.country].filter(Boolean).join(' · ')} — Doc No ${l.doc}`,
            ...qh.byDoc.get((0, core_1.norm)(l.doc)).map((r) => `    ${[r.material, r.shortCode && `Short Code ${r.shortCode}`, r.note && `รายละเอียด: ${r.note.replace(/\s*\n\s*/g, ' / ')}`, r.updated && `อัปเดต ${r.updated}${r.by ? ` โดย ${r.by}` : ''}`].filter(Boolean).join(' · ')}`)].join('\n')),
        ...(env_1.env.publicUrl ? ['', `ดูทั้งหมดใน DocHUB: ${env_1.env.publicUrl}/files/${qh.fileId}`] : [])].join('\n');
    return { subject: fill(cfg.subject, vars), html, text, matched: new Set(hit.map((l) => (0, core_1.norm)(l.doc))).size };
}
/** After a plan import. Never throws: the import must not fail because of a mail. */
async function notifyQhMail(userId, date, lines, fileName) {
    try {
        const cfg = await getConfig();
        const qh = await qhRowsFor(lines.map((l) => l.doc));
        if (!qh)
            return cfg.enabled ? { matched: 0, sent: false, skipped: 'ไม่พบไฟล์ Quality Highlight - Master' } : null;
        const mail = buildMail(cfg, date, fileName, lines.filter((l) => l.doc), qh);
        if (!mail.matched)
            return { matched: 0, sent: false, skipped: 'ไม่มี Doc No ที่ตรงกับ Quality Highlight' };
        const draft = { to: cfg.to, cc: cfg.cc, subject: mail.subject, html: mail.html, text: mail.text };
        if (!cfg.enabled)
            return { matched: mail.matched, sent: false, skipped: 'ไม่ได้เปิดส่งอัตโนมัติ', draft };
        if (!cfg.to.length)
            return { matched: mail.matched, sent: false, skipped: 'ยังไม่ได้ใส่ผู้รับอีเมล', draft };
        const hash = crypto_1.default.createHash('sha1').update(JSON.stringify([date, [...qh.byDoc.keys()].sort(), cfg.to, cfg.cc])).digest('hex');
        let sent = [];
        try {
            sent = JSON.parse((await getSetting(SENT_KEY)) ?? '[]');
        }
        catch { /* none yet */ }
        if (sent.includes(hash))
            return { matched: mail.matched, sent: false, skipped: 'แผนนี้ส่งอีเมลไปแล้ว', draft };
        await (0, exports.sendMail)(cfg.channel, { to: cfg.to, cc: cfg.cc, subject: mail.subject, html: mail.html });
        await setSetting(SENT_KEY, JSON.stringify([...sent, hash].slice(-300)), userId);
        return { matched: mail.matched, sent: true, to: cfg.to.length + cfg.cc.length, draft };
    }
    catch (e) {
        console.error('[inkcode] qh mail failed', e.message);
        return { matched: 0, sent: false, error: e.message };
    }
}
/** A test mail to the connected mailbox itself, with the first Quality Highlight rows as sample lines */
async function sendTestMail(channel, to) {
    const cfg = await getConfig();
    const m = await qhMaster();
    if (!m)
        throw new Error('ไม่พบไฟล์ Quality Highlight - Master');
    const cols = await (0, cellWriter_1.loadColumns)(m.sheetId);
    const cs = cols.find((c) => c.column_name === COLS.subDoc)?.column_id;
    const r = await (0, rowQuery_1.queryRows)(m.sheetId, cols, { page: 1, pageSize: 3 });
    const docs = r.rows.map((x) => String(x.values[cs] ?? '').trim()).filter(Boolean);
    const qh = await qhRowsFor(docs);
    if (!qh || !docs.length)
        throw new Error('Quality Highlight ยังไม่มีข้อมูลให้ทดสอบ');
    const lines = docs.map((d, i) => ({ time: `0${7 + i}:00`, line: `Line ${i + 1}`, product: '(ตัวอย่าง)', country: '-', doc: d }));
    const mail = buildMail(cfg, new Date().toISOString().slice(0, 10), 'ตัวอย่าง.xlsx', lines, qh);
    await (0, exports.sendMail)(channel, { to: [to], subject: `[ทดสอบ] ${mail.subject}`, html: mail.html });
}
//# sourceMappingURL=qhMail.js.map