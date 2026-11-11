/**
 * The PDF layout of form F3QCPF06 (DAILY METAL DETECTOR SENSITIVITY TEST REPORT): one page per document (a row of
 * "หัวเอกสาร") with the document's own check lines ("รายการตรวจ"). Used by the seed database/seed/zz_md_f3qcpf06_pdf.sql (zz_: after the Metal Detector seed).
 *   node scripts/mdPdfTemplate.cjs > ../database/seed/zz_md_f3qcpf06_pdf.sql
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
const L = [
  ['7719c06d-4067-4b86-93f4-cd6c697ca41b', 'เวลา', 'เวลา', 12], ['99d0f90a-abe2-4760-a916-bb3eb0575bd3', 'ความถี่ (F)', 'F', 24],
  ['10e43d48-a512-443f-834d-559e489283b1', 'โปรแกรม / Sensitivity', 'โปรแกรม / Sensitivity', 34], ['51a77598-947c-4ce9-b3ac-fd9345854f1d', 'Code / วัตถุดิบ / Batch no.', 'Code / Batch', 26],
  ['952e7255-5d17-4d92-95c2-98972a8b397d', 'Fe', 'Fe', 8], ['33fd5d02-1f32-41be-97be-092f10ca704a', 'Non Fe', 'NFe', 8], ['45baa0b4-2dba-4194-9ea7-68ccc1249731', 'SUS', 'SUS', 8],
  ['245e1376-26f6-40fd-b877-68207302d02b', 'Large test piece', 'Large', 11], ['40dceddf-59dc-409a-bb32-45d7e1f5f8db', 'Result (Detect / Not detect)', 'Result', 13],
  ['f198dabd-17f8-4859-a3dd-06df2bedade6', 'รอบ A ครั้งที่ 1', 'A1', 7], ['1752a73d-a950-4e0d-87e8-c1260e8b87ef', 'รอบ A ครั้งที่ 2', 'A2', 7],
  ['9912e4a5-056e-4645-a662-e5df32138022', 'Object', 'Object', 11], ['78667b07-1bf4-47cc-8234-85f95d6c70a1', 'รอบ B ครั้งที่ 1', 'B1', 7],
  ['c5073441-fc49-4c34-b05b-8741667952d5', 'รอบ B ครั้งที่ 2', 'B2', 7], ['98050280-b4d4-4da6-9b90-57c9457e05d7', 'รอบ B ครั้งที่ 3', 'B3', 7],
  ['091f8d47-56cc-4925-b705-87af3702081f', 'สรุปผล', 'สรุป', 9], ['0ec4a18f-685a-44fe-b8f9-3a43428f28ae', 'Cause / Corrective action', 'Cause / Corrective action', null],
  ['81a96f96-80e3-4ec2-a122-4b2321228db5', 'MD Detect (NG)', 'MD Detect (NG)', 16], ['277db662-12ae-4658-9de7-9e8011b96d3c', 'Checked By', 'Checked By', 22],
];
const col = ([columnId, columnName]) => ({ columnId, columnName });
const text = (id, t, style, mb = 1) => ({ id, type: 'text', text: t, style: { align: 'left', ...style }, marginBottom: mb });
const fields = (id, keys, perRow) => ({
  id, type: 'fields', columns: keys.map((k) => col(H[k])), perRow, label: { fontSize: 7.5, color: '#4B5563', bold: true }, value: { fontSize: 9.5 },
  border: { color: '#9CA3AF', width: 0.5 }, imageSizeMm: 20, marginBottom: 2,
});
const template = {
  id: 'f3qcpf06-daily-md-report', name: 'ใบตรวจ F3QCPF06 (ต่อใบ)', mode: 'perRow',
  perRow: { sheetId: HEAD.id, sheetName: HEAD.name, onlySelected: true },
  page: { size: 'A4', orientation: 'landscape', margins: { top: 10, right: 8, bottom: 12, left: 8 } },
  base: { font: 'Sarabun', fontSize: 9.5, color: '#111827' },
  header: { enabled: false, blocks: [] },
  footer: { enabled: true, blocks: [text('ft', 'F3QCPF06 · พิมพ์ {{date}} {{time}} โดย {{user}}   หน้า {{page}} / {{pages}}', { fontSize: 7, color: '#6B7280', align: 'right' }, 0)] },
  blocks: [
    { id: 'hd', type: 'columns', gap: 4, marginBottom: 1, cols: [
      { widthPct: 75, blocks: [text('t1', 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT', { fontSize: 15, bold: true }, 0), text('t2', 'รายงานผลการทดสอบความไวของเครื่องตรวจจับโลหะประจำวัน', { fontSize: 9, color: '#4B5563' }, 0)] },
      { widthPct: 25, blocks: [text('t3', 'F3QCPF06', { fontSize: 12, bold: true, align: 'right' }, 0), text('t4', 'เลขที่ {{เลขที่ใบตรวจ}}', { fontSize: 9, align: 'right' }, 0)] },
    ] },
    { id: 'l1', type: 'line', thickness: 1, color: '#111827', widthPct: 100, marginTop: 0, marginBottom: 2 },
    fields('f1', ['date', 'shift', 'machine', 'lock', 'speed', 'belt', 'alarm', 'pieces', 'piecesOk'], 3),
    text('s1', 'ชิ้นทดสอบ (Test piece) ขนาด / หมายเลข', { fontSize: 8.5, bold: true }, 1),
    fields('f2', ['fe', 'feNo', 'nfe', 'nfeNo', 'sus', 'susNo'], 3),
    {
      id: 'tb', type: 'table', sheetId: LINES.id, sheetName: LINES.name, rowLines: true,
      columns: L.map(([columnId, columnName, header, w]) => ({ columnId, columnName, header, ...(w ? { widthMm: w } : {}), align: w && w <= 9 ? 'center' : 'left' })),
      rowsPerPage: null, limit: null, widthPct: 100, align: 'left',
      header: { bg: '#E5E7EB', color: '#111827', bold: true, fontSize: 7.5, align: 'center' },
      body: { fontSize: 8, color: '#111827', zebra: null, lineHeight: 1.1 }, border: { color: '#6B7280', width: 0.5 }, padding: 2,
      showRowNumber: true, rowNumberHeader: 'ที่', repeatHeader: true, useCurrentFilters: false, imageSizeMm: 12, maxImagesPerCell: 1,
      summary: [], summaryLabel: 'รวม', marginBottom: 2, caption: 'ผลการตรวจ',
    },
    text('lg', 'สัญลักษณ์:  ✓ = ผลผ่าน    x = ผลไม่ผ่าน    - = ไม่พบปัญหา    ∙ = ไม่ตรงกับรอบการตรวจ    ·  ความถี่ F0–F7 ตามรอบการตรวจที่กำหนด', { fontSize: 7.5, color: '#374151' }, 2),
    fields('f3', ['note'], 1),
    fields('f4', ['operator', 'qc', 'reviewer'], 3),
  ],
  watermark: { enabled: false, text: '', color: '#9CA3AF', opacity: 0.15, size: 90, angle: -35 },
  lockEditing: false,
};
const json = JSON.stringify([template]).replace(/'/g, "''");
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify([template])); process.exit(0); }
process.stdout.write(`-- DocHUB seed: PDF layout of form F3QCPF06 (one page per document with its own check lines).
-- Generated by server/scripts/mdPdfTemplate.cjs — do not edit by hand. Only when the file has no PDF layout yet.
SET NOCOUNT ON;
UPDATE Files SET pdf_templates = N'${json}', updated_at = SYSUTCDATETIME()
WHERE file_id = '${FILE}' AND (pdf_templates IS NULL OR LTRIM(RTRIM(pdf_templates)) IN (N'', N'[]'));
SELECT N'inserted' AS result;
`);
