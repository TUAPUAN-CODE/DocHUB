/** Pure parsing of scanned text (QR / barcode / RFID text) by a user-defined format. No database, no framework. */
export interface ScanField { index: number; columnId: string }
export interface ScanMatch { prefix?: string | null; regex?: string | null; fieldCount?: number | null }
/** Check the scanned value against a list in another sheet (e.g. EPC → trolley register) and copy columns from the row found */
export interface ScanVerify {
  sheetId: string;
  /** column of the other sheet that must equal the scanned value */
  refKeyColumnId: string;
  /** column of THIS sheet whose scanned value is looked up (default: the profile's key column) */
  checkColumnId?: string | null;
  /** other sheet's column → this sheet's column */
  fill?: { fromColumnId: string; toColumnId: string }[] | null;
  /** not found: refuse (nothing is written) / write anyway */
  onMiss: 'reject' | 'allow';
}

/**
 * Fill columns from another SYSTEM by a number in the scanned text: DelayHUB's slip QR ("14L… | MAT | MAT | 826982 | 180 | kg | PFCM") carries the
 * mapping_id (piece 4); DelayHUB answers (GET /api/export/mapping/:id) with its code / mat / mat 2X / batch / batch 2X. Needs DELAYHUB_URL + DELAYHUB_EXPORT_KEY.
 */
export const EXTERNAL_FIELDS = ['code', 'mat', 'mat_name', 'mat_2x', 'batch', 'batch_2x'] as const;
export interface ScanExternal {
  source: 'delayhub_mapping';
  /** piece number (1 = first) that holds the mapping_id */
  pieceIndex: number;
  fill: { field: (typeof EXTERNAL_FIELDS)[number]; toColumnId: string }[];
  /** the number is not known to the other system / it cannot be reached: refuse / keep what the QR carried */
  onMiss: 'reject' | 'allow';
}

export interface ScanProfile {
  id: string; name: string;
  /** separator between the pieces, e.g. "|" — "\t" means a tab; empty = the whole text is one piece */
  delimiter: string;
  match?: ScanMatch | null;
  /** piece number (1 = first) → column */
  fields: ScanField[];
  action: 'create' | 'update';
  /** update: the column used to find the existing row; its piece must be in `fields` */
  keyColumnId?: string | null;
  /** update, row not found: make a new row or refuse */
  onMiss?: 'create' | 'reject' | null;
  /**
   * Time stamps, in order (e.g. [เข้าห้องเย็น, ออกห้องเย็น]): each scan writes the current time in the FIRST column still empty —
   * first scan = in, second scan of the same card = out. The newest row of the key is used.
   */
  stamps?: string[] | null;
  verify?: ScanVerify | null;
  external?: ScanExternal | null;
  /** every stamp column is already filled: do nothing / refuse / start a new row (a new round of the same card) */
  onFull?: 'ignore' | 'reject' | 'new_row' | null;
}

/** index of the first empty stamp column, or -1 when all are filled */
export const firstEmptyStamp = (filled: boolean[]): number => filled.findIndex((f) => !f);

export const splitScan = (text: string, delimiter: string): string[] => {
  const d = delimiter === '\\t' ? '\t' : delimiter;
  const t = text.replace(/[\r\n]+$/g, '');
  return (d ? t.split(d) : [t]).map((s) => s.trim());
};

/** How well a profile fits the text: -1 = does not fit; otherwise the number of criteria it satisfied (0 = no criteria, last resort) */
export function matchScore(text: string, p: ScanProfile): number {
  const m = p.match ?? {};
  const parts = splitScan(text, p.delimiter);
  let score = 0;
  if (m.prefix) { if (!text.trim().toLowerCase().startsWith(m.prefix.toLowerCase())) return -1; score++; }
  if (m.fieldCount) { if (parts.length !== m.fieldCount) return -1; score++; }
  if (m.regex) {
    try { if (m.regex.length > 300 || !new RegExp(m.regex, 'i').test(text)) return -1; } catch { return -1; }
    score++;
  }
  const need = Math.max(0, ...p.fields.map((f) => f.index));
  if (parts.length < need) return -1; // a piece the profile needs is missing
  return score;
}

export function detectProfile(text: string, profiles: ScanProfile[]): ScanProfile | null {
  let best: ScanProfile | null = null;
  let bestScore = -1;
  for (const p of profiles) {
    const s = matchScore(text, p);
    if (s > bestScore) { best = p; bestScore = s; }
  }
  return best;
}

/** column id → text of the piece (empty pieces are skipped) */
export function parseScan(text: string, p: ScanProfile): { pieces: string[]; values: Record<string, string> } {
  const pieces = splitScan(text, p.delimiter);
  const values: Record<string, string> = {};
  for (const f of p.fields) {
    const v = pieces[f.index - 1];
    if (v !== undefined && v !== '') values[f.columnId] = v;
  }
  return { pieces, values };
}

/** Values copied from the row found in the other sheet; what the scan itself carried wins when it is not empty */
export function mergeFill<T>(scanned: Record<string, T>, fill: { fromColumnId: string; toColumnId: string }[], ref: Record<string, T | null | undefined>): Record<string, T> {
  const out = { ...scanned };
  for (const f of fill) {
    const v = ref[f.fromColumnId];
    const have = out[f.toColumnId];
    if (v !== null && v !== undefined && (have === undefined || have === null || (have as unknown) === '')) out[f.toColumnId] = v;
  }
  return out;
}
