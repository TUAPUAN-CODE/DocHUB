-- DocHUB seed: takes the "Line" column back out of the F3QCPF06 line sheet "รายการตรวจ" (added by zz_md_f3qcpf06_line.sql; owner's request).
-- Master Template + every copy: the column is soft-deleted (restorable from the sheet's trash), removed from the lines entry form, and the
-- Excel-A4 PDF layout goes back to its widths without it. Idempotent. Keep zz_md_f3qcpf06_line.sql: it stays in the history of applied seeds.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @sid UNIQUEIDENTIFIER, @fid UNIQUEIDENTIFIER, @cid UNIQUEIDENTIFIER;
DECLARE cs CURSOR LOCAL FAST_FORWARD FOR
  SELECT l.sheet_id, l.file_id, c.column_id
  FROM Sheets l
  JOIN Files f ON f.file_id = l.file_id AND f.is_deleted = 0
  JOIN Columns c ON c.sheet_id = l.sheet_id AND c.is_deleted = 0 AND c.column_name = N'Line' AND c.data_type = N'select'
  WHERE l.is_deleted = 0 AND l.sheet_name = N'รายการตรวจ'
    AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = l.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)');
OPEN cs;
FETCH NEXT FROM cs INTO @sid, @fid, @cid;
WHILE @@FETCH_STATUS = 0
BEGIN
  BEGIN TRAN;
  UPDATE Columns SET is_deleted = 1, deleted_at = SYSUTCDATETIME() WHERE column_id = @cid;
  DECLARE @hs UNIQUEIDENTIFIER;
  DECLARE ch CURSOR LOCAL FAST_FORWARD FOR
    SELECT h.sheet_id FROM Sheets h
    WHERE h.file_id = @fid AND h.is_deleted = 0 AND ISJSON(h.settings_json) = 1 AND JSON_VALUE(h.settings_json, '$.lines.lineSheetId') = LOWER(CONVERT(NVARCHAR(36), @sid))
      AND JSON_QUERY(h.settings_json, '$.lines.displayColumnIds') IS NOT NULL;
  OPEN ch; FETCH NEXT FROM ch INTO @hs;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    DECLARE @disp NVARCHAR(MAX) = (
      SELECT N'[' + ISNULL(STRING_AGG(N'"' + d.[value] + N'"', N',') WITHIN GROUP (ORDER BY TRY_CONVERT(INT, d.[key])), N'') + N']'
      FROM Sheets h2 CROSS APPLY OPENJSON(h2.settings_json, '$.lines.displayColumnIds') d
      WHERE h2.sheet_id = @hs AND LOWER(d.[value]) <> LOWER(CONVERT(NVARCHAR(36), @cid)));
    UPDATE Sheets SET settings_json = JSON_MODIFY(settings_json, '$.lines.displayColumnIds', JSON_QUERY(ISNULL(@disp, N'[]'))), updated_at = SYSUTCDATETIME() WHERE sheet_id = @hs;
    FETCH NEXT FROM ch INTO @hs;
  END
  CLOSE ch; DEALLOCATE ch;
  COMMIT;
  FETCH NEXT FROM cs INTO @sid, @fid, @cid;
END
CLOSE cs; DEALLOCATE cs;

-- PDF layout (original + copies): Line column out again, group headers and widths back
UPDATE Files
SET pdf_templates = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(pdf_templates,
      N',{"columnId":"","columnName":"Line","header":"Line","widthMm":9,"align":"left"}', N''),
      N'"span":8},{"label":"การตรวจจับ', N'"span":7},{"label":"การตรวจจับ'),
      N'"columnName":"โปรแกรม / Sensitivity","header":"/ Sensitivity","widthMm":15', N'"columnName":"โปรแกรม / Sensitivity","header":"/ Sensitivity","widthMm":18'),
      N'"columnName":"Large test piece","header":"Large test piece","widthMm":7', N'"columnName":"Large test piece","header":"Large test piece","widthMm":8'),
      N'"columnName":"ความถี่ (F)","header":"(F)","widthMm":8', N'"columnName":"ความถี่ (F)","header":"(F)","widthMm":9'),
      N'"columnName":"Object","header":"Object","widthMm":8.5', N'"columnName":"Object","header":"Object","widthMm":9.5'),
      N'],[{"label":"","span":2},{"label":"ผลการทดสอบ","span":4}', N'],[{"label":"","span":1},{"label":"ผลการทดสอบ","span":4}'),
    updated_at = SYSUTCDATETIME()
WHERE is_deleted = 0 AND CHARINDEX(N'"columnName":"Line","header":"Line"', pdf_templates) > 0;
SELECT N'done' AS result;
