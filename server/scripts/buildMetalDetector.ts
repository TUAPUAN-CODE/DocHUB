/**
 * Builds the Metal Detector files through the API (on a TEST database), to be exported as a start-up seed with
 * scripts/exportSeedSql.ts afterwards:
 *   1. tag MD (users who may sign the form)
 *   2. "Program และค่า Sensitivity ของเครื่อง Metal Detector": one sheet per plant (Petfood / Petfood 2) + a union sheet that
 *      the form's drop-downs read; a formula column makes the label "001 Chunk (Fe 5.2 / SUS 5.6)"
 *   3. "DAILY METAL DETECTOR SENSITIVITY TEST REPORT (F3QCPF06)": sheet หัวเอกสาร (one row = one sheet of paper) whose rows have
 *      line items in sheet รายการตรวจ (entered with a form, the header's date / shift / machine filled in)
 *
 *   set DOCHUB_URL=http://localhost:4000/api  DOCHUB_USER=admin  DOCHUB_PASSWORD=…
 *   npx ts-node --transpile-only scripts/buildMetalDetector.ts --programs programs.json --folder <folder id>
 *
 * programs.json: [{ plant: "Petfood" | "Petfood 2", machine, speedText, rangeText, no, name, definition, fe?, sus?, ml1?…ml4? }]
 * (made from the SQCIS001 PDFs; company data — not kept in the repository, the seed SQL is)
 */
import fs from 'fs';

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const API = (process.env.DOCHUB_URL ?? 'http://localhost:4000/api').replace(/\/+$/, '');
let token = '';
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) throw new Error(`${method} ${path}: ${j?.error?.message ?? r.status}`);
  return j.data as T;
}

const PLANTS = [
  { plant: 'Petfood', sheet: 'Program และค่า Sensitivity ของเครื่อง Metal Detector โรงผลิต Petfood', color: '#1552F0' },
  { plant: 'Petfood 2', sheet: 'Program และค่า Sensitivity ของเครื่อง Metal Detector โรงผลิต Petfood 2', color: '#0E9F6E' },
];
const num = (name: string, width = 80) => ({ name, dataType: 'float', width, validation: { decimals: 1, min: 0 } });
const PROGRAM_COLS = [
  { name: 'หมายเลขเครื่อง', dataType: 'varchar', isRequired: true, width: 120 },
  { name: 'Speed สายพาน', dataType: 'varchar', width: 120 },
  { name: 'ช่วงค่า Sensitivity', dataType: 'varchar', width: 130 },
  { name: 'Program No.', dataType: 'varchar', isRequired: true, width: 100 },
  { name: 'Program Name', dataType: 'varchar', width: 150 },
  { name: 'คำจำกัดความ', dataType: 'text', width: 380 },
  num('Fe'), num('SUS'), num('ML1'), num('ML2'), num('ML3'), num('ML4'),
];
const LABEL = 'โปรแกรม / Sensitivity';
const LABEL_FORMULA = '[Program No.] & " " & [Program Name] & IF(ISBLANK([ML1]), " (Fe " & FORMATNUM([Fe], 1) & " / SUS " & FORMATNUM([SUS], 1) & ")", '
  + '" (ML1 " & FORMATNUM([ML1], 1) & " / ML2 " & FORMATNUM([ML2], 1) & " / ML3 " & FORMATNUM([ML3], 1) & " / ML4 " & FORMATNUM([ML4], 1) & ")")';

