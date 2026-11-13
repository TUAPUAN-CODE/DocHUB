import type { Request } from 'express';
import { q, q1, T, withTx } from '../../config/db';
import type { AuthUser } from '../../middleware/auth';
import { loadColumns } from '../../services/cellWriter';
import { createRowTx } from '../../services/rowCreate';
import { queryRows } from '../../services/rowQuery';
import { insertColumn } from '../../services/structure';
import { norm } from './core';
import { REMARK_COL } from './model';
import type { PlanItem, PlanResult } from './plan';

/**
 * The record file left in the plan folder after a plan is dropped: everything the plan says, as written, so it can be used later
 * (trace back from a printed code, raw-material use, dashboards) — plus the alerts found while importing.
 *   ผลนำเข้า   one row per run (time · line · document · country) with the plan's own values and what was done with it
 *   วัตถุดิบ    one row per plan row of a run: the columns right of ยอดผลิต (Rawmat, Material, Spec, kg …) under their own headers
 *   แจ้งเตือน   Rev. changed since the last plan · New Code / Remark of the master · not in the database · plant unknown · parser notes
 *   หัวแผน     the text above the plan table (form number, มี OT, notes of the planner)
 * Nothing is converted or guessed: text stays text, Excel errors (#DIV/0!) are left empty, numbers stay numbers.
 */
export type Item = PlanItem & { plant: string | null; area: string; inDb: boolean | null; market: string };
export interface Alert { kind: string; time: string | null; line: string; doc: string; country: string; detail: string }

export const ITEM_COLS = ['ไฟล์แผน', 'วันที่ผลิต', 'เวลา', 'กะ', 'ไลน์', 'ไลน์ (ตามแผน)', 'โรงงาน', 'พื้นที่', 'Product', 'Size', 'Customer', 'Doc.No', 'Rev.', 'ประเทศ',
  'Complementary', 'Code', 'ยอด', 'หมายเหตุยอด', 'Doc.No อื่นในรายการ', 'หัวบล็อก', 'หมายเหตุ', REMARK_COL, 'แจ้งเตือน', 'ผลการนำเข้า', 'แถวในแผน'] as const;
const FLOAT_ITEM = new Set(['ยอด']);
const TEXT_ITEM = new Set(['หมายเหตุ', 'หมายเหตุยอด', 'หัวบล็อก', 'แจ้งเตือน', REMARK_COL]);
const DETAIL_LEAD = ['วันที่ผลิต', 'เวลา', 'ไลน์', 'Doc.No (รายการ)', 'ประเทศ', 'Doc.No (แถว)', 'Rev. (แถว)'];

/** Remark (ไม่ Ink) of the master database rows of these documents: "doc|market" (normalised) → remark */
export async function masterRemarks(dbSheetId: string | null, docs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!dbSheetId || !docs.length) return out;
  const cols = await loadColumns(dbSheetId);
  const c = (n: string) => cols.find((x: any) => x.column_name === n)?.column_id as string | undefined;
  const cd = c('รหัสเอกสาร'), cm = c('Market'), cr = c(REMARK_COL);
  if (!cd || !cm || !cr) return out;
  const uniq = [...new Set(docs)];
  for (let i = 0; i < uniq.length; i += 100) {
    const r = await queryRows(dbSheetId, cols, { page: 1, pageSize: 1000, filters: [{ columnId: cd, values: uniq.slice(i, i + 100) } as any] });
    for (const row of r.rows) {
      const v = row.values as Record<string, unknown>;
      const rem = String(v[cr] ?? '').trim();
      const key = `${norm(v[cd])}|${norm(v[cm])}`;
      if (rem && !out.has(key)) out.set(key, rem);
    }
  }
  return out;
}

