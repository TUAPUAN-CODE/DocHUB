import { PDF_FONTS, PdfFont } from './types';

const FILES: Record<PdfFont, { normal: string; bold: string; italics?: string; bolditalics?: string }> = {
  Sarabun: { normal: 'Sarabun-Regular.ttf', bold: 'Sarabun-Bold.ttf', italics: 'Sarabun-Italic.ttf', bolditalics: 'Sarabun-BoldItalic.ttf' },
  Prompt: { normal: 'Prompt-Regular.ttf', bold: 'Prompt-Bold.ttf' },
  Kanit: { normal: 'Kanit-Regular.ttf', bold: 'Kanit-Bold.ttf' },
};

const cache = new Map<string, Promise<string>>();
async function b64(file: string): Promise<string> {
  if (!cache.has(file)) {
    cache.set(file, fetch(`/fonts/${file}`).then(async (r) => {
      if (!r.ok) throw new Error(`โหลดฟอนต์ ${file} ไม่สำเร็จ`);
      const buf = new Uint8Array(await r.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }).catch((e) => { cache.delete(file); throw e; }));
  }
  return cache.get(file)!;
}

/** ✓ ✗ ☐ ★ … are not in the Thai fonts (they print as empty boxes): those characters are written with a small
 *  subset of DejaVu Sans (public/fonts/DejaVuSans-Symbols.ttf, ~7 KB; regenerate with pyftsubset for more characters). */
export const SYMBOL_FONT = 'Symbols';
const SYMBOL_FILE = 'DejaVuSans-Symbols.ttf';
const SYMBOLS = /([\u2194-\u2199\u25A1-\u25B1\u25B4\u25B5\u25B8-\u25BB\u25BE\u25BF\u25C2-\u25C5\u25C7-\u25CF\u2605\u2606\u2610-\u2612\u26A0\u2713-\u2718]+)/;

function splitText(text: string): any {
  if (!SYMBOLS.test(text)) return text;
  return text.split(SYMBOLS).filter((x) => x !== '').map((x) => (SYMBOLS.test(x) ? { text: x, font: SYMBOL_FONT } : x));
}
/** Rewrites every text node of a pdfmake document so symbol characters use the symbol font (header/footer functions too) */
export function withSymbols<T>(node: T): T {
  const walk = (n: any): any => {
    if (Array.isArray(n)) return n.map(walk);
    if (typeof n === 'function') return (...a: any[]) => walk(n(...a));
    if (!n || typeof n !== 'object') return n;
    const out: any = { ...n };
    if (typeof out.text === 'string') out.text = splitText(out.text);
    else if (Array.isArray(out.text)) out.text = out.text.flatMap((x: any) => (typeof x === 'string' ? splitText(x) : walk(x)));
    for (const k of ['stack', 'columns', 'ul', 'ol', 'content', 'header', 'footer']) if (out[k] !== undefined) out[k] = walk(out[k]);
    if (out.table?.body) out.table = { ...out.table, body: walk(out.table.body) };
    return out;
  };
  return walk(node);
}

/** Loads pdfmake once and registers the Thai fonts that the template uses */
let lib: Promise<any> | null = null;
export async function loadPdfMake(fonts: PdfFont[]) {
  if (!lib) {
    lib = import('pdfmake/build/pdfmake').then((m: any) => {
      const pm = m.default ?? m;
      try { pm.setUrlAccessPolicy?.(() => false); pm.setLocalAccessPolicy?.(() => false); } catch { /* older builds */ }
      return pm;
    });
  }
  const pm = await lib;
  const vfs: Record<string, string> = {};
  const defs: Record<string, Record<string, string>> = {};
  for (const f of new Set<PdfFont>([...fonts, 'Sarabun'])) {
    const spec = FILES[PDF_FONTS.includes(f) ? f : 'Sarabun'];
    const entry: Record<string, string> = {};
    for (const [style, file] of Object.entries(spec)) { if (file) { vfs[file] = await b64(file); entry[style] = file; } }
    // fonts without italic files fall back to the upright face
    entry.italics ??= spec.normal; entry.bolditalics ??= spec.bold;
    defs[f] = entry;
  }
  vfs[SYMBOL_FILE] = await b64(SYMBOL_FILE);
  defs[SYMBOL_FONT] = { normal: SYMBOL_FILE, bold: SYMBOL_FILE, italics: SYMBOL_FILE, bolditalics: SYMBOL_FILE };
  pm.addVirtualFileSystem(vfs);
  pm.addFonts(defs);
  return pm;
}
