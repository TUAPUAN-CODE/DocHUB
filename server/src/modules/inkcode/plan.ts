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
    const cDoc = col('doc.no'), cCountry = col('country'), cLine = col('line'), cProduct = col('product'), cTime = col('time'), cSize = col('size'), cCust = col('customer'), cRev = col('rev.'), cQty = col('ยอดผลิต'), cCode = col('code');
    if (cCountry < 0 || cLine < 0 || cTime < 0) continue;   // the daily plan has a Time column; other sheets with Doc.No (weekly plans) are not it
    // date: "…ประจำวันที่" followed by a date in the first rows
    let date: string | null = null;
    for (const r of rows.slice(0, hi)) {
      const at = r.findIndex((c) => txt(c).includes('ประจำวันที่'));
      if (at >= 0) { date = r.slice(at + 1).map(isoDate).find(Boolean) ?? null; if (date) break; }
    }
    if (!date) warnings.push('ไม่พบวันที่ในหัวแผน (ข้อความ "ประจำวันที่ …") — ต้องระบุวันที่เอง');

    // A product is written on several rows (raw materials, notes). Those rows may carry other Doc.No values
    // (e.g. a raw-material formula "MRDPF184/26" next to the product's own "P342"): the product's document is the
    // Doc.No that appears most on its rows — never the first odd one — and quantities are read from those rows only.
    interface Group { time: string | null; product: string; lineRaw: string; country: string; code: string; size: string | null; customer: string | null; docs: Map<string, { n: number; rev: string | null; qty: number | null }>; first: number }
    const groups = new Map<string, Group>();
    for (let i = hi + 1; i < rows.length; i++) {
      const r = rows[i];
      const doc = txt(r[cDoc]);
      const country = txt(r[cCountry]);
      if (!doc || !country || !/^[A-Za-z0-9][A-Za-z0-9/.\-]{0,24}$/.test(doc)) continue;   // block titles, notes and the signature lines have no Doc.No
      const time = timeText(r[cTime]);
      const product = txt(r[cProduct]);
      const lineRaw = txt(r[cLine]);
      const code = cCode >= 0 ? txt(r[cCode]) : '';
      const key = [time, product, lineRaw, country, code].join('|');
      let g = groups.get(key);
      if (!g) { g = { time, product, lineRaw, country, code, size: cSize >= 0 ? txt(r[cSize]) || null : null, customer: cCust >= 0 ? txt(r[cCust]) || null : null, docs: new Map(), first: i + 1 }; groups.set(key, g); }
      const d = g.docs.get(doc) ?? { n: 0, rev: cRev >= 0 ? txt(r[cRev]) || null : null, qty: null };
      d.n++;
      if (d.qty === null && cQty >= 0 && typeof r[cQty] === 'number') d.qty = r[cQty] as number;
      g.docs.set(doc, d);
    }
    const items: PlanItem[] = [];
    for (const g of groups.values()) {
      const best = [...g.docs.entries()].reduce((a, b) => (b[1].n > a[1].n ? b : a));
      const rl = resolveLine(g.product, g.lineRaw, knownLines);
      if (!rl.known && knownLines.length) warnings.push(`แถว ${g.first}: ไม่พบไลน์ "${rl.line}" ในตารางรหัสอ้างอิง (${g.product} / ${g.lineRaw})`);
      else if (rl.guessed) warnings.push(`แถว ${g.first}: "${g.lineRaw}" มีหลายไลน์ — เลือก "${rl.line}" (ตรวจ/แก้ภายหลังได้)`);
      if (g.docs.size > 1) warnings.push(`แถว ${g.first}: ${g.product} ${g.lineRaw} มีหลาย Doc.No (${[...g.docs.keys()].join(', ')}) — ใช้ "${best[0]}"`);
      items.push({ time: g.time, product: g.product, lineRaw: g.lineRaw, line: rl.line, size: g.size, customer: g.customer, country: g.country, doc: best[0], rev: best[1].rev, qty: best[1].qty, shift: shiftOf(g.time), sourceRow: g.first });
    }
    return { date, sheetName: name, items, warnings: [...new Set(warnings)] };
  }
  throw new Error('ไม่พบตารางแผนผลิตในไฟล์ (ต้องมีหัวคอลัมน์ Doc.No, Line, Country)');
}
