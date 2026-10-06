import { alertColor } from '@/modules/alerts/level';
import { displayValue } from '@/lib/format';
import type { Column, Row } from '@/types';
import { bindToCurrent, collectData, CurrentView, resolveColumns, SheetData } from './data';
import { loadPdfMake } from './fonts';
import { preloadImages } from './images';
import './blocks';
import { getBlockModule } from './registry';
import { Block, ColumnsBlock, FieldsBlock, ImageBlock, LineBlock, MM, PDF_FONTS, PdfFont, PdfTemplate, TableBlock, TextBlock, TextStyle } from './types';
import { fillTokens, resolveVariables } from './variables';

export { fillTokens, fmtDatePdf } from './variables';

const PAGE_PT: Record<string, [number, number]> = { A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28], LETTER: [612, 792], LEGAL: [612, 1008] };
const pt = (mm?: number) => (mm ?? 0) * MM;
const margin = (b: { marginTop?: number; marginBottom?: number; marginLeft?: number; marginRight?: number }) => [pt(b.marginLeft), pt(b.marginTop), pt(b.marginRight), pt(b.marginBottom)];

interface Vars { [k: string]: string }
export interface BuildCtx {
  fileName: string; user: string; now: Date; tables: Map<string, SheetData>; images: Map<string, string>; base: PdfTemplate['base'];
  contentWidth: number; vars: Vars; rowVars?: Vars;
  /** names typed for the signature slots in the export dialog (slot id → name) */
  signers: Record<string, string>;
}


function textNode(text: string, s: TextStyle, base: PdfTemplate['base']) {
  const n: any = { text, font: s.font ?? base.font, fontSize: s.fontSize ?? base.fontSize, color: s.color ?? base.color, alignment: s.align ?? 'left', lineHeight: s.lineHeight ?? 1.15 };
  if (s.bold) n.bold = true;
  if (s.italic) n.italics = true;
  if (s.underline) n.decoration = 'underline';
  if (s.bg) n.background = s.bg;
  return n;
}

function absolute(node: any, b: { position?: { x: number; y: number } | null }) {
  if (b.position) node.absolutePosition = { x: pt(b.position.x), y: pt(b.position.y) };
  return node;
}

function textBlock(b: TextBlock, c: BuildCtx) {
  const node = textNode(fillTokens(b.text, c.vars, c.rowVars), b.style, c.base);
  if (b.border) {
    const w = b.border.width;
    return absolute({
      table: { widths: ['*'], body: [[{ ...node, margin: [0, 0, 0, 0] }]] }, margin: margin(b),
      layout: { hLineWidth: () => w, vLineWidth: () => w, hLineColor: () => b.border!.color, vLineColor: () => b.border!.color, paddingLeft: () => pt(b.border!.padding), paddingRight: () => pt(b.border!.padding), paddingTop: () => pt(b.border!.padding), paddingBottom: () => pt(b.border!.padding) },
    }, b);
  }
  return absolute({ ...node, margin: margin(b) }, b);
}

function urlsOf(b: ImageBlock, c: BuildCtx): string[] {
  if (b.source === 'static') return b.url ? [b.url] : [];
  const sd = [...c.tables.values()].find((t) => t.rows.length && c.rowVars) ;
  void sd;
  return [];
}

function imageNode(url: string, widthMm: number, heightMm: number | null | undefined, c: BuildCtx) {
  const data = c.images.get(url);
  if (!data) return null;
  return heightMm ? { image: data, fit: [pt(widthMm), pt(heightMm)] } : { image: data, width: pt(widthMm) };
}

function imageBlock(b: ImageBlock, c: BuildCtx, rowImages?: string[]) {
  const urls = b.source === 'column' ? (rowImages ?? []).slice(0, b.maxImages ?? 4) : urlsOf(b, c);
  const nodes = urls.map((u) => imageNode(u, b.widthMm, b.heightMm, c)).filter(Boolean) as any[];
  if (!nodes.length) return null;
  const node: any = nodes.length === 1 ? { ...nodes[0] } : { columns: nodes.map((n) => ({ ...n, width: 'auto' })), columnGap: 4 };
  if (nodes.length === 1) node.alignment = b.align === 'justify' ? 'left' : b.align;
  node.margin = margin(b);
  return absolute(node, b);
}

