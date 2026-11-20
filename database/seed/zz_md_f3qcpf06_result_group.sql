-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — the seven result columns (Result · รอบ A ครั้งที่ 1/2 · Object · รอบ B ครั้งที่ 1/2/3) form the group
-- "ผลการตรวจ": the row form shows a "set all" bar for them (each column can still be set on its own), and the long legend text
-- (✓ = ผลผ่าน · x = ผลไม่ผ่าน …) is no longer shown under each of them (it stays on the printed form). Master Template + every copy. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
UPDATE c
SET validation_rule = CASE WHEN c.validation_rule IS NULL OR ISJSON(c.validation_rule) = 0 THEN N'{"formGroup":"ผลการตรวจ"}' ELSE JSON_MODIFY(c.validation_rule, '$.formGroup', N'ผลการตรวจ') END,
    description = CASE WHEN c.description LIKE N'%ไม่พบปัญหา%' THEN NULL ELSE c.description END,
    updated_at = SYSUTCDATETIME()
FROM Columns c
JOIN Sheets s ON s.sheet_id = c.sheet_id AND s.is_deleted = 0 AND s.sheet_name = N'รายการตรวจ'
JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
WHERE c.is_deleted = 0 AND c.data_type = N'select'
  AND c.column_name IN (N'Result (Detect / Not detect)', N'รอบ A ครั้งที่ 1', N'รอบ A ครั้งที่ 2', N'Object', N'รอบ B ครั้งที่ 1', N'รอบ B ครั้งที่ 2', N'รอบ B ครั้งที่ 3')
  AND EXISTS (SELECT 1 FROM Columns x WHERE x.sheet_id = s.sheet_id AND x.is_deleted = 0 AND x.column_name = N'Result (Detect / Not detect)')
  AND (JSON_VALUE(c.validation_rule, '$.formGroup') IS NULL OR c.description LIKE N'%ไม่พบปัญหา%');
SELECT N'done' AS result;
