import crypto from 'crypto';
import { q, q1, T } from '../../config/db';
import { env } from '../../config/env';
import { loadColumns } from '../../services/cellWriter';
import { queryRows } from '../../services/rowQuery';
import { sendOutlookMail } from '../connectors/outlook';
import { sendSmtpMail } from '../connectors/smtp';
import { norm } from './core';

/**
 * E-mail when an imported plan has a Doc No that is in Quality Highlight: one mail per plan to the people typed on the plan page
 * (To / CC / subject / intro), listing the plan lines and, for each Doc No, the Quality Highlight rows (Material, Short Code, note, update).
 * Sent from the Outlook mailbox an admin connected (connectors/outlook.ts). The same plan (same days, docs and people) is not mailed twice.
 */
const KEY = 'inkcode.qhMail';
const SENT_KEY = 'inkcode.qhMail.sent';
export type MailChannel = 'smtp' | 'outlook';
export interface QhMailConfig { enabled: boolean; channel: MailChannel; to: string[]; cc: string[]; subject: string; intro: string }
export const DEFAULT_CONFIG: QhMailConfig = {
  enabled: false, channel: 'smtp', to: [], cc: [],
  subject: 'Quality Highlight · แผนผลิตวันที่ {date} มี {count} รายการที่ต้องแจ้ง',
  intro: 'แผนผลิตวันที่ {date} (ไฟล์ {file}) มีสินค้าที่ Doc No ตรงกับ Quality Highlight — รายละเอียดด้านล่าง',
};
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const cleanEmails = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter((x) => EMAIL.test(x)))].slice(0, 50);

const getSetting = async (k: string) => (await q1(`SELECT setting_value FROM SystemSettings WHERE setting_key = @k`, { k }))?.setting_value as string | undefined;
const setSetting = (k: string, v: string, userId: string | null) => q(`MERGE SystemSettings AS t USING (SELECT @k AS setting_key) AS s ON t.setting_key = s.setting_key
  WHEN MATCHED THEN UPDATE SET setting_value = @v, updated_by = @u, updated_at = SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT (setting_key, setting_value, updated_by) VALUES (@k, @v, @u);`, { k, v: T.text(v), u: T.uuid(userId) });

export async function getConfig(): Promise<QhMailConfig> {
  try { const v = JSON.parse((await getSetting(KEY)) ?? 'null'); if (v) return { ...DEFAULT_CONFIG, ...v, to: cleanEmails(v.to ?? []), cc: cleanEmails(v.cc ?? []) }; } catch { /* default */ }
  return { ...DEFAULT_CONFIG };
}
export async function saveConfig(c: QhMailConfig, userId: string): Promise<QhMailConfig> {
  const v: QhMailConfig = { enabled: !!c.enabled, channel: c.channel === 'outlook' ? 'outlook' : 'smtp', to: cleanEmails(c.to), cc: cleanEmails(c.cc), subject: c.subject.trim().slice(0, 200) || DEFAULT_CONFIG.subject, intro: c.intro.trim().slice(0, 2000) };
  await setSetting(KEY, JSON.stringify(v), userId);
  return v;
}

/** The sheet "Master" of the file Quality Highlight - Master (also spelled "Hilight") */
async function qhMaster() {
  const r = await q1(`SELECT TOP 1 f.file_id, s.sheet_id FROM Files f JOIN Sheets s ON s.file_id = f.file_id AND s.is_deleted = 0 AND s.sheet_name = N'Master'
                      WHERE f.is_deleted = 0 AND f.file_name IN (N'Quality Highlight - Master', N'Quality Hilight - Master') ORDER BY f.created_at`);
  return r ? { fileId: String(r.file_id), sheetId: String(r.sheet_id) } : null;
}
export interface QhRow { subDoc: string; material: string; shortCode: string; note: string; updated: string; by: string }
const COLS = { subDoc: 'Sub Doc No.', material: 'Material', shortCode: 'Short Code', note: 'ให้Spread', updated: 'วันที่ Update ข้อมูล', by: 'Updated by' } as const;