function lineBlock(b: LineBlock, c: BuildCtx) {
  const w = (c.contentWidth * b.widthPct) / 100;
  return absolute({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: w, y2: 0, lineWidth: b.thickness, lineColor: b.color, ...(b.dash ? { dash: { length: 4 } } : {}) }], margin: margin(b) }, b);
}

function columnsBlock(b: ColumnsBlock, c: BuildCtx, rowImages?: Record<string, string[]>) {
  const gap = pt(b.gap);
  const widths = b.cols.map((col) => (c.contentWidth * col.widthPct) / 100 - gap * (b.cols.length - 1) / b.cols.length);
  return {
    columns: b.cols.map((col, i) => ({ width: widths[i], stack: col.blocks.map((x) => (x.type === 'text' ? textBlock(x, c) : imageBlock(x, c, x.columnId ? rowImages?.[x.columnId] : undefined))).filter(Boolean) })),
    columnGap: gap, margin: margin(b),
  };
}

const NUMERIC = new Set(['int', 'float']);
const cellAlign = (col: Column, ref: { align?: string }) => ref.align ?? (NUMERIC.has(col.dataType) ? 'right' : col.dataType === 'boolean' ? 'center' : 'left');
const imageUrls = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function aggregate(rows: Row[], col: Column, agg: string): string {
  const nums = rows.map((r) => r.values[col.id]).filter((v): v is number => typeof v === 'number');
  if (agg === 'count') return String(rows.filter((r) => { const v = r.values[col.id]; return v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length); }).length);
  if (!nums.length) return '';
  const v = agg === 'sum' ? nums.reduce((a, b) => a + b, 0) : agg === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : agg === 'min' ? Math.min(...nums) : Math.max(...nums);
  return displayValue({ ...col, dataType: 'float', validation: { ...col.validation, decimals: agg === 'avg' ? 2 : col.validation?.decimals ?? (col.dataType === 'float' ? 2 : 0) } } as Column, v);
}