/** The Rev. each document had in the latest earlier plan record (sheets "ผลนำเข้า" of earlier drops): doc (normalised) → { rev, date } */
export async function lastRevs(date: string, docs: string[]): Promise<Map<string, { rev: string; date: string }>> {
  const out = new Map<string, { rev: string; date: string }>();
  if (!docs.length) return out;
  const rows = await q(`
    SELECT dc.value_text AS doc, rc.value_text AS rev, dd.value_text AS d
    FROM Sheets s
    JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
    JOIN Columns cdoc ON cdoc.sheet_id = s.sheet_id AND cdoc.column_name = N'Doc.No'
    JOIN Columns crev ON crev.sheet_id = s.sheet_id AND crev.column_name = N'Rev.'
    JOIN Columns cdt ON cdt.sheet_id = s.sheet_id AND cdt.column_name = N'วันที่ผลิต'
    JOIN Columns cres ON cres.sheet_id = s.sheet_id AND cres.column_name = N'ผลการนำเข้า'
    JOIN Rows r ON r.sheet_id = s.sheet_id AND r.is_deleted = 0
    JOIN Cells dc ON dc.row_id = r.row_id AND dc.column_id = cdoc.column_id
    JOIN Cells rc ON rc.row_id = r.row_id AND rc.column_id = crev.column_id
    JOIN Cells dd ON dd.row_id = r.row_id AND dd.column_id = cdt.column_id
    WHERE s.sheet_name = N'ผลนำเข้า' AND s.is_deleted = 0 AND dd.value_text < @d
      AND dc.value_text IN (SELECT [value] FROM OPENJSON(@docs))`, { d: date, docs: JSON.stringify([...new Set(docs)]) });
  for (const r of rows as { doc: string; rev: string | null; d: string }[]) {
    const k = norm(r.doc), rev = String(r.rev ?? '').trim();
    if (!rev) continue;
    const have = out.get(k);
    if (!have || r.d > have.date) out.set(k, { rev, date: r.d });
  }
  return out;
}

export function findAlerts(items: (Item & { status: string })[], remarks: Map<string, string>, revs: Map<string, { rev: string; date: string }>, warnings: string[]): Alert[] {
  const out: Alert[] = [];
  const a = (i: Item, kind: string, detail: string) => out.push({ kind, time: i.time, line: i.line, doc: i.doc, country: i.country, detail });
  for (const i of items) {
    if (i.status.startsWith('ข้าม: ไม่พบในฐานข้อมูล')) a(i, 'ไม่พบในฐานข้อมูล', `ไม่มี ${i.doc} + ${i.country} ใน Master Database — เพิ่มแถวก่อน แล้วนำเข้าแผนใหม่`);
    if (i.status.startsWith('ข้าม: ไม่ทราบโรงงาน')) a(i, 'ไม่ทราบโรงงาน', `ไลน์ "${i.line}" (แผนเขียน "${i.lineRaw}") ไม่มีในชีต ตั้งค่าไลน์`);
    const rem = remarks.get(`${norm(i.doc)}|${norm(i.market)}`);
    if (rem) a(i, /new\s+code/i.test(rem) ? 'New Code' : 'Remark', rem);
    const last = revs.get(norm(i.doc)), rev = String(i.rev ?? '').trim();
    if (last && rev && last.rev !== rev) a(i, 'Rev. เปลี่ยน', `${i.doc} แผนนี้ Rev. ${rev} · แผนวันที่ ${last.date} Rev. ${last.rev} — ตรวจเอกสาร/แบบโค้ดว่าเป็นฉบับล่าสุด`);
  }
  for (const w of warnings) out.push({ kind: 'ตรวจสอบ', time: null, line: '', doc: '', country: '', detail: w });
  return out;
}

const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(' · ');