/** Quality Highlight rows whose Sub Doc No. is one of `docs` (compared without case / spaces), by Doc No. */
export async function qhRowsFor(docs: string[]): Promise<{ fileId: string; byDoc: Map<string, QhRow[]> } | null> {
  const m = await qhMaster();
  if (!m) return null;
  const cols = await loadColumns(m.sheetId);
  const id = (n: string) => cols.find((c: any) => c.column_name === n)?.column_id as string | undefined;
  const cs = id(COLS.subDoc);
  if (!cs) return null;
  const uniq = [...new Set(docs.map((d) => String(d ?? '').trim()).filter(Boolean))];
  const byDoc = new Map<string, QhRow[]>();
  const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());
  for (let i = 0; i < uniq.length; i += 100) {
    const r = await queryRows(m.sheetId, cols, { page: 1, pageSize: 1000, filters: [{ columnId: cs, values: uniq.slice(i, i + 100) } as any] });
    for (const row of r.rows) {
      const v = row.values as Record<string, unknown>;
      const k = norm(v[cs]);
      const g = (n: string) => (id(n) ? txt(v[id(n)!]) : '');
      byDoc.set(k, [...(byDoc.get(k) ?? []), { subDoc: txt(v[cs]), material: g(COLS.material), shortCode: g(COLS.shortCode), note: g(COLS.note), updated: g(COLS.updated).slice(0, 10), by: g(COLS.by) }]);
    }
  }
  return { fileId: m.fileId, byDoc };
}

export interface PlanLine { time: string | null; line: string; product: string; country: string; doc: string }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(date|count|file)\}/g, (_, k) => v[k] ?? '');
const dmy = (d: string) => { const [y, m, dd] = d.split('-'); return dd ? `${dd}/${m}/${y}` : d; };

/** One message through the channel picked on the plan page */
export const sendMail = (channel: MailChannel, m: { to: string[]; cc?: string[]; subject: string; html: string }) => (channel === 'outlook' ? sendOutlookMail(m) : sendSmtpMail(m));

export function buildMail(cfg: QhMailConfig, date: string, file: string, lines: PlanLine[], qh: { fileId: string; byDoc: Map<string, QhRow[]> }) {
  const hit = lines.filter((l) => qh.byDoc.has(norm(l.doc)));
  const vars = { date: dmy(date), count: String(new Set(hit.map((l) => norm(l.doc))).size), file };
  const th = 'style="border:1px solid #d5dbe8;padding:6px 8px;background:#eef2fb;text-align:left;font-size:13px"';
  const td = 'style="border:1px solid #d5dbe8;padding:6px 8px;font-size:13px;vertical-align:top"';
  const rows = hit.sort((a, b) => `${a.time ?? ''}${a.line}`.localeCompare(`${b.time ?? ''}${b.line}`)).map((l) => {
    const qr = qh.byDoc.get(norm(l.doc))!;
    return `<tr><td ${td}>${esc(l.time ?? '')}</td><td ${td}>${esc(l.line)}</td><td ${td}>${esc(l.product)}</td><td ${td}>${esc(l.country)}</td><td ${td}><b>${esc(l.doc)}</b></td>
      <td ${td}>${qr.map((r) => `<div style="margin-bottom:6px"><b>${esc(r.material)}</b>${r.shortCode ? ` · Short Code ${esc(r.shortCode)}` : ''}${r.note ? `<br>${esc(r.note).replace(/\n/g, '<br>')}` : ''}${r.updated ? `<br><span style="color:#667">อัปเดต ${esc(r.updated)}${r.by ? ` โดย ${esc(r.by)}` : ''}</span>` : ''}</div>`).join('')}</td></tr>`;
  }).join('');
  const link = env.publicUrl ? `<p style="font-size:13px">ดูทั้งหมดใน DocHUB: <a href="${esc(env.publicUrl)}/files/${esc(qh.fileId)}">Quality Highlight - Master</a></p>` : '';
  const html = `<div style="font-family:Segoe UI,Tahoma,sans-serif;color:#1d2433"><p>${esc(fill(cfg.intro, vars)).replace(/\n/g, '<br>')}</p>
    <table style="border-collapse:collapse"><tr><th ${th}>เวลา</th><th ${th}>ไลน์</th><th ${th}>Product</th><th ${th}>ประเทศ</th><th ${th}>Doc No</th><th ${th}>Quality Highlight</th></tr>${rows}</table>${link}
    <p style="font-size:12px;color:#889">อีเมลนี้ส่งอัตโนมัติจาก DocHUB เมื่อนำเข้าแผนผลิต</p></div>`;
  // the same content as plain text (for the "open in my mail program" draft)
  const text = [fill(cfg.intro, vars), '',
    ...hit.map((l) => [`• ${[l.time, l.line, l.product, l.country].filter(Boolean).join(' · ')} — Doc No ${l.doc}`,
      ...qh.byDoc.get(norm(l.doc))!.map((r) => `    ${[r.material, r.shortCode && `Short Code ${r.shortCode}`, r.note.replace(/\s*\n\s*/g, ' / '), r.updated && `อัปเดต ${r.updated}${r.by ? ` โดย ${r.by}` : ''}`].filter(Boolean).join(' · ')}`)].join('\n')),
    ...(env.publicUrl ? ['', `ดูทั้งหมดใน DocHUB: ${env.publicUrl}/files/${qh.fileId}`] : [])].join('\n');
  return { subject: fill(cfg.subject, vars), html, text, matched: new Set(hit.map((l) => norm(l.doc))).size };
}