function tableBlock(b: TableBlock, c: BuildCtx) {
  const sd = c.tables.get(b.id);
  if (!sd) return { text: 'ยังไม่ได้เลือกชีตของตาราง', italics: true, color: '#9CA3AF', margin: margin(b) };
  const cols = resolveColumns(b.columns, sd.columns);
  const out: any[] = [];
  if (b.caption) out.push({ ...textNode(fillTokens(b.caption, c.vars), { bold: true, fontSize: b.header.fontSize + 1 }, c.base), margin: [0, 0, 0, pt(1.5)] });
  if (!cols.length) return { stack: [...out, { text: 'ยังไม่ได้เลือกคอลัมน์ของตาราง', italics: true, color: '#9CA3AF' }], margin: margin(b) };

  const header = [
    ...(b.showRowNumber ? [{ text: b.rowNumberHeader || '#', bold: b.header.bold, color: b.header.color, fontSize: b.header.fontSize, alignment: 'center' }] : []),
    ...cols.map(({ ref, col }) => ({ text: ref.header || col.name, bold: b.header.bold, color: b.header.color, fontSize: b.header.fontSize, alignment: (ref.align ?? b.header.align) as any })),
  ];
  const widths: any[] = [...(b.showRowNumber ? [pt(9)] : []), ...cols.map(({ ref, col }) => (ref.widthMm ? Math.max(8, pt(ref.widthMm) - 2 * pt(b.padding * 0.7)) /* a column's width includes its own padding */ : col.dataType === 'image' ? pt(b.imageSizeMm * Math.min(b.maxImagesPerCell, 2) + 4) : '*'))];
  const body = (rows: Row[], startNo: number) => rows.map((r, i) => [
    ...(b.showRowNumber ? [{ text: String(startNo + i + 1), alignment: 'center', fontSize: b.body.fontSize, color: '#6B7280' }] : []),
    ...cols.map(({ ref, col }) => {
      const v = r.values[col.id] ?? null;
      if (col.dataType === 'image') {
        const nodes = imageUrls(v).slice(0, b.maxImagesPerCell).map((u) => imageNode(u, b.imageSizeMm, null, c)).filter(Boolean);
        const more = imageUrls(v).length - nodes.length;
        return nodes.length ? { stack: [...nodes.map((n: any) => ({ ...n, margin: [0, 0, 0, 2] })), ...(more > 0 ? [{ text: `+${more}`, fontSize: 8, color: '#6B7280' }] : [])] } : { text: '' };
      }
      const alert = col.validation?.alert ? alertColor(col.validation.alert, r.values, c.now.getTime()) : null; // colour alerts, as of the time of printing
      return { text: displayValue(col, v), alignment: cellAlign(col, ref), fontSize: b.body.fontSize, color: b.body.color, lineHeight: b.body.lineHeight, ...(alert ? { fillColor: alert.color } : {}) };
    }),
  ]);
  const summaryRow = () => {
    if (!b.summary.length) return null;
    const cells: any[] = [...(b.showRowNumber ? [{ text: '' }] : []), ...cols.map(({ col }, i) => {
      const s = b.summary.find((x) => x.columnId === col.id || (resolveColumns([{ columnId: x.columnId, columnName: '' }], sd.columns)[0]?.col.id === col.id));
      if (s) return { text: `${s.label ?? ''}${s.label ? ' ' : ''}${aggregate(sd.rows, col, s.agg)}`, bold: true, alignment: 'right', fontSize: b.body.fontSize };
      return i === 0 ? { text: b.summaryLabel, bold: true, fontSize: b.body.fontSize } : { text: '' };
    })];
    return cells;
  };

  const rpp = b.rowsPerPage && b.rowsPerPage > 0 ? b.rowsPerPage : null;
  const chunks: Row[][] = [];
  if (rpp) for (let i = 0; i < sd.rows.length; i += rpp) chunks.push(sd.rows.slice(i, i + rpp)); else chunks.push(sd.rows);
  if (!chunks.length) chunks.push([]);

  const avail = c.contentWidth;
  const w = (avail * b.widthPct) / 100;
  const ml = b.align === 'center' ? (avail - w) / 2 : b.align === 'right' ? avail - w : 0;
  const layout = (hasSummary: boolean, nRows: number) => ({
    hLineWidth: () => b.border.width, vLineWidth: () => b.border.width, hLineColor: () => b.border.color, vLineColor: () => b.border.color,
    paddingLeft: () => pt(b.padding * 0.7), paddingRight: () => pt(b.padding * 0.7), paddingTop: () => pt(b.padding * 0.55), paddingBottom: () => pt(b.padding * 0.55),
    fillColor: (i: number) => (i === 0 ? b.header.bg : hasSummary && i === nRows - 1 ? '#EEF2FF' : b.body.zebra && i % 2 === 0 ? b.body.zebra : null),
  });

  chunks.forEach((rows, ci) => {
    const last = ci === chunks.length - 1;
    const sum = last ? summaryRow() : null;
    const bodyRows = body(rows, ci * (rpp ?? 0));
    const all = [header, ...(bodyRows.length ? bodyRows : [[{ text: 'ไม่มีข้อมูล', colSpan: header.length, alignment: 'center', color: '#9CA3AF', fontSize: b.body.fontSize }, ...Array(header.length - 1).fill({})]]), ...(sum ? [sum] : [])];
    const node: any = {
      table: { headerRows: b.repeatHeader ? 1 : 0, widths: widths.map((x) => x), body: all, dontBreakRows: true },
      layout: layout(!!sum, all.length), margin: [ml, 0, avail - w - ml, last ? pt(b.marginBottom) : 0],
    };
    if (ci > 0) node.pageBreak = 'before';
    out.push(node);
  });
  const stack: any = { stack: out };
  if (b.marginTop) stack.margin = [0, pt(b.marginTop), 0, 0];
  return stack;
}

