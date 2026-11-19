/**
 * The PDF layout of "บันทึกการแก้ไขเครื่อง Metal Detector (F3QCPP28)" in the formal style of F3QCPF06: company name + address, title, document
 * number, a table with merged group headings and empty lines to write on, signatures and the document box (number / revision / page) in the footer.
 * A4 landscape, a table report of the sheet "บันทึกปัญหา" (respects the filters the user has set).
 *   node scripts/mdProblemPdfTemplate.cjs > ../database/seed/zz_md_problem_pdf.sql        (seed: adds the layout to the file once)
 *   node scripts/mdProblemPdfTemplate.cjs --json                                            (the layout only, for the designer / tests)
 * Ids are the ones of the shipped seed database/seed/metal_detector_record_problem.sql.
 */
const FILE = 'af0b3ece-bb7b-41b0-8351-b1d26d8eea2c';
const SHEET = { id: '7757fa8a-0caf-45cd-a8ae-4f4b8450a129', name: 'บันทึกปัญหา' };
const COL = {
  date: '2bea0b04-5540-4387-ba0a-8b742fbb7bc7', shift: '4023d0dc-517b-44ce-8d4d-a4e6bc316210', type: 'b1e64c90-a58e-46b2-b21d-25cf12a1a662', no: '22857e33-9d8e-4302-be4a-e7d69283819b',
  group: 'e2089e47-1aac-4721-8b4e-357aea801750', detail: '5489ddf8-3f37-406e-a021-36aacfaee2d0', fix: 'fc0c680a-b935-43a9-91ad-4599fa2f65fe', note: '3b0c1116-b262-442e-93e3-c06542502c61',
  by: '4e898c5b-4eaa-4800-81be-3d2a0d0d4abd', check: 'acc34670-e21e-4d33-8327-faf759ecee7a',
};
const TPL_ID = 'md-problem-f3qcpp28';
const text = (id, t, style, mb = 1) => ({ id, type: 'text', text: t, style: { align: 'left', ...style }, marginBottom: mb });
const box = (id, t) => ({ ...text(id, t, { fontSize: 7, lineHeight: 1.25 }, 0), border: { color: '#111827', width: 0.6, padding: 0.9 } });
const info = (id, items, extra = {}) => ({
  id, type: 'infoRow', underline: true, gapMm: 6, lineColor: '#374151', marginBottom: 1.6,
  labelStyle: { fontSize: 8 }, valueStyle: { fontSize: 8.5, bold: true },
  items: items.map(([label, value, widthPct], i) => ({ id: `${id}${i}`, label, value, widthPct })), ...extra,
});
// [column, header, width mm (null = takes what is left), align]
const T = [
  [COL.date, 'วันที่', 19, 'center'], [COL.shift, 'กะ', 8, 'center'], [COL.type, 'MD Type', 18, 'center'], [COL.no, 'MD No.', 16, 'center'],
  [COL.group, 'กลุ่มปัญหา', 38, 'left'], [COL.detail, 'รายละเอียดปัญหา', null, 'left'], [COL.fix, 'การแก้ไข', 56, 'left'], [COL.note, 'หมายเหตุ', 24, 'left'],
  [COL.by, 'บันทึกโดย', 19, 'center'], [COL.check, 'ตรวจสอบโดย', 19, 'center'],
];
const template = {
  id: TPL_ID, name: 'F3QCPP28 บันทึกการแก้ไขเครื่อง Metal Detector (แบบฟอร์มทางการ A4 แนวนอน)', mode: 'table',
  page: { size: 'A4', orientation: 'landscape', margins: { top: 7, right: 8, bottom: 38, left: 8 } },
  base: { font: 'Sarabun', fontSize: 8.5, color: '#111827' },
  header: { enabled: false, blocks: [] },
  footer: { enabled: true, blocks: [
    { id: 'dc', type: 'columns', gap: 0, marginBottom: 0.6, cols: [
      { widthPct: 34, blocks: [] },
      { widthPct: 22, blocks: [box('d1', 'ผู้จัดทำ: \nผู้อนุมัติ: \nวันที่อนุมัติ:   19/09/26')] },
      { widthPct: 22, blocks: [box('d2', 'หมายเลขเอกสาร: F3QCPP28\nแก้ไขครั้งที่:   0\nวันที่เริ่มใช้:   19/09/26')] },
      { widthPct: 12, blocks: [box('d3', ' \nหน้าที่: {{page}}/{{pages}}\n ')] },
      { widthPct: 10, blocks: [] },
    ] },
    text('ft', 'F3QCPP28 · พิมพ์ {{date}} {{time}} โดย {{user}}', { fontSize: 6.5, color: '#6B7280', align: 'right' }, 0),
  ] },
  blocks: [
    { ...text('no', 'เลขที่เอกสาร: F3QCPP28', { fontSize: 8, bold: true, align: 'right' }, 0), position: { x: 235, y: 6 } },
    text('c1', 'i-Tail Corporation Public Company Limited', { fontSize: 13, bold: true, align: 'center' }, 0),
    text('c2', '333 Moo 2, Karnjanavanich Road,  Pavong Sub-district, Mueang Songkhla District, Songkhla 90100, Thailand ; TEL: 66 (0) 7430 0700 - 8  FAX: 66(0) 7430 0709', { fontSize: 7, bold: true, align: 'center' }, 0),
    text('c3', 'บันทึกการแก้ไขเครื่อง METAL DETECTOR', { fontSize: 11, bold: true, align: 'center' }, 2.5),
    info('i1', [['วันที่พิมพ์ (Date):', '{{date}}', 20], ['จำนวนรายการ:', '{{rows}}', 15], ['ผู้พิมพ์:', '{{user}}', 30], ['ช่วงข้อมูล:', 'ตามตัวกรองที่เลือกในหน้าตาราง', 35]]),
    {
      id: 'tb', type: 'table', sheetId: SHEET.id, sheetName: SHEET.name,
      columns: T.map(([columnId, header, widthMm, align]) => ({ columnId, columnName: header, header, ...(widthMm ? { widthMm } : {}), align })),
      headerGroups: [[
        { label: '', span: 1 }, { label: 'วัน / กะ', span: 2 }, { label: 'เครื่อง METAL DETECTOR', span: 2 }, { label: 'ปัญหาที่พบ', span: 2 }, { label: 'การแก้ไข', span: 2 }, { label: 'ผู้รับผิดชอบ', span: 2 },
      ]],
      minRows: 12, rowsPerPage: 12, limit: null, widthPct: 100, align: 'left',
      header: { bg: '#FFFFFF', color: '#111827', bold: true, fontSize: 8, align: 'center' },
      body: { fontSize: 8, color: '#111827', zebra: null, lineHeight: 1.05 }, border: { color: '#111827', width: 0.5 }, padding: 1.3,
      showRowNumber: true, rowNumberHeader: 'ลำดับ', repeatHeader: true, useCurrentFilters: true, imageSizeMm: 10, maxImagesPerCell: 1,
      summary: [], summaryLabel: '', marginBottom: 2,
    },
    text('r1', 'หมายเหตุ: กรณีเครื่อง Metal Detector ไม่ detect Test piece หรือพบปัญหาที่กระทบการตรวจจับ ให้แจ้ง QC Section Manager และบันทึกการแก้ไขพร้อมผลการทดสอบ Sensitivity ซ้ำหลังแก้ไขทุกครั้ง', { fontSize: 7, lineHeight: 1.2 }, 2),
    info('sg', [['ผู้บันทึก (Recorded By):', '', 34], ['ผู้ตรวจสอบ (Checked By):', '', 33], ['ผู้อนุมัติ (Reviewed By):', '', 33]], { gapMm: 10, marginBottom: 0 }),
  ],
  watermark: { enabled: false, text: '', color: '#9CA3AF', opacity: 0.15, size: 90, angle: -35 },
  lockEditing: false,
};
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify([template])); process.exit(0); }
const one = JSON.stringify(template).replace(/'/g, "''");
process.stdout.write(`-- DocHUB seed: the formal PDF layout of F3QCPP28 (บันทึกการแก้ไขเครื่อง Metal Detector): company header, document number, table with
-- group headings + empty lines, signatures and the document box in the footer. Generated by server/scripts/mdProblemPdfTemplate.cjs — do not edit by hand.
-- Added once; skipped when the file is missing or already has it. Existing layouts of the file are kept.
SET NOCOUNT ON;
DECLARE @tpl NVARCHAR(MAX) = N'${one}';
UPDATE Files
SET pdf_templates = CASE WHEN pdf_templates IS NULL OR LTRIM(RTRIM(pdf_templates)) IN (N'', N'[]') OR ISJSON(pdf_templates) = 0
                         THEN N'[' + @tpl + N']' ELSE JSON_MODIFY(pdf_templates, 'append $', JSON_QUERY(@tpl)) END,
    updated_at = SYSUTCDATETIME()
WHERE file_id = '${FILE}' AND is_deleted = 0 AND (pdf_templates IS NULL OR pdf_templates NOT LIKE N'%${TPL_ID}%');
SELECT N'inserted' AS result;
`);
