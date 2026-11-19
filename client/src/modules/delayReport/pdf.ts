// PDF รายงานควบคุมเวลาการผลิต (Delay Time for Production Control Report, F3PFPF67)
// ใช้ร่วม: หน้า Report (ปุ่ม Export PDF) และหน้าดำเนินการเสร็จสิ้น — แก้ที่เดียวได้ทั้งสองหน้า
// @ts-nocheck — ported as-is from DelayHUB (frontend/src/component/Pack/ReportRawmatNotEditTIME/Asset/delayReportPdf.js) so the PDF looks the same.
// PDF รายงานควบคุมเวลาการผลิต (Delay Time for Production Control Report, F3PFPF67) — the values of every cell were computed by DelayHUB
// (GET /api/export/f3pfpf67) and come from the sheet "รายงาน Delay F3PFPF67" (./lines.ts → DelayLine). Keep the drawing in step with DelayHUB.
import jsPDF from 'jspdf';
import type { DelayLine } from './lines';

export const formatDateTimeForPDF = (dateTimeStr) => {
  if (!dateTimeStr || dateTimeStr === '-') return '-';
  try {
    const s = String(dateTimeStr).replace('T', ' ').split('.')[0];
    const parts = s.split(' ');
    if (parts.length < 2) return s;
    const [year, month, day] = parts[0].split('-');
    const timePart = parts[1].slice(0, 5);
    const buddhistYear = parseInt(year, 10) + 543;
    return `${day}/${month}/${buddhistYear}\n${timePart}`;
  } catch {
    return dateTimeStr;
  }
};

/**
 * dataRows: แถวรายงาน (production, mat_name, batch_after, weight_RM, group_no, rmit_date, detail, color, odor, texture,
 *           เวลา History, rm_group_id, DBS1-4, remark_dalay) · sigData: { recordedBy, reviewedBy, qcManager }
 * meta: { exportDate, exportShift, exportLine, exportPlant } → คืน jsPDF (ยังไม่บันทึก)
 */
export const buildDelayReportPdf = (dataRows: DelayLine[], sigData: Record<string, string> = {}, meta: Record<string, string> = {}, fonts: { regular: string; bold: string }) => {
  const { exportDate = '', exportShift = '', exportLine = '', exportPlant = '' } = meta;
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 5;

  doc.addFileToVFS('Sarabun-Regular.ttf', fonts.regular);
  doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');
  doc.addFileToVFS('Sarabun-Bold.ttf', fonts.bold);
  doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');
  doc.setFont('Sarabun', 'normal');
  doc.setLanguage('th');
  doc.setLineWidth(0.05);

  const drawRect = (x, y, w, h) => { doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.1); doc.rect(x, y, w, h); };
  const fillRect = (x, y, w, h, rgb) => { doc.setFillColor(...rgb); doc.rect(x, y, w, h, 'F'); };
  const drawText = (text, x, y, opts = {}) => {
    const { fontSize = 8, align = 'center', bold = false, color = [0, 0, 0] } = opts;
    doc.setFont('Sarabun', bold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...color);
    doc.text(String(text ?? '').normalize('NFC'), x, y, { align });
  };
  const drawCell = (text, x, y, w, h, opts = {}) => {
    const { fill, fontSize = 8, bold = false, align = 'center' } = opts;
    if (fill) fillRect(x, y, w, h, fill);
    drawRect(x, y, w, h);
    const lines = String(text ?? '').split('\n');
    const lineH = fontSize * 0.5;
    const totalH = lines.length * lineH;
    const startY = y + (h - totalH) / 2 + lineH * 0.8;
    lines.forEach((line, i) => {
      const tx = align === 'center' ? x + w / 2 : align === 'right' ? x + w - 1.5 : x + 1.5;
      drawText(line, tx, startY + i * lineH, { fontSize, bold, align });
    });
  };