/** Writes the record file; returns its id */
export async function writeRecord(user: AuthUser, folderId: string, originalName: string, date: string, plan: PlanResult,
  items: (Item & { status: string })[], alerts: Alert[], req?: Request): Promise<string> {
  const base = originalName.replace(/\.xlsx?$/i, '').slice(0, 150);
  const alertOf = new Map<string, string[]>();
  for (const x of alerts) if (x.doc) { const k = `${x.time}|${x.line}|${x.doc}|${x.country}`; alertOf.set(k, [...(alertOf.get(k) ?? []), `${x.kind}: ${x.detail}`]); }
  const detailHeaders = (plan.detailHeaders ?? []).filter((h) => !DETAIL_LEAD.includes(h) && h !== 'แถวในแผน');
  const allDetails = items.flatMap((i) => (i.extra?.details ?? []).map((d) => ({ i, d })));
  // a detail column is a number column only when every value written in it is a number
  const numeric = new Set(detailHeaders.filter((h) => { const vs = allDetails.map((x) => x.d.values[h]).filter((v) => v !== null && v !== undefined); return vs.length > 0 && vs.every((v) => typeof v === 'number'); }));
  const longCol = (h: string) => allDetails.some((x) => typeof x.d.values[h] === 'string' && (x.d.values[h] as string).length > 900);

  return withTx(async (tx) => {
    const f = await q1(`INSERT INTO Files (file_name, folder_id, description, color, icon, created_by) OUTPUT inserted.file_id VALUES (@n, @fo, @d, N'#16A34A', N'sheet', @u)`,
      { n: `แผน ${date} · ${base}`, fo: T.uuid(folderId), d: T.text(`บันทึกแผนผลิตวันที่ ${date} (ไฟล์ ${originalName}) — ผลนำเข้า · วัตถุดิบ · แจ้งเตือน ${alerts.length} รายการ · หัวแผน`), u: T.uuid(user.id) }, tx);
    const fileId = f!.file_id as string;
    const sheet = async (name: string, order: number, cols: { name: string; type: string; width: number }[]) => {
      const sh = await q1(`INSERT INTO Sheets (file_id, sheet_name, sort_order, created_by) OUTPUT inserted.sheet_id VALUES (@f, @n, @o, @u)`, { f: T.uuid(fileId), n: name, o: order, u: T.uuid(user.id) }, tx);
      const ids: string[] = [];
      for (const [k, c] of cols.entries()) ids.push(String((await insertColumn(tx, sh!.sheet_id, { name: c.name, dataType: c.type, isRequired: false, width: c.width } as any, k, user.id))!.column_id).toLowerCase());
      const add = async (vals: unknown[]) => createRowTx(tx, user, { file_id: fileId }, sh!.sheet_id, Object.fromEntries(ids.map((id, k) => [id, vals[k] ?? null]).filter(([, v]) => v !== null && v !== '')), 'plan-drop', req);
      return add;
    };

    // 1) runs
    const addItem = await sheet('ผลนำเข้า', 0, ITEM_COLS.map((n) => ({ name: n, type: FLOAT_ITEM.has(n) ? 'float' : TEXT_ITEM.has(n) ? 'text' : 'varchar', width: TEXT_ITEM.has(n) ? 260 : n === 'ผลการนำเข้า' ? 240 : 130 })));
    for (const i of items.slice(0, 2000)) {
      const x = i.extra;
      const rem = i.status;
      await addItem([originalName, date, i.time ?? '', i.shift, i.line, i.lineRaw, i.plant ?? '', i.area, i.product, i.size ?? '', i.customer ?? '', i.doc, i.rev ?? '', i.country,
        x?.complementary ?? '', x?.code ?? '', i.qty, join(x?.qtyNotes ?? []), join((x?.otherDocs ?? []).map((o) => (o.rev ? `${o.doc} Rev.${o.rev}` : o.doc))), x?.block ?? '', join(x?.notes ?? []),
        alerts.find((a) => a.doc === i.doc && a.country === i.country && a.time === i.time && a.line === i.line && (a.kind === 'New Code' || a.kind === 'Remark'))?.detail ?? '',
        join(alertOf.get(`${i.time}|${i.line}|${i.doc}|${i.country}`) ?? []), rem, (x?.rows ?? [i.sourceRow]).join(', ')]);
    }
    // 2) raw-material rows
    if (allDetails.length) {
      const addDetail = await sheet('วัตถุดิบ', 1, [
        ...DETAIL_LEAD.map((n) => ({ name: n, type: 'varchar', width: 120 })),
        ...detailHeaders.map((h) => ({ name: h, type: numeric.has(h) ? 'float' : longCol(h) ? 'text' : 'varchar', width: numeric.has(h) ? 110 : 180 })),
        { name: 'แถวในแผน', type: 'int', width: 90 },
      ]);
      for (const { i, d } of allDetails.slice(0, 5000)) {
        await addDetail([date, i.time ?? '', i.line, i.doc, i.country, d.doc, d.rev ?? '', ...detailHeaders.map((h) => d.values[h] ?? null), d.row]);
      }
    }
    // 3) alerts
    const addAlert = await sheet('แจ้งเตือน', 2, [{ name: 'ประเภท', type: 'varchar', width: 140 }, { name: 'เวลา', type: 'varchar', width: 80 }, { name: 'ไลน์', type: 'varchar', width: 110 },
      { name: 'Doc.No', type: 'varchar', width: 110 }, { name: 'ประเทศ', type: 'varchar', width: 110 }, { name: 'รายละเอียด', type: 'text', width: 420 }]);
    for (const a of alerts.slice(0, 2000)) await addAlert([a.kind, a.time ?? '', a.line, a.doc, a.country, a.detail]);
    // 4) text above the table
    if (plan.headerNotes?.length) {
      const addNote = await sheet('หัวแผน', 3, [{ name: 'ข้อความ', type: 'text', width: 520 }]);
      for (const n of plan.headerNotes) await addNote([n]);
    }
    return fileId;
  });
}
