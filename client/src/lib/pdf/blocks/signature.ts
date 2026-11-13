import { fillTokens } from '../variables';
import type { BuildCtx } from '../build';
import { MM } from '../types';
import type { BlockBase, PdfTemplate, TextStyle } from '../types';

/** Signature / approval boxes: "ผู้บันทึก", "ผู้ตรวจสอบ", "QC Manager" … */
export interface SignatureSlot {
  id: string;
  label: string;
  sublabel?: string;
  /** name printed above the line when the dialog is left empty (text, {{tokens}} allowed) */
  defaultName?: string;
  /** ask for the name in the export dialog */
  askAtExport: boolean;
  showDate: boolean;
}
export interface SignatureBlock extends BlockBase {
  type: 'signature';
  slots: SignatureSlot[];
  perRow: number;
  boxHeightMm: number;
  /** space below each row of boxes (mm, default 5) */
  rowGapMm?: number;
  gapMm: number;
  lineColor: string;
  lineWidth: number;
  labelStyle: TextStyle;
  nameStyle: TextStyle;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 's' + Math.random().toString(36).slice(2));
export const newSignatureSlot = (label = 'ผู้บันทึก'): SignatureSlot => ({ id: uid(), label, askAtExport: true, showDate: true });

export const newSignature = (): SignatureBlock => ({
  id: uid(), type: 'signature', perRow: 3, boxHeightMm: 14, gapMm: 8, lineColor: '#111827', lineWidth: 0.6, marginTop: 6, marginBottom: 3,
  slots: [newSignatureSlot('ผู้บันทึก'), newSignatureSlot('ผู้ตรวจสอบ'), newSignatureSlot('QC Manager')],
  labelStyle: { fontSize: 9, align: 'center' }, nameStyle: { fontSize: 10, align: 'center' },
});

/** Every signature slot of a template (to ask for the names in the export dialog) */
export function signatureSlotsOf(t: Pick<PdfTemplate, 'blocks'>): SignatureSlot[] {
  return (t.blocks as { type: string; slots?: SignatureSlot[] }[]).filter((b) => b.type === 'signature').flatMap((b) => b.slots ?? []).filter((s) => s.askAtExport);
}

const pt = (mm: number) => mm * MM;

export function buildSignature(b: SignatureBlock, c: BuildCtx) {
  const n = Math.max(1, Math.min(6, b.perRow || 3));
  const lineColor = b.lineColor || '#111827';
  const rows: any[] = [];
  for (let i = 0; i < b.slots.length; i += n) {
    const slice = b.slots.slice(i, i + n);
    const cells = (render: (s: SignatureSlot | null) => any) => {
      const out: any[] = [];
      for (let k = 0; k < n; k++) {
        if (k > 0) out.push({ text: '', border: [false, false, false, false] });
        out.push(render(slice[k] ?? null));
      }
      return out;
    };
    const style = (s: TextStyle) => ({ font: s.font ?? c.base.font, fontSize: s.fontSize ?? c.base.fontSize, color: s.color ?? c.base.color, bold: !!s.bold, italics: !!s.italic, alignment: s.align ?? 'center' });
    const body = [
      // 1) space for the signature + the typed name, closed by the signature line
      cells((s) => (s
        ? { stack: [{ text: ' ', fontSize: 1, margin: [0, pt(Math.max(2, b.boxHeightMm - 5)), 0, 0] }, { text: fillTokens(c.signers[s.id] || s.defaultName || '', c.vars, c.rowVars) || ' ', ...style(b.nameStyle), margin: [0, 0, 0, 1] }], border: [false, false, false, true] }
        : { text: '', border: [false, false, false, false] })),
      // 2) role label
      cells((s) => (s ? { stack: [{ text: s.label, ...style(b.labelStyle), bold: true }, ...(s.sublabel ? [{ text: s.sublabel, ...style(b.labelStyle), color: '#6B7280' }] : [])], border: [false, false, false, false], margin: [0, 2, 0, 0] } : { text: '', border: [false, false, false, false] })),
      // 3) date line
      ...(slice.some((s) => s.showDate) ? [cells((s) => (s?.showDate ? { text: 'วันที่  ____ / ____ / ________', ...style({ ...b.labelStyle, fontSize: (b.labelStyle.fontSize ?? 9) - 1, color: '#6B7280' }), border: [false, false, false, false], margin: [0, 3, 0, 0] } : { text: '', border: [false, false, false, false] }))] : []),
    ];
    const widths = Array.from({ length: n * 2 - 1 }, (_v, k) => (k % 2 === 0 ? '*' : pt(b.gapMm)));
    rows.push({
      unbreakable: true,
      table: { widths, body },
      // each cell says which of its borders are drawn (see `border` above); the layout gives them their width and colour
      layout: { hLineWidth: () => b.lineWidth, vLineWidth: () => b.lineWidth, hLineColor: () => lineColor, vLineColor: () => lineColor, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
      margin: [0, 0, 0, pt(b.rowGapMm ?? 5)],
    });
  }
  return { stack: rows, margin: [pt(b.marginLeft ?? 0), pt(b.marginTop ?? 0), pt(b.marginRight ?? 0), pt(b.marginBottom ?? 0)] };
}