const SYM_DESC = '✓ = ผลผ่าน · x = ผลไม่ผ่าน · - = ไม่พบปัญหา · ∙ = ไม่ตรงกับรอบการตรวจ';
const SYM = [
  { value: '✓', label: '✓', color: '#16A34A' }, { value: 'x', label: 'x', color: '#DC2626' },
  { value: '-', label: '-', color: '#64748B' }, { value: '∙', label: '∙', color: '#94A3B8' },
];
const sym = (name: string, def?: string) => ({ name, dataType: 'select', width: 90, options: SYM, description: SYM_DESC, ...(def ? { defaultValue: def } : {}) });
const SHIFT = [{ value: 'D/S', label: 'D/S (กะเช้า)', color: '#0EA5E9' }, { value: 'N/S', label: 'N/S (กะดึก)', color: '#6366F1' }];
const OKNG = [{ value: 'OK', label: 'OK', color: '#16A34A' }, { value: 'Not OK', label: 'Not OK', color: '#DC2626' }];
const FREQ = [
  ['F0', 'F0 Sensitivity test'], ['F1', 'F1 Memory test'], ['F2', 'F2 เริ่มงาน'], ['F3', 'F3 ทดสอบทุกชั่วโมง'],
  ['F4', 'F4 หยุดเครื่องชั่วคราว'], ['F5', 'F5 เปลี่ยนโปรแกรม'], ['F6', 'F6 เครื่องเสีย'], ['F7', 'F7 เลิกงาน'],
].map(([value, label], i) => ({ value, label, color: ['#1552F0', '#7C3AED', '#0E9F6E', '#0EA5E9', '#F59E0B', '#EC4899', '#DC2626', '#64748B'][i] }));
const users = (tag: string | null) => ({ users: { tag } });

