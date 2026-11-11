/**
 * The PDF layout of form F3QCPF06 (DAILY METAL DETECTOR SENSITIVITY TEST REPORT) as the Excel form rev.4: A4 portrait, one page per
 * document (a row of "หัวเอกสาร") with the document's own check lines ("รายการตรวจ") and 33 lines to write on.
 *   node scripts/mdPdfTemplate.cjs > ../database/seed/zz_md_f3qcpf06_pdf_v2.sql   (v1 = zz_md_f3qcpf06_pdf.sql, landscape; already shipped)
 * Column ids are the ones of the Metal Detector seed (database/seed/metal_detector_f3qcpf06.sql).
 */
const FILE = '3d6f2822-7ef7-4498-af39-36cdf924ea82';
const HEAD = { id: '9ac1cb69-1114-4fe0-8d8b-47ce92b27a5a', name: 'หัวเอกสาร' };
const LINES = { id: '7961291e-a848-4c71-bcdd-99e21dd12621', name: 'รายการตรวจ' };
const H = {
  doc: ['0f574f5c-39a0-4a29-93e3-bec6532d6f13', 'เลขที่ใบตรวจ'], date: ['e322224a-1ed7-41fa-a4f2-31357cae523f', 'วันที่ (Date)'], shift: ['75708ec0-6b5a-45bc-8a89-e49fc8c96a23', 'กะ (Shift)'],
  machine: ['bf41a63f-5995-40b8-8815-6096c11bf1a2', 'หมายเลขเครื่อง'], lock: ['02d2c84b-da3e-463c-8f33-7d6dc38e32c8', 'ฝาล็อคหน้าจอ'], speed: ['28106328-abb6-4447-a9ab-945ab8bfbd3d', 'Speed สายพาน (m/min)'],
  fe: ['17e19214-14ff-4e61-a5b0-323479692ced', 'Fe (mm)'], feNo: ['33512dda-48bf-423c-88cb-a69f0483f0bb', 'Fe หมายเลข'], nfe: ['a5536f72-c181-43a9-90dd-4bcc5d5854c9', 'Non Fe (mm)'],
  nfeNo: ['2c3ca020-6698-4d9b-967d-245f9c1de38f', 'Non Fe หมายเลข'], sus: ['e0cca600-7f94-49ab-b164-35e01fd71266', 'SUS (mm)'], susNo: ['3dece4e0-a011-4771-99c0-1677c5eb37ea', 'SUS หมายเลข'],
  belt: ['68706d1e-3aa4-4866-9006-74eacb747a19', 'Belt stop'], alarm: ['d2255501-8ea7-41ef-99d8-0e2c4e88be37', 'Alarm'], pieces: ['7403ce2b-60e8-4084-9cd5-8b027c628bdc', 'Test pieces จำนวน (ชิ้น)'],
  piecesOk: ['746025d3-ffa1-46d8-aef9-d18027682af1', 'Test pieces ครบ'], operator: ['ba0e941f-697c-466e-8a81-14e9a480b53a', 'พนักงานคุมเครื่อง'],
  qc: ['728110b6-38f0-4ca3-b217-d7dfe19aed91', 'Checked By (QC staff)'], reviewer: ['b28eb5ce-5c22-4970-83df-478ff9b1886a', 'Reviewed By (QC Section Manager)'], note: ['46404379-b9a1-46fc-ac6c-26a41bf82876', 'หมายเหตุ'],
};
const col = ([columnId, columnName]) => ({ columnId, columnName });
const text = (id, t, style, mb = 1) => ({ id, type: 'text', text: t, style: { align: 'left', ...style }, marginBottom: mb });
const fs = require('fs');
const path = require('path');
const info = (id, items, extra = {}) => ({
  id, type: 'infoRow', underline: true, gapMm: 3, lineColor: '#374151', marginBottom: 1.6,
  labelStyle: { fontSize: 8 }, valueStyle: { fontSize: 8.5, bold: true },
  items: items.map(([label, value, widthPct], i) => ({ id: `${id}${i}`, label, value, widthPct })), ...extra,
});
const box = (id, t) => ({ ...text(id, t, { fontSize: 7, lineHeight: 1.2 }, 0), border: { color: '#111827', width: 0.6, padding: 0.8 } });
// table columns in the order of the Excel form (A … S)
const T = [
  ['7719c06d-4067-4b86-93f4-cd6c697ca41b', 'เวลา', 'เวลา', 9.5],
  ['952e7255-5d17-4d92-95c2-98972a8b397d', 'Fe', 'Fe', 6], ['33fd5d02-1f32-41be-97be-092f10ca704a', 'Non Fe', 'Non Fe', 6.5],
  ['45baa0b4-2dba-4194-9ea7-68ccc1249731', 'SUS', 'SUS', 6], ['245e1376-26f6-40fd-b877-68207302d02b', 'Large test piece', 'Large test piece', 8],
  ['99d0f90a-abe2-4760-a916-bb3eb0575bd3', 'ความถี่ (F)', '(F)', 9, true],
  ['10e43d48-a512-443f-834d-559e489283b1', 'โปรแกรม / Sensitivity', '/ Sensitivity', 24],
  ['51a77598-947c-4ce9-b3ac-fd9345854f1d', 'Code / วัตถุดิบ / Batch no.', 'Code / วัตถุดิบ / Batch no.', 20],
  ['40dceddf-59dc-409a-bb32-45d7e1f5f8db', 'Result (Detect / Not detect)', 'Result (Detect / Not detect)', 11],
  ['f198dabd-17f8-4859-a3dd-06df2bedade6', 'รอบ A ครั้งที่ 1', 'ครั้งที่ 1', 6.5], ['1752a73d-a950-4e0d-87e8-c1260e8b87ef', 'รอบ A ครั้งที่ 2', 'ครั้งที่ 2', 6.5],
  ['9912e4a5-056e-4645-a662-e5df32138022', 'Object', 'Object', 9.5],
  ['78667b07-1bf4-47cc-8234-85f95d6c70a1', 'รอบ B ครั้งที่ 1', 'ครั้งที่ 1', 6.5], ['c5073441-fc49-4c34-b05b-8741667952d5', 'รอบ B ครั้งที่ 2', 'ครั้งที่ 2', 6.5],
  ['98050280-b4d4-4da6-9b90-57c9457e05d7', 'รอบ B ครั้งที่ 3', 'ครั้งที่ 3', 6.5],
  ['091f8d47-56cc-4925-b705-87af3702081f', 'สรุปผล', 'สรุปผล', 9.5], ['0ec4a18f-685a-44fe-b8f9-3a43428f28ae', 'Cause / Corrective action', 'Cause/ Corrective action', null],
  ['81a96f96-80e3-4ec2-a122-4b2321228db5', 'MD Detect (NG)', 'MD Detect (NG)', 10.5], ['277db662-12ae-4658-9de7-9e8011b96d3c', 'Checked By', 'Checked By', 12],
];
const tok = (k) => `{{${H[k][1]}}}`;
/** v2: the Excel form F3QCPF06 rev.4 — A4 portrait, one page per document, 33 lines to write on */
const template = {
  id: 'f3qcpf06-excel-a4-portrait', name: 'ใบตรวจ F3QCPF06 (แบบฟอร์ม Excel A4 แนวตั้ง)', mode: 'perRow',
  perRow: { sheetId: HEAD.id, sheetName: HEAD.name, onlySelected: true },
  page: { size: 'A4', orientation: 'portrait', margins: { top: 6, right: 6, bottom: 7, left: 6 } },
  base: { font: 'Sarabun', fontSize: 8.5, color: '#111827' },
  header: { enabled: false, blocks: [] },
  footer: { enabled: true, blocks: [text('ft', 'F3QCPF06 · พิมพ์ {{date}} {{time}} โดย {{user}} · หน้า {{page}} / {{pages}}', { fontSize: 6.5, color: '#6B7280', align: 'right' }, 0)] },
  blocks: [
    { ...text('no', 'เลขที่ใบตรวจ: {{เลขที่ใบตรวจ}}', { fontSize: 7.5, bold: true, align: 'right' }, 0), position: { x: 150, y: 5 } },
    text('c1', 'i-Tail Corporation Public Company Limited', { fontSize: 12, bold: true, align: 'center' }, 0),
    text('c2', '333 Moo 2, Karnjanavanich Road,  Pavong Sub-district, Mueang Songkhla District, Songkhla 90100, Thailand ; TEL: 66 (0) 7430 0700 - 8  FAX: 66(0) 7430 0709', { fontSize: 7, bold: true, align: 'center' }, 0),
    text('c3', 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT', { fontSize: 10.5, bold: true, align: 'center' }, 2.5),
    info('i1', [['วันที่ (Date):', tok('date'), 17], ['กะ (Shift):', tok('shift'), 15], ['หมายเลขเครื่อง:', tok('machine'), 22], ['ฝาล็อคหน้าจอ:', tok('lock'), 20], ['Speed สายพาน:', `${tok('speed')} m/min`, 20]]),
    info('i2', [['ขนาด / หมายเลข (test piece size and No.):  Fe', `${tok('fe')} mm / ${tok('feNo')}`, 40], ['Non Fe', `${tok('nfe')} mm / ${tok('nfeNo')}`, 17], ['SUS', `${tok('sus')} mm / ${tok('susNo')}`, 15], ['Belt stop (OK/Not OK)', tok('belt'), 14], ['Alarm (OK/Not OK)', tok('alarm'), 14]], { labelStyle: { fontSize: 7.5 } }),
    text('fq', 'ความถี่การตรวจสอบ (Frequency):  F0 : SENSITIVITY TEST ,  F1 : MEMORY TEST ,  F2 : เริ่มงาน ,  F3 : ทดสอบทุกชั่วโมง (CONSECUTIVE TEST) ,  F4 : หยุดเครื่องชั่วคราว ,  F5 : เปลี่ยนโปรแกรม ,  F6 : เครื่องเสีย ,  F7 : เลิกงาน', { fontSize: 7 }, 1.2),
    {
      id: 'tb', type: 'table', sheetId: LINES.id, sheetName: LINES.name, rowLines: true,
      columns: T.map(([columnId, columnName, header, w, firstWord]) => ({ columnId, columnName, header, ...(w ? { widthMm: w } : {}), align: w && w <= 11 ? 'center' : 'left', ...(firstWord ? { firstWord: true } : {}) })),
      headerGroups: [
        [{ label: 'การตรวจสอบการทำงานของเครื่อง METAL DETECTOR ด้วยวัตถุมาตรฐาน', span: 7 }, { label: 'การตรวจจับวัตถุดิบของเครื่อง METAL DETECTOR เมื่อผ่านวัตถุดิบ บันทึกกรณีเครื่องมีการตรวจจับโลหะ', span: 12 }],
        [{ label: '', span: 1 }, { label: 'ผลการทดสอบ', span: 4 }, { label: 'ความถี่', span: 1 }, { label: 'โปรแกรม', span: 1 }, { label: '', span: 1 }, { label: '', span: 1 },
          { label: 'ผลผ่าน (รอบ A)', span: 2 }, { label: '', span: 1 }, { label: 'ผลผ่านใหม่ (รอบ B)', span: 3 }, { label: '', span: 1 }, { label: '', span: 1 }, { label: '', span: 1 }, { label: '', span: 1 }],
      ],
      minRows: 33, rowsPerPage: 33, limit: null, widthPct: 100, align: 'left',
      header: { bg: '#FFFFFF', color: '#111827', bold: true, fontSize: 6.5, align: 'center' },
      body: { fontSize: 7, color: '#111827', zebra: null, lineHeight: 1 }, border: { color: '#111827', width: 0.5 }, padding: 0.9,
      showRowNumber: false, rowNumberHeader: '', repeatHeader: true, useCurrentFilters: false, imageSizeMm: 10, maxImagesPerCell: 1,
      summary: [], summaryLabel: '', marginBottom: 1.5,
    },
    { id: 'n0', type: 'columns', gap: 3, marginBottom: 0.8, cols: [
      { widthPct: 50, blocks: [text('n1', 'หมายเหตุ    ✓ = ผลผ่าน    x = ผลไม่ผ่าน    - = ไม่พบปัญหา    ∙ = ไม่ตรงกับรอบการตรวจ', { fontSize: 7.5, bold: true }, 0)] },
      { widthPct: 24, blocks: [text('n2', `**Test pieces จำนวน  ${tok('pieces')}  ชิ้น   ครบ  ${tok('piecesOk')}`, { fontSize: 7.5, bold: true }, 0)] },
      { widthPct: 26, blocks: [text('n3', `พนักงานคุมเครื่อง :  ${tok('operator')}`, { fontSize: 7.5, bold: true }, 0)] },
    ] },
    text('r1', ' -   ผลการผ่านรอบ A ครั้งที่ 1 "X" ครั้งที่ 2 "✓" ต้องนำปลาไปผ่านใหม่รอบ B : 3 ครั้ง โดยผลการผ่านรอบ B ต้อง  1.) "✓" ทั้ง 3 ครั้ง จึงสรุปผล "OK" และ  2.) ถ้าพบ "X" ในรอบ B ให้หยุดทันที สรุปผล "NK" (Not OK) และทิ้งปลาชุดนี้', { fontSize: 6.8, lineHeight: 1.2 }, 0.4),
    text('r2', ' -   ผลการผ่านรอบ A ครั้งที่ 1 "X" ครั้งที่ 2 "X" ต้องนำปลาไปคัดหาชิ้นโลหะ ถ้าคัดแล้วไม่พบชิ้นโลหะให้สรุปผล "NK" (Not OK) ต้องทิ้งปลาชุดนี้ แต่ถ้าคัดแล้วพบชิ้นโลหะให้นำปลาผ่านใหม่รอบ B 3 ครั้ง โดยผลรอบ B ต้อง  1.) "✓" ทั้ง 3 ครั้ง จึงสรุปผล "OK" นำปลาชุดนี้กลับมาใช้ใหม่  2.) ถ้าพบ "X" ในรอบ B ให้หยุดผ่านทันที สรุปผล "NK" (Not OK) และทิ้งปลาชุดนี้', { fontSize: 6.8, lineHeight: 1.2 }, 1.2),
    info('nt', [['หมายเหตุเพิ่มเติม:', tok('note'), 100]], { marginBottom: 2.5 }),
    info('sg', [['Checked By:', `${tok('qc')}   (QC staff)`, 50], ['Reviewed By:', `${tok('reviewer')}   (QC Section Manager)`, 50]], { gapMm: 12, marginBottom: 3 }),
    { id: 'dc', type: 'columns', gap: 0, marginBottom: 0, cols: [
      { widthPct: 22, blocks: [] },
      { widthPct: 26, blocks: [box('d1', 'ผู้จัดทำ: \nผู้อนุมัติ: \nวันที่อนุมัติ:   19/07/25')] },
      { widthPct: 26, blocks: [box('d2', 'หมายเลขเอกสาร: F3QCPF06\nแก้ไขครั้งที่:   4\nวันที่เริ่มใช้:   22/07/25')] },
      { widthPct: 12, blocks: [box('d3', ' \nหน้าที่: 1/1\n ')] },
      { widthPct: 14, blocks: [] },
    ] },
  ],
  watermark: { enabled: false, text: '', color: '#9CA3AF', opacity: 0.15, size: 90, angle: -35 },
  lockEditing: false,
};
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify([template])); process.exit(0); }
// --copies: the same layout for copies of the form file (Data / 2026 / November …) made before they could carry it: every live file
// with the sheets หัวเอกสาร + รายการตรวจ of F3QCPF06 that has no Excel-A4 layout yet; the sheet ids of the copy go into the layout
// (columns are matched by name in the browser)
if (process.argv.includes('--copies')) {
  const one2 = JSON.stringify(template).replace(/'/g, "''");
  process.stdout.write(`-- DocHUB seed: the Excel-A4 PDF layout of F3QCPF06 for COPIES of the form file (made with ทำสำเนา before they carried it).
-- Generated by server/scripts/mdPdfTemplate.cjs --copies — do not edit by hand. Runs once; later copies inherit the layout of their source.
SET NOCOUNT ON;
DECLARE @v2 NVARCHAR(MAX) = N'${one2}';
DECLARE @t TABLE (file_id UNIQUEIDENTIFIER, tpl NVARCHAR(MAX));
INSERT INTO @t (file_id, tpl)
SELECT f.file_id, REPLACE(REPLACE(@v2, N'${HEAD.id}', LOWER(CONVERT(NVARCHAR(36), h.sheet_id))), N'${LINES.id}', LOWER(CONVERT(NVARCHAR(36), l.sheet_id)))
FROM Files f
JOIN Sheets h ON h.file_id = f.file_id AND h.is_deleted = 0 AND h.sheet_name = N'${HEAD.name}'
JOIN Sheets l ON l.file_id = f.file_id AND l.is_deleted = 0 AND l.sheet_name = N'${LINES.name}'
WHERE f.is_deleted = 0 AND f.file_id <> '${FILE}'
  AND EXISTS (SELECT 1 FROM Columns c WHERE c.sheet_id = h.sheet_id AND c.is_deleted = 0 AND c.column_name = N'เลขที่ใบตรวจ')
  AND EXISTS (SELECT 1 FROM Columns c WHERE c.sheet_id = l.sheet_id AND c.is_deleted = 0 AND c.column_name = N'Code / วัตถุดิบ / Batch no.')
  AND (f.pdf_templates IS NULL OR f.pdf_templates NOT LIKE N'%f3qcpf06-excel-a4-portrait%');
UPDATE f SET pdf_templates = CASE WHEN f.pdf_templates IS NULL OR LTRIM(RTRIM(f.pdf_templates)) IN (N'', N'[]') OR ISJSON(f.pdf_templates) = 0
                                  THEN N'[' + t.tpl + N']' ELSE JSON_MODIFY(f.pdf_templates, 'append $', JSON_QUERY(t.tpl)) END,
             updated_at = SYSUTCDATETIME()
FROM Files f JOIN @t t ON t.file_id = f.file_id;
SELECT N'inserted' AS result;
`);
  process.exit(0);
}
// the layout shipped by zz_md_f3qcpf06_pdf.sql (v1, landscape): replaced when nobody changed it, otherwise v2 is added next to it
const v1 = /pdf_templates = N'(.*)', updated_at/s.exec(fs.readFileSync(path.resolve(__dirname, '../../database/seed/zz_md_f3qcpf06_pdf.sql'), 'utf8'))[1];
const one = JSON.stringify(template).replace(/'/g, "''");
process.stdout.write(`-- DocHUB seed: PDF layout of form F3QCPF06 as the Excel form (A4 portrait, rev.4), one page per document with its own check lines.
-- Generated by server/scripts/mdPdfTemplate.cjs — do not edit by hand. Replaces the landscape layout of zz_md_f3qcpf06_pdf.sql
-- when it is unchanged; a file with other / edited layouts gets this one added (once).
SET NOCOUNT ON;
DECLARE @v2 NVARCHAR(MAX) = N'${one}';
UPDATE Files SET pdf_templates = N'[' + @v2 + N']', updated_at = SYSUTCDATETIME()
WHERE file_id = '${FILE}' AND (pdf_templates IS NULL OR LTRIM(RTRIM(pdf_templates)) IN (N'', N'[]') OR pdf_templates = N'${v1}');
UPDATE Files SET pdf_templates = JSON_MODIFY(pdf_templates, 'append $', JSON_QUERY(@v2)), updated_at = SYSUTCDATETIME()
WHERE file_id = '${FILE}' AND ISJSON(pdf_templates) = 1 AND pdf_templates NOT LIKE N'%f3qcpf06-excel-a4-portrait%';
SELECT N'inserted' AS result;
`);
