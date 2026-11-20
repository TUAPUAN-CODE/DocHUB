-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — scan the DelayHUB slip QR in the row form ("เพิ่มรายการ" → scan bar):
--   "14L300000115 | ANT80A29LH | ANT80A29LH | 826982 | 180 | kg | PFCM"  (HU | Batch | Batch 2X | mapping_id | weight | unit | plant)
-- piece 2 → Batch, piece 3 → Batch 2X (as printed); piece 4 = mapping_id → DelayHUB (GET /api/export/mapping/:id, DELAYHUB_URL + DELAYHUB_EXPORT_KEY
-- in DocHUB's .env) fills Code (product code) · วัตถุดิบ (mat) · วัตถุดิบ 2X (mat 2X); what the QR carries wins over DelayHUB's value.
-- Master Template + every copy; only a sheet that has no scan formats yet. Idempotent.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;
DECLARE @sid UNIQUEIDENTIFIER;
DECLARE cs CURSOR LOCAL FAST_FORWARD FOR
  SELECT l.sheet_id FROM Sheets l JOIN Files f ON f.file_id = l.file_id AND f.is_deleted = 0
  WHERE l.is_deleted = 0 AND l.sheet_name = N'รายการตรวจ'
    AND (l.settings_json IS NULL OR ISJSON(l.settings_json) = 0 OR JSON_QUERY(l.settings_json, '$.scanProfiles') IS NULL)
    AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = l.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)')
    AND (SELECT COUNT(*) FROM Columns x WHERE x.sheet_id = l.sheet_id AND x.is_deleted = 0 AND x.column_name IN (N'Code', N'วัตถุดิบ', N'วัตถุดิบ 2X', N'Batch', N'Batch 2X')) = 5;
OPEN cs; FETCH NEXT FROM cs INTO @sid;
WHILE @@FETCH_STATUS = 0
BEGIN
  DECLARE @code NVARCHAR(36), @mat NVARCHAR(36), @mat2 NVARCHAR(36), @bat NVARCHAR(36), @bat2 NVARCHAR(36);
  SELECT @code = MAX(CASE WHEN column_name = N'Code' THEN LOWER(CONVERT(NVARCHAR(36), column_id)) END),
         @mat  = MAX(CASE WHEN column_name = N'วัตถุดิบ' THEN LOWER(CONVERT(NVARCHAR(36), column_id)) END),
         @mat2 = MAX(CASE WHEN column_name = N'วัตถุดิบ 2X' THEN LOWER(CONVERT(NVARCHAR(36), column_id)) END),
         @bat  = MAX(CASE WHEN column_name = N'Batch' THEN LOWER(CONVERT(NVARCHAR(36), column_id)) END),
         @bat2 = MAX(CASE WHEN column_name = N'Batch 2X' THEN LOWER(CONVERT(NVARCHAR(36), column_id)) END)
  FROM Columns WHERE sheet_id = @sid AND is_deleted = 0;
  DECLARE @profiles NVARCHAR(MAX) = N'[{"id":"slip","name":"สลีป DelayHUB","delimiter":" | ","match":{"fieldCount":7},"fields":[{"index":2,"columnId":"' + @bat + N'"},{"index":3,"columnId":"' + @bat2 + N'"}],"action":"create","external":{"source":"delayhub_mapping","pieceIndex":4,"fill":[{"field":"code","toColumnId":"' + @code + N'"},{"field":"mat","toColumnId":"' + @mat + N'"},{"field":"mat_2x","toColumnId":"' + @mat2 + N'"},{"field":"batch","toColumnId":"' + @bat + N'"},{"field":"batch_2x","toColumnId":"' + @bat2 + N'"}],"onMiss":"reject"}}]';
  UPDATE Sheets SET settings_json = CASE WHEN settings_json IS NULL OR ISJSON(settings_json) = 0 THEN N'{"scanProfiles":' + @profiles + N'}' ELSE JSON_MODIFY(settings_json, '$.scanProfiles', JSON_QUERY(@profiles)) END, updated_at = SYSUTCDATETIME() WHERE sheet_id = @sid;
  FETCH NEXT FROM cs INTO @sid;
END
CLOSE cs; DEALLOCATE cs;
SELECT N'done' AS result;