/** The mail as a draft the person sends from their own mail program (button on the import result) — works without any mail server */
export interface QhMailDraft { to: string[]; cc: string[]; subject: string; html: string; text: string }
export interface QhMailResult { matched: number; sent: boolean; to?: number; skipped?: string; error?: string; draft?: QhMailDraft }

/** After a plan import. Never throws: the import must not fail because of a mail. */
export async function notifyQhMail(userId: string, date: string, lines: PlanLine[], fileName: string): Promise<QhMailResult | null> {
  try {
    const cfg = await getConfig();
    const qh = await qhRowsFor(lines.map((l) => l.doc));
    if (!qh) return cfg.enabled ? { matched: 0, sent: false, skipped: 'ไม่พบไฟล์ Quality Highlight - Master' } : null;
    const mail = buildMail(cfg, date, fileName, lines.filter((l) => l.doc), qh);
    if (!mail.matched) return { matched: 0, sent: false, skipped: 'ไม่มี Doc No ที่ตรงกับ Quality Highlight' };
    const draft: QhMailDraft = { to: cfg.to, cc: cfg.cc, subject: mail.subject, html: mail.html, text: mail.text };
    if (!cfg.enabled) return { matched: mail.matched, sent: false, skipped: 'ไม่ได้เปิดส่งอัตโนมัติ', draft };
    if (!cfg.to.length) return { matched: mail.matched, sent: false, skipped: 'ยังไม่ได้ใส่ผู้รับอีเมล', draft };
    const hash = crypto.createHash('sha1').update(JSON.stringify([date, [...qh.byDoc.keys()].sort(), cfg.to, cfg.cc])).digest('hex');
    let sent: string[] = [];
    try { sent = JSON.parse((await getSetting(SENT_KEY)) ?? '[]'); } catch { /* none yet */ }
    if (sent.includes(hash)) return { matched: mail.matched, sent: false, skipped: 'แผนนี้ส่งอีเมลไปแล้ว', draft };
    await sendMail(cfg.channel, { to: cfg.to, cc: cfg.cc, subject: mail.subject, html: mail.html });
    await setSetting(SENT_KEY, JSON.stringify([...sent, hash].slice(-300)), userId);
    return { matched: mail.matched, sent: true, to: cfg.to.length + cfg.cc.length, draft };
  } catch (e) {
    console.error('[inkcode] qh mail failed', (e as Error).message);
    return { matched: 0, sent: false, error: (e as Error).message };
  }
}

/** A test mail to the connected mailbox itself, with the first Quality Highlight rows as sample lines */
export async function sendTestMail(channel: MailChannel, to: string): Promise<void> {
  const cfg = await getConfig();
  const m = await qhMaster();
  if (!m) throw new Error('ไม่พบไฟล์ Quality Highlight - Master');
  const cols = await loadColumns(m.sheetId);
  const cs = cols.find((c: any) => c.column_name === COLS.subDoc)?.column_id as string;
  const r = await queryRows(m.sheetId, cols, { page: 1, pageSize: 3 });
  const docs = r.rows.map((x) => String((x.values as Record<string, unknown>)[cs] ?? '').trim()).filter(Boolean);
  const qh = await qhRowsFor(docs);
  if (!qh || !docs.length) throw new Error('Quality Highlight ยังไม่มีข้อมูลให้ทดสอบ');
  const lines: PlanLine[] = docs.map((d, i) => ({ time: `0${7 + i}:00`, line: `Line ${i + 1}`, product: '(ตัวอย่าง)', country: '-', doc: d }));
  const mail = buildMail(cfg, new Date().toISOString().slice(0, 10), 'ตัวอย่าง.xlsx', lines, qh);
  await sendMail(channel, { to: [to], subject: `[ทดสอบ] ${mail.subject}`, html: mail.html });
}