async function main() {
  const file = arg('--programs');
  const folderId = arg('--folder');
  if (!file || !folderId) throw new Error('ระบุ --programs <json> และ --folder <folder id>');
  const programs: any[] = JSON.parse(fs.readFileSync(file, 'utf8'));
  token = (await call('POST', '/auth/login', { username: process.env.DOCHUB_USER ?? 'admin', password: process.env.DOCHUB_PASSWORD ?? '' })).accessToken;

  // 1) tag MD
  const tags = await call<any[]>('GET', '/tags');
  if (!tags.some((t) => t.name === 'MD')) await call('POST', '/tags', { name: 'MD', color: '#F59E0B', description: 'ผู้ตรวจ / พนักงานคุมเครื่อง Metal Detector (ชื่อขึ้นในช่อง Checked By และพนักงานคุมเครื่อง)' });

  // 2) program tables
  const progFile = await call('POST', '/files', {
    name: 'Program และค่า Sensitivity ของเครื่อง Metal Detector', folderId, color: '#F59E0B',
    description: 'จากเอกสาร SQCIS001 (ISPP01 โรงผลิต Petfood · ISPP010 โรงผลิต Petfood 2) — ใช้เป็นตัวเลือกช่อง โปรแกรม / Sensitivity ของใบตรวจ F3QCPF06',
    sheets: PLANTS.map((p) => ({ name: p.sheet, tabColor: p.color, columns: PROGRAM_COLS })),
  });
  const pf = await call('GET', `/files/${progFile.id}`);
  const sheetIds: string[] = [];
  for (const p of PLANTS) {
    const sh = pf.sheets.find((s: any) => s.name === p.sheet);
    sheetIds.push(sh.id);
    const det = await call('GET', `/sheets/${sh.id}`);
    const id = (n: string) => det.columns.find((c: any) => c.name === n).id;
    const rows = programs.filter((r) => r.plant === p.plant).map((r, i) => ({
      rowNo: i + 1,
      values: {
        [id('หมายเลขเครื่อง')]: r.machine, [id('Speed สายพาน')]: r.speedText, [id('ช่วงค่า Sensitivity')]: r.rangeText || null,
        [id('Program No.')]: r.no, [id('Program Name')]: r.name, [id('คำจำกัดความ')]: r.definition,
        [id('Fe')]: r.fe ?? null, [id('SUS')]: r.sus ?? null, [id('ML1')]: r.ml1 ?? null, [id('ML2')]: r.ml2 ?? null, [id('ML3')]: r.ml3 ?? null, [id('ML4')]: r.ml4 ?? null,
      },
    }));
    const res = await call('POST', `/sheets/${sh.id}/rows/import`, { rows });
    console.log(`✓ ${p.plant}: ${res.inserted ?? rows.length} แถว`);
    await call('POST', `/sheets/${sh.id}/columns`, { name: LABEL, dataType: 'varchar', width: 320, validation: { formula: { expr: LABEL_FORMULA } }, description: 'สร้างเองจาก Program No. / Name และค่า Fe / SUS (หรือ ML1-4)' });
  }
  const union = await call('POST', `/files/${progFile.id}/sheets/union`, { name: 'รวมทุกโรงผลิต (ใช้เป็นตัวเลือก)', sources: sheetIds });
  const ud = await call('GET', `/sheets/${union.id}`);
  const uid = (n: string) => ud.columns.find((c: any) => c.name === n).id;
  const machineLookup = { sheetId: union.id, columnId: uid('หมายเลขเครื่อง'), parent: null };
  console.log(`✓ ชีตรวม ${union.id}`);

  // 3) the form: header + lines
  const form = await call('POST', '/files', {
    name: 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT (F3QCPF06)', folderId, color: '#DC2626',
    description: 'ใบตรวจ F3QCPF06-4-22/07/25 · 1 แถวในชีต หัวเอกสาร = 1 ใบ · กดดูแถว → รายการในแถว เพื่อบันทึกการตรวจแต่ละครั้ง',
    sheets: [
      {
        name: 'หัวเอกสาร', tabColor: '#DC2626', columns: [
          { name: 'เลขที่ใบตรวจ', dataType: 'doc_number', width: 160, validation: { docNumber: { template: 'MD-{YYMMDD}-{SEQ:3}' } } },
          { name: 'วันที่ (Date)', dataType: 'date', isRequired: true, width: 130 },
          { name: 'กะ (Shift)', dataType: 'select', isRequired: true, width: 120, options: SHIFT },
          { name: 'หมายเลขเครื่อง', dataType: 'select', isRequired: true, width: 130, validation: { lookup: machineLookup } },
          { name: 'ฝาล็อคหน้าจอ', dataType: 'select', width: 120, options: [{ value: 'มีล็อค', label: 'มีล็อค', color: '#16A34A' }, { value: 'ไม่มีล็อค', label: 'ไม่มีล็อค', color: '#DC2626' }] },
          { name: 'Speed สายพาน (m/min)', dataType: 'float', width: 130, validation: { decimals: 1, min: 0 } },
          { name: 'Fe (mm)', dataType: 'float', width: 90, validation: { decimals: 1, min: 0 } },
          { name: 'Fe หมายเลข', dataType: 'varchar', width: 110 },
          { name: 'Non Fe (mm)', dataType: 'float', width: 100, validation: { decimals: 1, min: 0 } },
          { name: 'Non Fe หมายเลข', dataType: 'varchar', width: 120 },
          { name: 'SUS (mm)', dataType: 'float', width: 90, validation: { decimals: 1, min: 0 } },
          { name: 'SUS หมายเลข', dataType: 'varchar', width: 110 },
          { name: 'Belt stop', dataType: 'select', width: 100, options: OKNG },
          { name: 'Alarm', dataType: 'select', width: 100, options: OKNG },
          { name: 'Test pieces จำนวน (ชิ้น)', dataType: 'int', width: 140, validation: { min: 0 } },
          { name: 'Test pieces ครบ', dataType: 'boolean', width: 120 },
          { name: 'พนักงานคุมเครื่อง', dataType: 'select', width: 160, validation: { lookup: users('MD') } },
          { name: 'Checked By (QC staff)', dataType: 'select', width: 170, validation: { lookup: users('MD') } },
          { name: 'Reviewed By (QC Section Manager)', dataType: 'select', width: 200, validation: { lookup: users(null) } },
          { name: 'หมายเหตุ', dataType: 'text', width: 220 },
        ],
      },
      {
        name: 'รายการตรวจ', tabColor: '#F59E0B', columns: [
          { name: 'วันที่ (Date)', dataType: 'date', width: 120 },
          { name: 'กะ (Shift)', dataType: 'select', width: 110, options: SHIFT },
          { name: 'หมายเลขเครื่อง', dataType: 'select', isRequired: true, width: 120, validation: { lookup: machineLookup } },
          { name: 'เวลา', dataType: 'varchar', isRequired: true, width: 80, placeholder: '19.50', validation: { pattern: '^([01]?\\d|2[0-3])[.:][0-5]\\d$', patternMessage: 'พิมพ์เวลาแบบ 19.50' } },
          sym('Fe'), sym('Non Fe'), sym('SUS'), sym('Large test piece', '-'),
          { name: 'ความถี่ (F)', dataType: 'multi_select', isRequired: true, width: 170, options: FREQ,
            description: 'F0 SENSITIVITY TEST · F1 MEMORY TEST · F2 เริ่มงาน · F3 ทดสอบทุกชั่วโมง (CONSECUTIVE TEST) · F4 หยุดเครื่องชั่วคราว · F5 เปลี่ยนโปรแกรม · F6 เครื่องเสีย · F7 เลิกงาน' },
          { name: 'Code / วัตถุดิบ / Batch no.', dataType: 'varchar', width: 180 },
          sym('Result (Detect / Not detect)', '-'), sym('รอบ A ครั้งที่ 1', '-'), sym('รอบ A ครั้งที่ 2', '-'), sym('Object', '-'),
          sym('รอบ B ครั้งที่ 1', '-'), sym('รอบ B ครั้งที่ 2', '-'), sym('รอบ B ครั้งที่ 3', '-'),
          { name: 'สรุปผล', dataType: 'select', width: 90, defaultValue: '-', options: [{ value: 'OK', label: 'OK', color: '#16A34A' }, { value: 'NK', label: 'NK (Not OK)', color: '#DC2626' }, { value: '-', label: '-', color: '#64748B' }] },
          { name: 'Cause / Corrective action', dataType: 'text', width: 200 },
          { name: 'MD Detect (NG)', dataType: 'varchar', width: 120 },
          { name: 'Checked By', dataType: 'select', width: 150, validation: { lookup: users('MD') } },
        ],
      },
    ],
  });
  const ff = await call('GET', `/files/${form.id}`);
  const header = ff.sheets.find((s: any) => s.name === 'หัวเอกสาร');
  const lines = ff.sheets.find((s: any) => s.name === 'รายการตรวจ');
  const ld = await call('GET', `/sheets/${lines.id}`);
  const lid = (n: string) => ld.columns.find((c: any) => c.name === n).id;
  // program drop-down: only the programs of the line's machine
  const prog = await call('POST', `/sheets/${lines.id}/columns`, {
    name: LABEL, dataType: 'select', width: 260, insertAt: 9,
    description: 'ตัวเลือกจากตาราง Program และค่า Sensitivity (เฉพาะเครื่องที่เลือก)',
    validation: { lookup: { sheetId: union.id, columnId: uid(LABEL), parent: { localColumnId: lid('หมายเลขเครื่อง'), foreignColumnId: uid('หมายเลขเครื่อง') } } },
  });
  const show = ['เวลา', 'Fe', 'Non Fe', 'SUS', 'Large test piece', 'ความถี่ (F)', LABEL, 'Code / วัตถุดิบ / Batch no.', 'Result (Detect / Not detect)', 'สรุปผล', 'MD Detect (NG)', 'Checked By'];
  const ld2 = await call('GET', `/sheets/${lines.id}`);
  await call('PUT', `/sheets/${header.id}/lines/settings`, {
    lines: { lineSheetId: lines.id, entry: 'form', displayColumnIds: show.map((n) => ld2.columns.find((c: any) => c.name === n).id), actions: [] },
  });
  console.log(`✓ ใบตรวจ ${form.id} (หัวเอกสาร ${header.id} · รายการตรวจ ${lines.id} · โปรแกรม ${prog.id ?? ''})`);
  console.log(`FILES ${progFile.id},${form.id}`);
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