function fieldsBlock(b: FieldsBlock, c: BuildCtx, row: Row, sd: SheetData) {
  const cols = resolveColumns(b.columns, sd.columns);
  const n = b.perRow;
  const cell = ({ ref, col }: (typeof cols)[number]) => {
    const v = row.values[col.id] ?? null;
    const label = { ...textNode(ref.header || col.name, b.label, c.base), margin: [0, 0, 0, 1] };
    let value: any;
    if (col.dataType === 'image') {
      const nodes = imageUrls(v).map((u) => imageNode(u, b.imageSizeMm, null, c)).filter(Boolean) as any[];
      value = nodes.length ? { columns: nodes.map((x) => ({ ...x, width: 'auto' })), columnGap: 4 } : { text: '—', color: '#9CA3AF' };
    } else value = textNode(displayValue(col, v) || '—', b.value, c.base);
    return { stack: [label, value] };
  };
  const rows: any[][] = [];
  for (let i = 0; i < cols.length; i += n) {
    const slice = cols.slice(i, i + n).map(cell);
    while (slice.length < n) slice.push({ stack: [] });
    rows.push(slice);
  }
  const bd = b.border;
  return {
    table: { widths: Array(n).fill('*'), body: rows, dontBreakRows: true }, margin: margin(b),
    layout: bd ? { hLineWidth: () => bd.width, vLineWidth: () => bd.width, hLineColor: () => bd.color, vLineColor: () => bd.color, paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4 } : { hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
  };
}

type Simple = Block;
function blockToNode(b: Simple, c: BuildCtx, row?: Row, sd?: SheetData): any | null {
  let node: any = null;
  const rowImg = (columnId?: string | null, name?: string | null) => {
    if (!row || !sd) return undefined;
    const col = sd.columns.find((x) => x.id === columnId) ?? sd.columns.find((x) => x.name.trim().toLowerCase() === (name ?? '').trim().toLowerCase());
    return col ? imageUrls(row.values[col.id]) : undefined;
  };
  switch (b.type) {
    case 'text': node = textBlock(b, c); break;
    case 'image': node = imageBlock(b, c, b.source === 'column' ? rowImg(b.columnId, b.columnName) : undefined); break;
    case 'line': node = lineBlock(b, c); break;
    case 'spacer': node = { text: ' ', fontSize: 1, margin: [0, 0, 0, pt(b.height)] }; break;
    case 'pageBreak': return { text: '', pageBreak: 'after' };
    case 'columns': {
      const imgs: Record<string, string[]> = {};
      for (const col of b.cols) for (const x of col.blocks) if (x.type === 'image' && x.source === 'column') { const u = rowImg(x.columnId, x.columnName); if (u && x.columnId) imgs[x.columnId] = u; }
      node = columnsBlock(b, c, imgs); break;
    }
    case 'table': node = tableBlock(b, c); break;
    case 'fields': node = row && sd ? fieldsBlock(b, c, row, sd) : { text: '(ฟิลด์ข้อมูลของแถว — ใช้ได้ในโหมด “แบบฟอร์มต่อแถว”)', italics: true, color: '#9CA3AF' }; break;
    default: { const m = getBlockModule((b as { type: string }).type); node = m ? m.build(b, c) : null; }
  }
  if (node && b.pageBreakBefore) node.pageBreak = 'before';
  if (node && b.pageBreakAfter) { node = { stack: [node], pageBreak: 'after' }; }
  return node;
}

/** All image URLs a template needs (static + image columns of the rows that will be printed) */
function imageUrlsNeeded(t: PdfTemplate, tables: Map<string, SheetData>): string[] {
  const urls: string[] = [];
  const addStatic = (bs: Block[]) => bs.forEach((b) => { if (b.type === 'image' && b.source === 'static') urls.push(b.url); if (b.type === 'columns') b.cols.forEach((c) => addStatic(c.blocks)); });
  addStatic(t.blocks); addStatic(t.header.blocks); addStatic(t.footer.blocks);
  for (const b of t.blocks) {
    if (b.type === 'table') { const sd = tables.get(b.id); if (sd) for (const { col } of resolveColumns(b.columns, sd.columns)) if (col.dataType === 'image') sd.rows.forEach((r) => urls.push(...imageUrls(r.values[col.id]).slice(0, b.maxImagesPerCell))); }
  }
  if (t.mode === 'perRow' && t.perRow) {
    const sd = tables.get(t.perRow.sheetId);
    if (sd) sd.rows.forEach((r) => sd.columns.filter((c) => c.dataType === 'image').forEach((c) => urls.push(...imageUrls(r.values[c.id]))));
  }
  if (t.watermark.enabled && t.watermark.imageUrl) urls.push(t.watermark.imageUrl);
  return urls;
}

/** Answers collected in the export dialog */
export interface ExportValues { prompts?: Record<string, string>; signers?: Record<string, string> }
export interface PdfRunOptions { fileName: string; user: string; current: CurrentView | null; previewLimit?: number; onProgress?: (m: string) => void; values?: ExportValues }

export async function buildDocDefinition(template: PdfTemplate, o: PdfRunOptions) {
  const t = bindToCurrent(template, o.current);
  const tables = await collectData(t, o.current, { limit: o.previewLimit, onProgress: o.onProgress });
  o.onProgress?.('กำลังโหลดรูปภาพ…');
  const images = await preloadImages(imageUrlsNeeded(t, tables));
  return assembleDoc(t, o, tables, images);
}

/** The pure part: template + loaded data → pdfmake document (no network; used by the layout tests too) */
export function assembleDoc(t: PdfTemplate, o: PdfRunOptions, tables: Map<string, SheetData>, images: Map<string, string>) {
  const now = new Date();
  const [pw, ph] = PAGE_PT[t.page.size] ?? PAGE_PT.A4;
  const width = t.page.orientation === 'landscape' ? ph : pw;
  const m = t.page.margins;
  const contentWidth = width - pt(m.left) - pt(m.right);
  const firstTable = t.blocks.find((b): b is TableBlock => b.type === 'table');
  const sheetName = (t.mode === 'perRow' ? t.perRow?.sheetName : firstTable?.sheetName) ?? '';
  const rowCount = t.mode === 'perRow' ? tables.get(t.perRow?.sheetId ?? '')?.rows.length ?? 0 : (firstTable ? tables.get(firstTable.id)?.total ?? 0 : 0);
  const vars: Vars = resolveVariables({ now, fileName: o.fileName, sheetName, user: o.user, rowCount, prompts: o.values?.prompts ?? {}, settings: t.settings });
  const ctx: BuildCtx = { fileName: o.fileName, user: o.user, now, tables, images, base: t.base, contentWidth, vars, signers: o.values?.signers ?? {} };

  const content: any[] = [];
  if (t.mode === 'perRow' && t.perRow) {
    const sd = tables.get(t.perRow.sheetId);
    const rowVarsOf = (row: Row): Vars => {
      const rv: Vars = { '#': String(row.order) };
      for (const col of sd!.columns) rv[col.name] = col.dataType === 'image' ? '' : displayValue(col, row.values[col.id] ?? null);
      return rv;
    };
    const dash = () => ({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: contentWidth, y2: 0, lineWidth: 0.6, dash: { length: 4 }, lineColor: '#9CA3AF' }], margin: [0, 2, 0, 3] });
    if (!sd || !sd.rows.length) content.push({ text: 'ไม่มีแถวที่จะพิมพ์', italics: true, color: '#9CA3AF' });
    else {
      // rows with the same "group by" value are printed together (customer by customer); no group column = one group
      const gcol = t.perRow.groupBy ? sd.columns.find((c) => c.name.trim().toLowerCase() === t.perRow!.groupBy!.trim().toLowerCase()) : undefined;
      const groups: { key: string; rows: Row[] }[] = [];
      if (gcol) {
        const idx = new Map<string, { key: string; rows: Row[] }>();
        for (const row of sd.rows) {
          const key = displayValue(gcol, row.values[gcol.id] ?? null) || '(ไม่ระบุ)';
          let g = idx.get(key);
          if (!g) { g = { key, rows: [] }; idx.set(key, g); groups.push(g); }
          g.rows.push(row);
        }
      } else groups.push({ key: '', rows: sd.rows });
      const per = Math.max(1, Math.floor(t.perRow.rowsPerPage ?? 1));
      const labels = t.copies?.labels?.length ? t.copies.labels : [''];
      const sep = t.copies?.separator ?? 'line';
      groups.forEach((g, gi) => {
        const gv: Vars = { ...rowVarsOf(g.rows[0]), group: g.key };
        const once = (when: 'start' | 'end') => t.blocks.filter((b) => b.groupOnce === when).map((b) => blockToNode(b, { ...ctx, rowVars: gv }, g.rows[0], sd)).filter(Boolean);
        const head = once('start');
        if (head.length && gi > 0) head[0].pageBreak = 'before';
        content.push(...head);
        let firstOfGroup = gi > 0 && !head.length;
        g.rows.forEach((row, ri) => {
          const rv: Vars = { ...rowVarsOf(row), group: g.key };
          labels.forEach((label, ci) => {
            const cv: Vars = t.copies?.labels?.length ? { ...rv, copy: String(ci + 1), copyLabel: label } : rv;
            const nodes = t.blocks.filter((b) => !b.groupOnce).map((b) => blockToNode(b, { ...ctx, rowVars: cv }, row, sd)).filter(Boolean);
            if (!nodes.length) return;
            if (ci === 0 && firstOfGroup) nodes[0].pageBreak = 'before';
            else if (ci === 0 && ri > 0 && ri % per === 0) nodes[0].pageBreak = 'before';
            else if (ci === 0 && ri > 0) content.push(dash());
            else if (ci > 0 && sep === 'pageBreak') nodes[0].pageBreak = 'before';
            else if (ci > 0 && sep === 'line') content.push(dash());
            firstOfGroup = false;
            content.push(...nodes);
          });
        });
        // blocks marked "once per group" close it (e.g. the signatures of this customer)
        content.push(...once('end'));
      });
    }
  } else content.push(...t.blocks.map((b) => blockToNode(b, ctx)).filter(Boolean));
  if (!content.length) content.push({ text: 'เอกสารว่าง — เพิ่มบล็อกในหน้าออกแบบ', italics: true, color: '#9CA3AF' });

  const side = (blocks: PdfTemplate['header']['blocks'], top: boolean) => (page: number, pages: number) => {
    const v = { ...vars, page: String(page), pages: String(pages) };
    const c2 = { ...ctx, vars: v };
    return { margin: [pt(m.left), top ? pt(Math.max(4, m.top / 3)) : pt(4), pt(m.right), 0], stack: blocks.map((b) => blockToNode(b, c2)).filter(Boolean) };
  };
  const fonts = new Set<PdfFont>([t.base.font]);
  JSON.stringify(t, (k, v) => { if (k === 'font' && PDF_FONTS.includes(v)) fonts.add(v); return v; });

  const doc: any = {
    pageSize: t.page.size, pageOrientation: t.page.orientation, pageMargins: [pt(m.left), pt(m.top), pt(m.right), pt(m.bottom)],
    defaultStyle: { font: t.base.font, fontSize: t.base.fontSize, color: t.base.color, lineHeight: 1.15 },
    info: { title: `${o.fileName}${sheetName ? ` - ${sheetName}` : ''}`, creator: 'DataSheet Pro', author: o.user },
    content,
  };
  if (t.header.enabled && t.header.blocks.length) doc.header = side(t.header.blocks, true);
  if (t.footer.enabled && t.footer.blocks.length) doc.footer = side(t.footer.blocks, false);
  const wmImg = t.watermark.enabled && t.watermark.imageUrl ? images.get(t.watermark.imageUrl) : undefined;
  if (wmImg) {
    const wmW = pt(t.watermark.imageWidthMm ?? 120);
    const pageH = t.page.orientation === 'landscape' ? pw : ph;
    doc.background = () => ({ image: wmImg, width: wmW, opacity: t.watermark.opacity, absolutePosition: { x: Math.max(0, (width - wmW) / 2), y: pageH / 3 } });
  } else if (t.watermark.enabled && t.watermark.text) doc.watermark = { text: t.watermark.text, color: t.watermark.color, opacity: t.watermark.opacity, bold: true, fontSize: t.watermark.size, angle: t.watermark.angle };
  if (t.lockEditing) { doc.ownerPassword = crypto.randomUUID?.() ?? String(Math.random()); doc.permissions = { printing: 'highResolution', modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false }; }
  return { doc, fonts: [...fonts], truncated: [...tables.values()].some((x) => x.truncated) };
}

export async function generatePdf(t: PdfTemplate, o: PdfRunOptions): Promise<{ blob: Blob; truncated: boolean }> {
  const { doc, fonts, truncated } = await buildDocDefinition(t, o);
  const pm = await loadPdfMake(fonts);
  const blob: Blob = await pm.createPdf(doc).getBlob();
  return { blob, truncated };
}
