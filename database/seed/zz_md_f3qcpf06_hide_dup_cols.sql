-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — วันที่ (Date) · กะ (Shift) · หมายเลขเครื่อง repeat what the document header ("หัวเอกสาร") already says,
-- so the sheet's grid no longer shows them (Sheets.settings_json.hiddenColumnIds, shared by everybody). The values are still stored on each line
-- (copied from the header when the line is added) and the program drop-down still follows the machine. หมายเลขเครื่อง stops being required
-- there (the header supplies it). Master Template + every copy. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
UPDATE c SET is_required = 0, updated_at = SYSUTCDATETIME()
FROM Columns c JOIN Sheets s ON s.sheet_id = c.sheet_id AND s.is_deleted = 0 AND s.sheet_name = N'รายการตรวจ'
WHERE c.is_deleted = 0 AND c.is_required = 1 AND c.column_name = N'หมายเลขเครื่อง'
  AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = s.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)');

DECLARE @sid UNIQUEIDENTIFIER;
DECLARE cs CURSOR LOCAL FAST_FORWARD FOR
  SELECT l.sheet_id FROM Sheets l JOIN Files f ON f.file_id = l.file_id AND f.is_deleted = 0
  WHERE l.is_deleted = 0 AND l.sheet_name = N'รายการตรวจ'
    AND (l.settings_json IS NULL OR ISJSON(l.settings_json) = 0 OR JSON_QUERY(l.settings_json, '$.hiddenColumnIds') IS NULL)
    AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = l.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)');
OPEN cs; FETCH NEXT FROM cs INTO @sid;
WHILE @@FETCH_STATUS = 0
BEGIN
  DECLARE @ids NVARCHAR(MAX) = (SELECT N'[' + STRING_AGG(N'"' + LOWER(CONVERT(NVARCHAR(36), column_id)) + N'"', N',') + N']'
                                FROM Columns WHERE sheet_id = @sid AND is_deleted = 0 AND column_name IN (N'วันที่ (Date)', N'กะ (Shift)', N'หมายเลขเครื่อง'));
  IF @ids IS NOT NULL
    UPDATE Sheets SET settings_json = CASE WHEN settings_json IS NULL OR ISJSON(settings_json) = 0 THEN N'{"hiddenColumnIds":' + @ids + N'}' ELSE JSON_MODIFY(settings_json, '$.hiddenColumnIds', JSON_QUERY(@ids)) END,
                      updated_at = SYSUTCDATETIME() WHERE sheet_id = @sid;
  FETCH NEXT FROM cs INTO @sid;
END
CLOSE cs; DEALLOCATE cs;
SELECT N'done' AS result;