//แก้ไขความกว้างใน PDF 
  const tX = margin; const tY = 29; const tW = pageW - margin * 2;
  const colCode = 8; const colRM = 33; const colBatch = 18; const batchCols = 10;
  const batchCellW = colBatch / batchCols; const colWeight = 8; const colGrpNo = 8;
  const colDate = 15; const colHist = 12; const sensoryCellW = 5; const colSensory = sensoryCellW * 3;
  const colPrepA = 13; const colCold1 = 13; const colColdOut1 = 13;
  const colCold2 = 13; const colColdOut2 = 13; const colPacked = 13;
  const colDBS1 = 10; const colDBS2 = 10; const colDBS3 = 10; const colDBS4 = 10;
  const colRemark = tW - colCode - colRM - colBatch - colWeight - colGrpNo
    - colDate - colHist - colSensory
    - colPrepA - colCold1 - colColdOut1
    - colCold2 - colColdOut2 - colPacked
    - colDBS1 - colDBS2 - colDBS3 - colDBS4;
  const h1 = 7; const h2 = 14; const headerH = h1 + h2; const hFill = [210, 228, 255];
  const minRows = 17;
  const bottomReserved = 80;
  const availableH = pageH - (tY + headerH) - bottomReserved;
  const rowH = Math.floor((availableH / minRows) * 10) / 10;

  const drawPageHeader = (pageNumber, totalPages) => {
    drawText('บริษัท ไอ-เทล คอร์ปอเรชั่น จำกัด (มหาชน)', pageW / 2, 12, { fontSize: 16, bold: true, align: 'center' });
    drawText('รายงานควบคุมเวลากระบวนการผลิต โรงผลิตอาหารสัตว์เลี้ยง (Delay Time for Production Control Report)', pageW / 2, 19, { fontSize: 10, align: 'center' });
    drawText('F3PFPF67-2-19/06/26', pageW - margin, 12, { fontSize: 8, align: 'right' });
    const infoY = 24;
    const infoItems = [
      { label: 'Date:', value: exportDate || '', dotWidth: 30 },
      { label: 'Shift:', value: exportShift || '', dotWidth: 15 },
      { label: 'Line:', value: exportLine || '', dotWidth: 20 },
      { label: 'Plant:', value: exportPlant || '', dotWidth: 20 },
    ];
    let infoX = margin;
    infoItems.forEach(({ label, value, dotWidth }) => {
      drawText(label, infoX, infoY, { fontSize: 9, align: 'left' });
      const labelWidth = doc.getTextWidth(label);
      const lineStartX = infoX + labelWidth + 1;
      const lineEndX = lineStartX + dotWidth;
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2);
      doc.line(lineStartX, infoY + 1, lineEndX, infoY + 1); doc.setLineWidth(0.5);
      if (value) drawText(value, lineStartX + dotWidth / 2, infoY - 0.5, { fontSize: 9, align: 'center', color: [0, 0, 0] });
      infoX = lineEndX + 4;
    });
    drawText(`Page: ${pageNumber} / ${totalPages}`, pageW - margin, infoY, { fontSize: 9, align: 'right' });
  };

  const drawTableHeader = () => {
    let cx = tX; const cy = tY;
    drawCell('โค้ด\n(Product\nCode)', cx, cy, colCode, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colCode;
    drawCell('วัตถุดิบ\n(Raw Mat.)', cx, cy, colRM, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colRM;
    fillRect(cx, cy, colBatch, h1, hFill); drawRect(cx, cy, colBatch, h1);
    drawText('Batch', cx + colBatch / 2, cy + h1 / 2 + 2, { fontSize: 5, bold: true });
    for (let i = 0; i < batchCols; i++) drawCell('', cx + i * batchCellW, cy + h1, batchCellW, h2, { fill: hFill, fontSize: 5 });
    cx += colBatch;
    drawCell('น้ำหนัก\n(kgs.)', cx, cy, colWeight, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colWeight;
    drawCell('ชุดที่', cx, cy, colGrpNo, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colGrpNo;
    drawCell('วันที่-\nเวลาเตรียม', cx, cy, colDate, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colDate;
    drawCell('Hist./\nViscosity\n/Temp', cx, cy, colHist, headerH, { fill: hFill, bold: true, fontSize: 5 }); cx += colHist;
    fillRect(cx, cy, colSensory, h1, hFill); drawRect(cx, cy, colSensory, h1);
    drawText('Sensory', cx + colSensory / 2, cy + h1 / 2 + 2, { fontSize: 5, bold: true });
    [['สี', 'Color'], ['กลิ่น', 'Odor'], ['เนื้อสัมผัส', 'Texture']].forEach(([th, en], i) =>
      drawCell(`${th}\n${en}`, cx + i * sensoryCellW, cy + h1, sensoryCellW, h2, { fill: hFill, fontSize: 5 })
    ); cx += colSensory;
    const timeGroupW = colPrepA + colCold1 + colColdOut1 + colCold2 + colColdOut2 + colPacked;
    fillRect(cx, cy, timeGroupW, h1, hFill); drawRect(cx, cy, timeGroupW, h1);
    drawText('เวลา (Time)', cx + timeGroupW / 2, cy + h1 / 2 + 2, { fontSize: 5, bold: true });
    [
      { label: 'เตรียมเสร็จ\n(A)', w: colPrepA },
      { label: 'เข้าห้องเย็น 1\n(B)', w: colCold1 },
      { label: 'ออกห้องเย็น 1\n(C)', w: colColdOut1 },
      { label: 'เข้าห้องเย็น 2\n(D)', w: colCold2 },
      { label: 'ออกห้องเย็น 2\n(E)', w: colColdOut2 },
      { label: 'บรรจุเสร็จ\n(F)', w: colPacked },
    ].forEach((tc, i, arr) => {
      let tcx2 = cx;
      arr.slice(0, i).forEach(t => tcx2 += t.w);
      drawCell(tc.label, tcx2, cy + h1, tc.w, h2, { fill: hFill, fontSize: 5 });
    }); cx += timeGroupW;
    const delayGroupW = colDBS1 + colDBS2 + colDBS3 + colDBS4;
    fillRect(cx, cy, delayGroupW, h1, hFill); drawRect(cx, cy, delayGroupW, h1);
    drawText('Delay time (hr.)', cx + delayGroupW / 2, cy + h1 / 2 + 2, { fontSize: 5, bold: true });
    [{ label: '1\n(B-A)', w: colDBS1 }, { label: '2\n(C-B)', w: colDBS2 }, { label: '3\n(F-C)', w: colDBS3 }, { label: '4', w: colDBS4 }]
      .forEach(dc => { drawCell(dc.label, cx, cy + h1, dc.w, h2, { fill: hFill, fontSize: 5 }); cx += dc.w; });
    drawCell('หมายเหตุ\n(Remark)', cx, cy, colRemark, headerH, { fill: hFill, bold: true, fontSize: 5 });
  };

  const drawPageFooter = (sigData) => {
    const finalY = tY + headerH + minRows * rowH + 4;
    const legendY = finalY + 8;
    const noteRowH = 4;
    const hFillLegend = [210, 228, 255];

    const drawMatTable2 = (startX, startY, colMatW, colChW, rows) => {
      drawCell('วัตถุดิบ', startX, startY, colMatW, noteRowH * 2, { fill: hFillLegend, bold: true, fontSize: 5.5 });
      fillRect(startX + colMatW, startY, colChW * 4, noteRowH, hFillLegend); drawRect(startX + colMatW, startY, colChW * 4, noteRowH);
      drawText('ช่วงที่', startX + colMatW + (colChW * 4) / 2, startY + noteRowH / 2 + 1.2, { fontSize: 5.5, bold: true });
      [1, 2, 3, 4].forEach((n, i) => drawCell(String(n), startX + colMatW + i * colChW, startY + noteRowH, colChW, noteRowH, { fill: hFillLegend, bold: true, fontSize: 5.5 }));
      rows.forEach((r, i) => {
        const ry = startY + noteRowH * 2 + i * noteRowH;
        drawCell(r.mat, startX, ry, colMatW, noteRowH, { fontSize: 5.5, align: 'left' });
        r.v.forEach((val, j) => drawCell(String(val), startX + colMatW + j * colChW, ry, colChW, noteRowH, { fontSize: 5.5 }));
      });
    };

    const blk1X = margin; const colNote = 12.5; const colDesc = 32;
    drawCell('หมายเหตุ', blk1X, legendY, colNote, noteRowH, { fill: hFillLegend, bold: true, fontSize: 5.5 });
    drawCell('คำจำกัดความ', blk1X + colNote, legendY, colDesc, noteRowH, { fill: hFillLegend, bold: true, fontSize: 5.5 });
    [{ note: 'ช่วงที่ 1', desc: 'เตรียมเสร็จ - เข้าห้องเย็น' }, { note: 'ช่วงที่ 2', desc: 'เข้าห้องเย็น - ออกห้องเย็น' }, { note: 'ช่วงที่ 3', desc: 'ออกห้องเย็น - บรรจุเสร็จ' }, { note: 'ช่วงที่ 4', desc: 'เตรียมเสร็จ - บรรจุเสร็จ' }]
      .forEach((r, i) => { const ry = legendY + noteRowH + i * noteRowH; drawCell(r.note, blk1X, ry, colNote, noteRowH, { fontSize: 5.5 }); drawCell(r.desc, blk1X + colNote, ry, colDesc, noteRowH, { fontSize: 5.5, align: 'left' }); });
    const blk2X = blk1X + colNote + colDesc + 4;
    drawMatTable2(blk2X, legendY, 28, 5, [
      { mat: 'เนื้อสัตว์ (วัว/ เป็ด/ แกะ)', v: [3, 9, 2, 5] }, { mat: 'เนื้อไก่ (ไก่/ ไก่งวง)', v: [2, 5, 2, 4] },
      { mat: 'ปลาแกะ (MK/ SE/ SD)', v: [3, 6, 2, 5] }, { mat: 'ปลาแกะ (TN/ SM)', v: [5, 6, 2, 7] },
      { mat: 'Shelf fish (กุ้ง/ ปลาหมึก/ หอย)', v: [2, 8, 2, 4] }, { mat: 'เลือดทูน่า/ เศษทูน่า', v: [2, 4, 2, 4] },
    ]);
    const blk3X = blk2X + 28 + 5 * 4 + 4;
    drawMatTable2(blk3X, legendY, 38, 5, [
      { mat: 'ปลาสับสด/ เนื้อไก่สด', v: [1, 6, 1, 2] }, { mat: 'ผัก-ผลไม้สด/ ผัก+ผลไม้แช่/ ผัก+ผลไม้ต้มแช่', v: [2, 10, 2, 4] },
      { mat: 'ผักต้ม/ ลวก/ ฟักทองต้ม', v: [2, 6, 2, 4] }, { mat: 'ปลากระตัก/ ปลาข้าวสาร', v: [2, 6, 2, 4] },
      { mat: 'ข้าว/ ปลายข้าว', v: [2, 9, 2, 4] }, { mat: 'น้ำอบไก่/ น้ำอบ MDM', v: [1, '-', '-', '-'] },
    ]);
    const blk4X = blk3X + 38 + 5 * 4 + 4;
    drawMatTable2(blk4X, legendY, 27, 5, [
     { mat: 'Chunk (Normal/ Flat/ IJ)', v: [1, 12, 2, 3] }, { mat: 'Stuff Chunk (แท่ง)', v: [2, 48, 3, 5] },
      { mat: 'Stuff Chunk (เส้น)', v: [2, 9, 3, 5] }, { mat: 'CCM/ MDM อบ', v: [3, 3, 2, 5] },
     { mat: 'CCM/ MDM อบ (Can 300)*', v: ['-', '-', '-', 3] }, { mat: 'สาวละสาย/ เกรวี่', v: ['-', 6, '-', 2] },
    ]);

    // ✅ Block 5: Loaf table
    const blk5X = blk4X + 27 + 5 * 4 + 4;
    const loafMatW = 20, loafValW = 13;
    const loafHeaders = ['วัตถุดิบ', 'ช่วงที่ 1', 'ช่วงที่ 2', 'ออกห้องเย็น -\nผสมเสร็จ', 'ผสมเสร็จ -\nบรรจุเสร็จ'];
    const loafWidths = [loafMatW, loafValW, loafValW, loafValW, loafValW];
    let loafHX = blk5X;
    loafHeaders.forEach((h, i) => { drawCell(h, loafHX, legendY, loafWidths[i], noteRowH * 2, { fill: hFillLegend, bold: true, fontSize: 5.5 }); loafHX += loafWidths[i]; });
    [
      { mat: 'Loaf (ของสด)', v: [1, 6, 1, 2] },
      { mat: 'Loaf (ของสุก)**', v: ['ตามชนิดวัตถุดิบ', 'ตามชนิดวัตถุดิบ', 1, 2] },
      { mat: 'Loaf sachet', v: ['ตามชนิดวัตถุดิบ', 'ตามชนิดวัตถุดิบ', '1.0', '1.0'] },
      { mat: 'Loaf Mouse', v: ['ตามชนิดวัตถุดิบ', 'ตามชนิดวัตถุดิบ', '1.5', '1.5'] },
    ].forEach((r, i) => {
      const ry = legendY + noteRowH * 2 + i * noteRowH;
      let rx = blk5X;
      drawCell(r.mat, rx, ry, loafWidths[0], noteRowH, { fontSize: 5.5, align: 'left' }); rx += loafWidths[0];
      r.v.forEach((val, j) => { drawCell(String(val), rx, ry, loafWidths[j + 1], noteRowH, { fontSize: 5.5 }); rx += loafWidths[j + 1]; });
    });

    // ✅ Freeze storage note table, stacked below the Loaf table
    const freezeY = legendY + noteRowH * 2 + 4 * noteRowH;
    const freezeWidths = [loafMatW, 20, 32];
    const freezeHeaders = ['วัตถุดิบ', 'ห้อง Freeze (-18c)', 'ออกห้อง Freeze (-18c) - เข้าห้องเย็น PF'];
    let freezeHX = blk5X;
    freezeHeaders.forEach((h, i) => { drawCell(h, freezeHX, freezeY, freezeWidths[i], noteRowH, { fill: hFillLegend, bold: true, fontSize: 4.5 }); freezeHX += freezeWidths[i]; });
    const freezeRow = ['Chunk (Normal/ Flat/ IJ)', '*1 เดือน', '*1 ชั่วโมง'];
    let freezeRX = blk5X;
    freezeRow.forEach((val, i) => { drawCell(val, freezeRX, freezeY + noteRowH, freezeWidths[i], noteRowH, { fontSize: 4.5, align: i === 0 ? 'left' : 'center' }); freezeRX += freezeWidths[i]; });

    const legendBlockH = noteRowH * 2 + 6 * noteRowH;
    const footerY = legendY + legendBlockH + 5;
    drawText('** ปลาแกะ(TN/ SM) ช่วงที่ 1 เวลา 5 ชั่วโมง โดยแบ่งเป็นอบเสร็จ - cooling เสร็จ 2 ชั่วโมง และ Cooling เสร็จ-เข้าห้องเย็น 3 ชั่วโมง',
    blk2X, footerY, { fontSize: 6.5, align: 'left' });
    drawText('*โดยระบุในช่อง Remark', blk5X, freezeY + noteRowH * 2 + 3, { fontSize: 6.5, align: 'left' });
    drawText('เอกสารการควบคุม Delay time:', margin, footerY, { fontSize: 8, align: 'left' });
    drawText('W3QCPF18, SQCIS001/ ISPP018', margin, footerY + 5, { fontSize: 8, align: 'left' });

    const sigY = footerY + 5 + 7;
    [
      { label: 'Recorded by :', name: sigData.recordedBy || '', sub: '(Production Staff)', x: margin + 40, lineWidth: 40 },
      { label: 'Reviewed by :', name: sigData.reviewedBy || '', sub: '(Production Section Manager)', x: pageW / 2, lineWidth: 40 },
      { label: '', name: sigData.qcManager || '', sub: '(Quality Control Section Manager)', x: pageW - margin - 38, lineWidth: 40 },
    ].forEach(({ label, name, sub, x, lineWidth }) => {
      if (label) { const labelWidth = doc.getTextWidth(label); drawText(label, x - lineWidth / 2 - labelWidth - 2, sigY, { fontSize: 8, align: 'left' }); }
      doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2);
      doc.line(x - lineWidth / 2, sigY + 1, x + lineWidth / 2, sigY + 1); doc.setLineWidth(0.5);
      if (name) drawText(name, x, sigY - 0.5, { fontSize: 8, bold: true, align: 'center' });
      drawText(sub, x, sigY + 5, { fontSize: 8, align: 'center' });
    });
  };

  const toDisplay = (v, isSensory = false) => {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return isSensory ? (v ? 'ผ่าน' : 'ไม่ผ่าน') : (v ? '✓' : '✗');
    return String(v);
  };

  const drawCellWithOverFlagMP = (text, rx, ry, w, rowH, opts, isOver) => {
    const overFill = [255, 235, 235];
    const fill = isOver ? overFill : opts.fill;
    drawCell(toDisplay(text), rx, ry, w, rowH, { ...opts, fill });
  };

  const totalPages = Math.ceil(dataRows.length / minRows);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (pageNum > 1) doc.addPage();
    drawPageHeader(pageNum, totalPages);
    drawTableHeader();

    const startIdx = (pageNum - 1) * minRows;
    const endIdx = Math.min(startIdx + minRows, dataRows.length);
    const pageRows = dataRows.slice(startIdx, endIdx);

    pageRows.forEach((row, i) => {
      const ry = tY + headerH + i * rowH;
      const rowFill = i % 2 === 0 ? [255, 255, 255] : [240, 248, 255];
      const sp = !!row.special;
      const over1 = !!row.over1;
      const over2 = !sp && !!row.over2;
      const over3 = !sp && !!row.over3;
      const over4 = !!row.over4;

      let rx = tX;
      const cell = (text, w, opts = {}, isSensory = false) => {
        drawCell(toDisplay(text, isSensory), rx, ry, w, rowH, { fill: rowFill, fontSize: 8, ...opts }); rx += w;
      };
      const cellOver = (text, w, isOver, opts = {}) => {
        drawCellWithOverFlagMP(text, rx, ry, w, rowH, { fill: rowFill, fontSize: 8, ...opts }, isOver); rx += w;
      };
//แก้ไขขนาดตัวอักษร
      cell(row.production, colCode, { fontSize: 4});
      cell(row.mat_name, colRM, { align: 'left', fontSize: 4 });
      const batchStr = String(row.batch ?? '').padEnd(batchCols, ' ');
      for (let b = 0; b < batchCols; b++) cell(batchStr[b] || '', batchCellW, { fontSize: 5 });
      cell(row.weight, colWeight, { align: 'left', fontSize: 4 });
      cell(row.group_no, colGrpNo, { align: 'left', fontSize: 4 });
      cell(formatDateTimeForPDF(row.prep_date), colDate, { fontSize: 5, bold: true });
      cell(row.hist, colHist, { fontSize: 4, bold: true });
      cell(row.color, sensoryCellW, { fontSize: 4 }, true);
      cell(row.odor, sensoryCellW, { fontSize: 4 }, true);
      cell(row.texture, sensoryCellW, { fontSize: 4 }, true);
      cell(formatDateTimeForPDF(row.time_a), colPrepA, { fontSize: 5, bold: true });
      cell(formatDateTimeForPDF(row.time_b), colCold1, { fontSize: 5, bold: true });
      cell(formatDateTimeForPDF(row.time_c), colColdOut1, { fontSize: 5, bold: true });
      cell(sp ? '-' : formatDateTimeForPDF(row.time_d), colCold2, { fontSize: 5, bold: true });
      cell(sp ? '-' : formatDateTimeForPDF(row.time_e), colColdOut2, { fontSize: 5, bold: true });
      cell(formatDateTimeForPDF(row.time_f), colPacked, { fontSize: 5, bold: true });
      cellOver(row.dbs1 || '-', colDBS1, over1, { fontSize: 5, bold: true });
      cellOver(row.dbs2 || '-', colDBS2, over2, { fontSize: 5, bold: true });
      cellOver(row.dbs3 || '-', colDBS3, over3, { fontSize: 5, bold: true });
      cellOver(row.dbs4 || '-', colDBS4, over4, { fontSize: 5, bold: true });
      cell(row.remark ?? '', colRemark, { align: 'left', fontSize: 4 });
    });

    const remainingRows = minRows - pageRows.length;
    for (let e = 0; e < remainingRows; e++) {
      const ry = tY + headerH + (pageRows.length + e) * rowH;
      let rx = tX;
      const emptyCell = (w) => { drawRect(rx, ry, w, rowH); rx += w; };
      [colCode, colRM, ...Array(batchCols).fill(batchCellW), colWeight, colGrpNo, colDate, colHist,
        sensoryCellW, sensoryCellW, sensoryCellW,
        colPrepA, colCold1, colColdOut1, colCold2, colColdOut2, colPacked,
        colDBS1, colDBS2, colDBS3, colDBS4, colRemark].forEach(emptyCell);
    }

    drawPageFooter(sigData);
  }

  return doc;
};
