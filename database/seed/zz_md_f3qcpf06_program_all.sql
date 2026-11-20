-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — the drop-down โปรแกรม / Sensitivity lists EVERY program (all machines, all plants) instead of only
-- the programs of the machine chosen in the row (the lookup's "parent" link to หมายเลขเครื่อง is removed). The description of the column says so.
-- Master Template + every copy. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
UPDATE c
SET validation_rule = JSON_MODIFY(c.validation_rule, '$.lookup.parent', NULL),
    description = CASE WHEN c.description LIKE N'%เฉพาะเครื่องที่เลือก%' THEN N'ตัวเลือกจากตาราง Program และค่า Sensitivity (ทุกโปรแกรม)' ELSE c.description END,
    updated_at = SYSUTCDATETIME()
FROM Columns c
JOIN Sheets s ON s.sheet_id = c.sheet_id AND s.is_deleted = 0 AND s.sheet_name = N'รายการตรวจ'
JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
WHERE c.is_deleted = 0 AND c.column_name = N'โปรแกรม / Sensitivity' AND c.data_type = N'select'
  AND ISJSON(c.validation_rule) = 1 AND JSON_QUERY(c.validation_rule, '$.lookup.parent') IS NOT NULL
  AND EXISTS (SELECT 1 FROM Columns x WHERE x.sheet_id = s.sheet_id AND x.is_deleted = 0 AND x.column_name = N'Result (Detect / Not detect)');
SELECT N'done' AS result;
