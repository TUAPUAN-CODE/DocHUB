-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" gets a "Line" column (drop-down of the factory's production lines, same names as the Delay report):
-- after หมายเลขเครื่อง in the sheet, first in the lines entry form, and printed in the Excel-A4 PDF right after เวลา (widths of a few columns trimmed).
-- Applies to the Master Template and every copy; skips a sheet that has a "Line" column already. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @opts NVARCHAR(MAX) = N'[{"value":"Auto A","label":"Auto A","color":null},{"value":"Auto B","label":"Auto B","color":null},{"value":"Auto B+C","label":"Auto B+C","color":null},{"value":"Auto C","label":"Auto C","color":null},{"value":"Auto C+D","label":"Auto C+D","color":null},{"value":"Auto D","label":"Auto D","color":null},{"value":"Auto E","label":"Auto E","color":null},{"value":"Auto F","label":"Auto F","color":null},{"value":"Big Spout","label":"Big Spout","color":null},{"value":"Can B","label":"Can B","color":null},{"value":"Can C","label":"Can C","color":null},{"value":"Can D","label":"Can D","color":null},{"value":"Can E","label":"Can E","color":null},{"value":"Can F","label":"Can F","color":null},{"value":"Can H","label":"Can H","color":null},{"value":"Can J","label":"Can J","color":null},{"value":"Can K","label":"Can K","color":null},{"value":"Can P","label":"Can P","color":null},{"value":"Can R","label":"Can R","color":null},{"value":"Can T","label":"Can T","color":null},{"value":"Can U","label":"Can U","color":null},{"value":"Can Y","label":"Can Y","color":null},{"value":"Can Z","label":"Can Z","color":null},{"value":"Cup1","label":"Cup1","color":null},{"value":"Cup2","label":"Cup2","color":null},{"value":"Cup3","label":"Cup3","color":null},{"value":"Cup4","label":"Cup4","color":null},{"value":"Cup5","label":"Cup5","color":null},{"value":"Cup6","label":"Cup6","color":null},{"value":"Cup7","label":"Cup7","color":null},{"value":"Cup8","label":"Cup8","color":null},{"value":"Cup9","label":"Cup9","color":null},{"value":"Cup10","label":"Cup10","color":null},{"value":"Cup11","label":"Cup11","color":null},{"value":"Cup12","label":"Cup12","color":null},{"value":"Cup13","label":"Cup13","color":null},{"value":"Cup 14","label":"Cup 14","color":null},{"value":"FD","label":"FD","color":null},{"value":"Pouch Jerky","label":"Pouch Jerky","color":null},{"value":"Pouch PF1","label":"Pouch PF1","color":null},{"value":"Pouch PF2","label":"Pouch PF2","color":null},{"value":"Pouch Sachet","label":"Pouch Sachet","color":null},{"value":"Pouch Spout 1","label":"Pouch Spout 1","color":null},{"value":"Pouch Spout 2","label":"Pouch Spout 2","color":null},{"value":"Pouch Spout 3","label":"Pouch Spout 3","color":null},{"value":"Pouch VS","label":"Pouch VS","color":null}]';
DECLARE @sid UNIQUEIDENTIFIER, @fid UNIQUEIDENTIFIER, @ord INT, @by UNIQUEIDENTIFIER;
DECLARE cs CURSOR LOCAL FAST_FORWARD FOR
  SELECT l.sheet_id, l.file_id, m.display_order, m.created_by
  FROM Sheets l
  JOIN Files f ON f.file_id = l.file_id AND f.is_deleted = 0
  JOIN Columns m ON m.sheet_id = l.sheet_id AND m.is_deleted = 0 AND m.column_name = N'หมายเลขเครื่อง'
  WHERE l.is_deleted = 0 AND l.sheet_name = N'รายการตรวจ'
    AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = l.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)')
    AND NOT EXISTS (SELECT 1 FROM Columns b WHERE b.sheet_id = l.sheet_id AND b.column_name = N'Line');
