-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — the column เวลา is typed with a time picker (HH:mm) instead of free text
-- (Columns.validation_rule.inputAs = 'time'; the value is still stored as HH.mm like 19.50, so old rows, the pattern check and the PDF are unchanged).
-- Master Template + every copy. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
UPDATE c
SET validation_rule = CASE WHEN c.validation_rule IS NULL OR ISJSON(c.validation_rule) = 0 THEN N'{"inputAs":"time"}' ELSE JSON_MODIFY(c.validation_rule, '$.inputAs', N'time') END,
    updated_at = SYSUTCDATETIME()
FROM Columns c
JOIN Sheets s ON s.sheet_id = c.sheet_id AND s.is_deleted = 0 AND s.sheet_name = N'รายการตรวจ'
JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
WHERE c.is_deleted = 0 AND c.column_name = N'เวลา' AND c.data_type = N'varchar' AND JSON_VALUE(c.validation_rule, '$.inputAs') IS NULL
  AND EXISTS (SELECT 1 FROM Columns x WHERE x.sheet_id = s.sheet_id AND x.is_deleted = 0 AND x.column_name = N'Result (Detect / Not detect)');
SELECT N'done' AS result;
