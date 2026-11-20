-- DocHUB seed: F3QCPF06 header sheet "หัวเอกสาร" keeps ONE row (1 file = 1 document; a new document = ทำสำเนาไฟล์). Sets Sheets.settings_json.singleRow = true
-- on the header sheet of the Master Template and every copy (the server then refuses a 2nd row; the sheet hides เพิ่มแถว / นำเข้า once it has its row).
-- A header that already has more than one row is left alone (nothing is deleted). Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
UPDATE h
SET settings_json = CASE WHEN h.settings_json IS NULL OR ISJSON(h.settings_json) = 0 THEN N'{"singleRow":true}' ELSE JSON_MODIFY(h.settings_json, '$.singleRow', CAST(1 AS BIT)) END,
    updated_at = SYSUTCDATETIME()
FROM Sheets h
JOIN Files f ON f.file_id = h.file_id AND f.is_deleted = 0
WHERE h.is_deleted = 0 AND h.sheet_name = N'หัวเอกสาร'
  AND EXISTS (SELECT 1 FROM Columns c WHERE c.sheet_id = h.sheet_id AND c.is_deleted = 0 AND c.column_name = N'เลขที่ใบตรวจ')
  AND (h.settings_json IS NULL OR ISJSON(h.settings_json) = 0 OR JSON_VALUE(h.settings_json, '$.singleRow') IS NULL)
  AND (SELECT COUNT(*) FROM Rows r WHERE r.sheet_id = h.sheet_id AND r.is_deleted = 0) <= 1;
SELECT N'done' AS result;
