import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface SourceConfig {
  format: 'auto' | 'json' | 'csv' | 'xlsx';
  /** JSON: path to the array, e.g. "data.items" (blank = the root array) */
  jsonPath?: string;
  /** XLSX: sheet name (blank = first) */
  sheetName?: string;
  /** XLSX/CSV: row number (1-based) holding the column names */
  headerRow?: number;
  delimiter?: string;
}
export type Rec = Record<string, unknown>;

const flat = (o: unknown, prefix = '', out: Rec = {}): Rec => {
  if (o && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Date)) for (const [k, v] of Object.entries(o)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  else out[prefix] = Array.isArray(o) ? JSON.stringify(o) : o;
  return out;
};

export function detectFormat(cfg: SourceConfig, contentType: string, url: string, head: Buffer): 'json' | 'csv' | 'xlsx' {
  if (cfg.format !== 'auto') return cfg.format;
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
  if (/json/i.test(contentType) || /\.json(\?|$)/i.test(url) || /^\s*[[{]/.test(head.subarray(0, 20).toString('utf8'))) return 'json';
  return 'csv';
}

export function parseRecords(body: Buffer, cfg: SourceConfig, contentType = '', url = ''): Rec[] {
  const fmt = detectFormat(cfg, contentType, url, body);
  if (fmt === 'json') {
    let j: unknown = JSON.parse(body.toString('utf8'));
    for (const p of (cfg.jsonPath ?? '').split('.').filter(Boolean)) j = (j as Rec | undefined)?.[p];
    if (!Array.isArray(j)) { if (j && typeof j === 'object') j = [j]; else throw new Error('ไม่พบข้อมูลแบบอาร์เรย์ตาม JSON path ที่ระบุ'); }
    return (j as unknown[]).map((x) => flat(x));
  }
  if (fmt === 'csv') {
    const text = body.toString('utf8').replace(/^﻿/, '');
    const lines = text.split(/\r?\n/);
    const h = Math.max(1, cfg.headerRow ?? 1);
    const r = Papa.parse<Rec>(lines.slice(h - 1).join('\n'), { header: true, skipEmptyLines: true, delimiter: cfg.delimiter || '' });
    return r.data;
  }
  const wb = XLSX.read(body, { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[cfg.sheetName && wb.SheetNames.includes(cfg.sheetName) ? cfg.sheetName : wb.SheetNames[0]];
  if (!ws) throw new Error('ไม่พบชีตในไฟล์ Excel');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  const h = Math.max(1, cfg.headerRow ?? 1) - 1;
  const head = (rows[h] ?? []).map((x, i) => (x === null || x === '' ? `col${i + 1}` : String(x).trim()));
  return rows.slice(h + 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] ?? null])));
}

export const sheetNamesOf = (body: Buffer): string[] => { try { return XLSX.read(body, { type: 'buffer', bookSheets: true }).SheetNames; } catch { return []; } };
