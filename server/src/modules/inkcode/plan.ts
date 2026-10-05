import * as XLSX from 'xlsx';

/**
 * Reads the daily production plan of the factory ("แผนผลิต Petfood ประจำวันที่ …") — one block per line, several rows per
 * product — and returns one item per (time, line, document, country).
 */
export interface PlanItem {
  time: string | null; product: string; lineRaw: string; line: string; size: string | null; customer: string | null; country: string; doc: string; rev: string | null; qty: number | null; shift: 'DS' | 'NS'; sourceRow: number;
}
export interface PlanResult { date: string | null; sheetName: string; items: PlanItem[]; warnings: string[] }

const txt = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim());
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export function isoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = txt(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}
/** "07:00", a time cell (Excel stores it as a fraction of a day → Date 1899/1900) or a Date → "HH:MM" */
export function timeText(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${String(v.getHours()).padStart(2, '0')}:${String(v.getMinutes()).padStart(2, '0')}`;
  if (typeof v === 'number' && v >= 0 && v < 1) { const mins = Math.round(v * 1440); return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`; }
  const m = /^(\d{1,2})[:.](\d{2})/.exec(txt(v));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
}
/** Day shift when the run starts between 06:00 and 18:59 (the plan has no shift column) */
export const shiftOf = (time: string | null): 'DS' | 'NS' => { const h = time ? Number(time.slice(0, 2)) : 7; return h >= 6 && h < 19 ? 'DS' : 'NS'; };

/**
 * product + line cell of the plan → a line name of the reference table: "Cup" + 1 → "Cup 1", "Can" + "U" → "Can U",
 * "Spout 2" → "Spout", "Auto B+C" → "Auto B" (first of several lines; `guessed` is set so the preview can warn)
 */
export function resolveLine(product: string, line: string, known: string[]): { line: string; known: boolean; guessed?: boolean } {
  const k = new Map(known.map((x) => [norm(x), x]));
  const exact = [`${product} ${line}`, line, `${product}${line}`, line.replace(/\s*\d+$/, ''), line.split(/[\s/(]+/)[0]];
  for (const c of exact) { const hit = k.get(norm(c)); if (hit) return { line: hit, known: true }; }
  const toks = line.split(/[/+,\\]+/).map((x) => x.trim()).filter(Boolean);
  for (const t of toks) for (const c of [`${product} ${t}`, t]) { const hit = k.get(norm(c)); if (hit) return { line: hit, known: true, guessed: toks.length > 1 }; }
  return { line: exact[0].trim(), known: false };
}

export function parsePlan(body: Buffer, knownLines: string[] = []): PlanResult {
  const wb = XLSX.read(body, { type: 'buffer', cellDates: true });
  const warnings: string[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
    // header row: the row that has "Doc.No"
    const hi = rows.slice(0, 30).findIndex((r) => r.some((c) => norm(txt(c)) === 'doc.no'));
    if (hi < 0) continue;
    const head = rows[hi].map((c) => norm(txt(c)));
    const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const cDoc = col('doc.no'), cCountry = col('country'), cLine = col('line'), cProduct = col('product'), cTime = col('time'), cSize = col('size'), cCust = col('customer'), cRev = col('rev.'), cQty = col('ยอดผลิต');
    if (cCountry < 0 || cLine < 0 || cTime < 0) continue;   // the daily plan has a Time column; other sheets with Doc.No (weekly plans) are not it
    // date: "…ประจำวันที่" followed by a date in the first rows
    let date: string | null = null;
    for (const r of rows.slice(0, hi)) {
      const at = r.findIndex((c) => txt(c).includes('ประจำวันที่'));
      if (at >= 0) { date = r.slice(at + 1).map(isoDate).find(Boolean) ?? null; if (date) break; }
    }
    if (!date) warnings.push('ไม่พบวันที่ในหัวแผน (ข้อความ "ประจำวันที่ …") — ต้องระบุวันที่เอง');

    const items = new Map<string, PlanItem>();
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const doc = txt(r[cDoc]);
      const country = txt(r[cCountry]);
      if (!doc || !country || !/^[A-Za-z0-9][A-Za-z0-9/.\-]{0,24}$/.test(doc)) continue;   // block titles, notes and the signature lines have no Doc.No
      const time = timeText(r[cTime]);
      const product = txt(r[cProduct]);
      const lineRaw = txt(r[cLine]);
      const key = [time, product, lineRaw, doc, country].join('|');
      const qty = cQty >= 0 && typeof r[cQty] === 'number' ? (r[cQty] as number) : null;
      const cur = items.get(key);
      if (cur) { if (cur.qty === null && qty !== null) cur.qty = qty; continue; }       // the plan repeats a product on 3-4 rows (raw materials, notes …)
      const rl = resolveLine(product, lineRaw, knownLines);
      if (!rl.known && knownLines.length) warnings.push(`แถว ${i + 1}: ไม่พบไลน์ "${rl.line}" ในตารางรหัสอ้างอิง (${product} / ${lineRaw})`);
      else if (rl.guessed) warnings.push(`แถว ${i + 1}: "${lineRaw}" มีหลายไลน์ — เลือก "${rl.line}" (ตรวจ/แก้ภายหลังได้)`);
      items.set(key, { time, product, lineRaw, line: rl.line, size: cSize >= 0 ? txt(r[cSize]) || null : null, customer: cCust >= 0 ? txt(r[cCust]) || null : null, country, doc, rev: cRev >= 0 ? txt(r[cRev]) || null : null, qty, shift: shiftOf(time), sourceRow: i + 1 });
    }
    return { date, sheetName: name, items: [...items.values()], warnings: [...new Set(warnings)] };
  }
  throw new Error('ไม่พบตารางแผนผลิตในไฟล์ (ต้องมีหัวคอลัมน์ Doc.No, Line, Country)');
}
