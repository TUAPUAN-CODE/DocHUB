-- DocHUB seed: F3QCPF06 (Master Template + every copy) — a new row's form starts with the usual answers so the user types less (all editable):
--   date → today · shift → by the time now (D/S 06:00–17:30, else N/S) · เวลา → the time now · ฝาล็อคหน้าจอ = มีล็อค · Belt stop / Alarm = OK ·
--   Test pieces ครบ = ใช่ · ความถี่ (F) = F3 (the hourly test). Auto-fill = Columns.validation_rule.autoFill (see lib/autoFill.ts);
--   fixed answers = Columns.default_value. Only fills a column that has none yet (never overwrites a default someone set). Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @d TABLE (sheet_name NVARCHAR(100), col NVARCHAR(200), data_type NVARCHAR(30), fill NVARCHAR(10), def NVARCHAR(100));
INSERT INTO @d (sheet_name, col, data_type, fill, def) VALUES
 (N'หัวเอกสาร',  N'วันที่ (Date)',     N'date',         N'today', NULL),
 (N'หัวเอกสาร',  N'กะ (Shift)',        N'select',       N'shift', NULL),
 (N'หัวเอกสาร',  N'ฝาล็อคหน้าจอ',      N'select',       NULL, N'"มีล็อค"'),
 (N'หัวเอกสาร',  N'Belt stop',         N'select',       NULL, N'"OK"'),
 (N'หัวเอกสาร',  N'Alarm',             N'select',       NULL, N'"OK"'),
 (N'หัวเอกสาร',  N'Test pieces ครบ',   N'boolean',      NULL, N'true'),
 (N'รายการตรวจ', N'วันที่ (Date)',     N'date',         N'today', NULL),
 (N'รายการตรวจ', N'กะ (Shift)',        N'select',       N'shift', NULL),
 (N'รายการตรวจ', N'เวลา',              N'varchar',      N'now',   NULL),
 (N'รายการตรวจ', N'ความถี่ (F)',       N'multi_select', NULL, N'["F3"]');

UPDATE c
SET validation_rule = CASE WHEN d.fill IS NULL OR JSON_VALUE(c.validation_rule, '$.autoFill') IS NOT NULL THEN c.validation_rule
                           WHEN c.validation_rule IS NULL OR ISJSON(c.validation_rule) = 0 THEN N'{"autoFill":"' + d.fill + N'"}'
                           ELSE JSON_MODIFY(c.validation_rule, '$.autoFill', d.fill) END,
    default_value = CASE WHEN d.def IS NOT NULL AND c.default_value IS NULL THEN d.def ELSE c.default_value END,
    updated_at = SYSUTCDATETIME()
FROM Columns c
JOIN Sheets s ON s.sheet_id = c.sheet_id AND s.is_deleted = 0
JOIN Files f ON f.file_id = s.file_id AND f.is_deleted = 0
JOIN @d d ON d.sheet_name = s.sheet_name AND d.col = c.column_name AND d.data_type = c.data_type
WHERE c.is_deleted = 0
  AND ((s.sheet_name = N'หัวเอกสาร' AND EXISTS (SELECT 1 FROM Columns x WHERE x.sheet_id = s.sheet_id AND x.is_deleted = 0 AND x.column_name = N'เลขที่ใบตรวจ'))
    OR (s.sheet_name = N'รายการตรวจ' AND EXISTS (SELECT 1 FROM Columns x WHERE x.sheet_id = s.sheet_id AND x.is_deleted = 0 AND x.column_name = N'Result (Detect / Not detect)')))
  AND ((d.fill IS NOT NULL AND JSON_VALUE(c.validation_rule, '$.autoFill') IS NULL) OR (d.def IS NOT NULL AND c.default_value IS NULL));
SELECT N'done' AS result;
