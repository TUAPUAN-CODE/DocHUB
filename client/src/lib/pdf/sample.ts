import type { Column, Row } from '@/types';

/** Example values for the layout designer when the sheet being previewed has no rows yet (a template file never has data) */
const BY_NAME: Record<string, string> = {
  วันที่ผลิต: '03/10/2026', ไลน์: 'Can R', กะ: 'DS', รหัสเอกสาร: 'P342', Market: 'Japan', ลูกค้า: 'ตัวอย่างลูกค้า', ชนิด: '80x100', PKG: 'Can',
  'Material Packaging 1': 'MAT-0001 ตัวอย่าง', 'Material Packaging 2': 'MAT-0002 ตัวอย่าง', 'Material Packaging 3': '', PO: 'PO-12345', 'Code ฝน': 'R 641A', 'Product Code SAP': '1000012345',
  'รหัสเอกสารระบบ Code': 'MRDPF184/26', 'Rev.': '3',
  'Code Format แถว 1': 'BB/MA 2029 JA 0O 0ABC XYZ 123', 'Code Format แถว 2': 'NO:0109630858 EXP:061027', 'Code Format แถว 3': 'MFG:061026 EXP:061027', 'Code Format แถว 4': 'LOT 0123456789 OOOO',
};

export function sampleRow(columns: Column[]): Row {
  const values: Record<string, never> = {};
  for (const c of columns) {
    if (c.dataType === 'image') continue;
    (values as Record<string, unknown>)[c.id] = BY_NAME[c.name] ?? (c.dataType === 'date' ? '2026-10-03' : ['int', 'float', 'decimal'].includes(c.dataType) ? 123 : `‹${c.name}›`);
  }
  return { id: 'sample', order: 1, values, meta: {}, createdBy: '', createdAt: '', updatedBy: null, updatedAt: '' } as unknown as Row;
}
