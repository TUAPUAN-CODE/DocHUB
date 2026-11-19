import { pdfApi, rowsApi, sheetsApi } from '@/api/endpoints';
import { downloadXlsx } from '@/lib/csv';
import { loadFontB64 } from '@/lib/pdf/fonts';
import { defaultExportValues } from '@/lib/pdf/exportValues';
import { defaultTemplate, type PdfTemplate } from '@/lib/pdf/types';
import { isDelaySheet, sortLines, toDelayLines } from '@/modules/delayReport/lines';
import type { Row } from '@/types';
import type { ExportAction } from './api';

const MAX_PAGES = 100; // × 1,000 rows

const save = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name.replace(/[\\/:*?"<>|]/g, '-'); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
};

async function loadRows(a: ExportAction): Promise<Row[]> {
  const all: Row[] = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const r = await rowsApi.query(a.sheetId, { page: p, pageSize: 1000, sorts: a.sorts ?? [], filters: a.filters ?? [], search: a.search || undefined });
    all.push(...r.rows);
    if (all.length >= r.total) break;
  }
  return all;
}

/**
 * Makes the file the AI asked for (tool export_data) the same way the export menu of the sheet does, and downloads it.
 * Returns a short Thai description of what was made (for the toast / the chat).
 */
export async function runAiExport(a: ExportAction, user: string, onStatus?: (m: string) => void): Promise<string> {
  const detail = await sheetsApi.get(a.sheetId);
  const columns = detail.columns;
  const base = `${a.fileName} - ${a.sheetName}`;

  if (a.format === 'delay_pdf' || a.format === 'delay_xlsx') {
    if (!isDelaySheet(columns)) throw new Error('ชีตนี้ไม่ใช่รายงาน Delay F3PFPF67');
    onStatus?.('กำลังอ่านแถว…');
    const lines = sortLines(toDelayLines(await loadRows(a), columns), 'time');
    if (!lines.length) throw new Error('ไม่มีแถวที่จะออกรายงาน');
    const days = [...new Set(lines.map((l) => l.work_day).filter(Boolean))];
    const ymd = days.length === 1 ? String(days[0]).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const [y, m, d] = ymd.split('-');
    const meta = { exportDate: `${d}/${m}/${Number(y) + 543}`, exportShift: '', exportLine: [...new Set(lines.map((l) => l.line).filter(Boolean))].join(', '), exportPlant: '' };
    const sig = { recordedBy: user, reviewedBy: '', qcManager: '' };
    if (a.format === 'delay_xlsx') {
      const { exportDelayReportExcel } = await import('@/modules/delayReport/excel');
      await exportDelayReportExcel(lines, { ...meta, ...sig });
      return `Excel F3PFPV04 · ${lines.length.toLocaleString()} แถว`;
    }
    const [{ buildDelayReportPdf }, regular, bold] = await Promise.all([import('@/modules/delayReport/pdf'), loadFontB64('Sarabun-Regular.ttf'), loadFontB64('Sarabun-Bold.ttf')]);
    buildDelayReportPdf(lines, sig, meta, { regular, bold }).save(`F3PFPF67_${ymd}.pdf`);
    return `PDF F3PFPF67 · ${lines.length.toLocaleString()} แถว`;
  }

  // the columns the AI picked (all when none)
  const picked = a.columns?.length ? columns.filter((c) => a.columns!.includes(c.id)) : columns;

  if (a.format === 'xlsx') {
    onStatus?.('กำลังอ่านแถว…');
    const rows = await loadRows(a);
    await downloadXlsx(base, a.sheetName, picked, rows);
    return `Excel · ${rows.length.toLocaleString()} แถว`;
  }

  onStatus?.('กำลังสร้าง PDF…');
  const { generatePdf } = await import('@/lib/pdf/build');
  let tpl: PdfTemplate | null = null;
  if (a.template) {
    const want = a.template.toLowerCase();
    const list = ((await pdfApi.get(a.fileId).catch(() => ({ templates: [] }))).templates ?? []) as PdfTemplate[];
    tpl = list.find((t) => t.name.toLowerCase() === want) ?? list.find((t) => t.name.toLowerCase().includes(want)) ?? null;
  }
  const template = tpl ?? (() => {
    const t = defaultTemplate(a.title || a.fileName, { id: a.sheetId, name: a.sheetName, columns: picked });
    if (a.title) t.blocks = t.blocks.map((b, i) => (i === 0 && b.type === 'text' ? { ...b, text: a.title! } : b));
    return t;
  })();
  const { blob, truncated } = await generatePdf(template, {
    fileName: a.fileName, user, values: defaultExportValues(template, user),
    current: { sheetId: a.sheetId, sheetName: a.sheetName, filters: a.filters ?? [], sorts: a.sorts ?? [], search: a.search || undefined },
  });
  save(blob, `${base}${tpl ? ` - ${tpl.name}` : ''}.pdf`);
  return `PDF${tpl ? ` (${tpl.name})` : ''} · ${a.total.toLocaleString()} แถว${truncated ? ' (ส่งออกเฉพาะ 50,000 แถวแรก)' : ''}`;
}