OPEN cs;
FETCH NEXT FROM cs INTO @sid, @fid, @ord, @by;
WHILE @@FETCH_STATUS = 0
BEGIN
  BEGIN TRAN;
  UPDATE Columns SET display_order = display_order + 1, updated_at = SYSUTCDATETIME() WHERE sheet_id = @sid AND is_deleted = 0 AND display_order > @ord;
  DECLARE @new UNIQUEIDENTIFIER = NEWID();
  INSERT INTO Columns (column_id, sheet_id, column_name, data_type, display_order, width, select_options, created_by)
  VALUES (@new, @sid, N'Line', N'select', @ord + 1, 120, @opts, @by);
  DECLARE @hs UNIQUEIDENTIFIER;
  DECLARE ch CURSOR LOCAL FAST_FORWARD FOR
    SELECT h.sheet_id FROM Sheets h
    WHERE h.file_id = @fid AND h.is_deleted = 0 AND ISJSON(h.settings_json) = 1 AND JSON_VALUE(h.settings_json, '$.lines.lineSheetId') = LOWER(CONVERT(NVARCHAR(36), @sid))
      AND JSON_QUERY(h.settings_json, '$.lines.displayColumnIds') IS NOT NULL;
  OPEN ch; FETCH NEXT FROM ch INTO @hs;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    UPDATE Sheets SET settings_json = JSON_MODIFY(settings_json, '$.lines.displayColumnIds', JSON_QUERY(N'["' + LOWER(CONVERT(NVARCHAR(36), @new)) + N'",' + SUBSTRING(JSON_QUERY(settings_json, '$.lines.displayColumnIds'), 2, 100000))), updated_at = SYSUTCDATETIME() WHERE sheet_id = @hs;
    FETCH NEXT FROM ch INTO @hs;
  END
  CLOSE ch; DEALLOCATE ch;
  COMMIT;
  FETCH NEXT FROM cs INTO @sid, @fid, @ord, @by;
END
CLOSE cs; DEALLOCATE cs;

-- PDF layout (original + copies): Line column right after เวลา; its group headers widened by 1; widths trimmed to make room
UPDATE Files
SET pdf_templates = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(pdf_templates,
      N'"columnName":"เวลา","header":"เวลา","widthMm":9.5,"align":"center","timeOnly":true}',
      N'"columnName":"เวลา","header":"เวลา","widthMm":9.5,"align":"center","timeOnly":true},{"columnId":"","columnName":"Line","header":"Line","widthMm":9,"align":"left"}'),
      N'"span":7},{"label":"การตรวจจับ', N'"span":8},{"label":"การตรวจจับ'),
      N'"columnName":"โปรแกรม / Sensitivity","header":"/ Sensitivity","widthMm":18', N'"columnName":"โปรแกรม / Sensitivity","header":"/ Sensitivity","widthMm":15'),
      N'"columnName":"Large test piece","header":"Large test piece","widthMm":8', N'"columnName":"Large test piece","header":"Large test piece","widthMm":7'),
      N'"columnName":"ความถี่ (F)","header":"(F)","widthMm":9', N'"columnName":"ความถี่ (F)","header":"(F)","widthMm":8'),
      N'"columnName":"Object","header":"Object","widthMm":9.5', N'"columnName":"Object","header":"Object","widthMm":8.5'),
    updated_at = SYSUTCDATETIME()
WHERE is_deleted = 0 AND pdf_templates LIKE N'%f3qcpf06-excel-a4-portrait%' AND pdf_templates NOT LIKE N'%"columnName":"Line"%'
  AND pdf_templates LIKE N'%"columnName":"เวลา","header":"เวลา","widthMm":9.5,"align":"center","timeOnly":true}%';
-- second header row: the first (blank) group covers เวลา + Line now
UPDATE Files
SET pdf_templates = REPLACE(pdf_templates, N'],[{"label":"","span":1},{"label":"ผลการทดสอบ","span":4}', N'],[{"label":"","span":2},{"label":"ผลการทดสอบ","span":4}'),
    updated_at = SYSUTCDATETIME()
WHERE is_deleted = 0 AND pdf_templates LIKE N'%f3qcpf06-excel-a4-portrait%' AND pdf_templates LIKE N'%"columnName":"Line"%'
  AND CHARINDEX(N'],[{"label":"","span":1},{"label":"ผลการทดสอบ","span":4}', pdf_templates) > 0;
SELECT N'done' AS result;
