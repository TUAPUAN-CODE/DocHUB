-- DocHUB seed: F3QCPF06 line sheet "รายการตรวจ" — the column "Code / วัตถุดิบ / Batch no." is split into five columns:
-- Code · วัตถุดิบ · วัตถุดิบ 2X · Batch · Batch 2X. Applies to the Master Template and every copy (daily files) on this server.
-- Old values are NOT parsed: the old column is soft-deleted (restorable from the sheet's trash) and the new ones start empty.
-- For each such sheet: new columns take the old one's place (later columns shift right) · the lines entry form (header sheet settings_json.lines
-- .displayColumnIds) shows the five instead of the old one · dashboard widgets that read the old column read "Code" · the Excel-A4 PDF layout
-- (Files.pdf_templates, original and copies) prints the five columns with their group header widened. Idempotent: skips sheets that already
-- have "Batch 2X". Hand-written (not generated): the older F3QCPF06 seeds stay as they were and are fixed up by this one.
SET NOCOUNT ON;
SET QUOTED_IDENTIFIER ON;

DECLARE @old NVARCHAR(200) = N'Code / วัตถุดิบ / Batch no.';
DECLARE @names TABLE (n INT, name NVARCHAR(200), w INT);
INSERT INTO @names (n, name, w) VALUES (0, N'Code', 90), (1, N'วัตถุดิบ', 150), (2, N'วัตถุดิบ 2X', 150), (3, N'Batch', 120), (4, N'Batch 2X', 120);

DECLARE @sid UNIQUEIDENTIFIER, @fid UNIQUEIDENTIFIER, @oldId UNIQUEIDENTIFIER, @ord INT, @by UNIQUEIDENTIFIER;
DECLARE cs CURSOR LOCAL FAST_FORWARD FOR
  SELECT l.sheet_id, l.file_id, o.column_id, o.display_order, o.created_by
  FROM Sheets l
  JOIN Files f ON f.file_id = l.file_id AND f.is_deleted = 0
  JOIN Columns o ON o.sheet_id = l.sheet_id AND o.is_deleted = 0 AND o.column_name = @old
  WHERE l.is_deleted = 0 AND l.sheet_name = N'รายการตรวจ'
    AND EXISTS (SELECT 1 FROM Columns r WHERE r.sheet_id = l.sheet_id AND r.is_deleted = 0 AND r.column_name = N'Result (Detect / Not detect)')
    AND NOT EXISTS (SELECT 1 FROM Columns b WHERE b.sheet_id = l.sheet_id AND b.is_deleted = 0 AND b.column_name = N'Batch 2X');
OPEN cs;
FETCH NEXT FROM cs INTO @sid, @fid, @oldId, @ord, @by;
WHILE @@FETCH_STATUS = 0
BEGIN
  BEGIN TRAN;
  -- names that exist already (deleted or not) would clash with the sheet's unique names: skip such a sheet
  IF NOT EXISTS (SELECT 1 FROM Columns c JOIN @names x ON x.name = c.column_name WHERE c.sheet_id = @sid AND c.is_deleted = 0)
  BEGIN
    UPDATE Columns SET display_order = display_order + 4, updated_at = SYSUTCDATETIME() WHERE sheet_id = @sid AND is_deleted = 0 AND display_order > @ord;
    DECLARE @ids TABLE (n INT, id UNIQUEIDENTIFIER);
    DELETE FROM @ids;
    INSERT INTO @ids (n, id) SELECT n, NEWID() FROM @names;
    INSERT INTO Columns (column_id, sheet_id, column_name, data_type, display_order, width, created_by)
    SELECT i.id, @sid, x.name, N'varchar', @ord + x.n, x.w, @by FROM @ids i JOIN @names x ON x.n = i.n;
    UPDATE Columns SET is_deleted = 1, deleted_at = SYSUTCDATETIME() WHERE column_id = @oldId;

    DECLARE @five NVARCHAR(MAX) = (SELECT STRING_AGG(N'"' + LOWER(CONVERT(NVARCHAR(36), id)) + N'"', N',') WITHIN GROUP (ORDER BY n) FROM @ids);
    DECLARE @code NVARCHAR(36) = (SELECT LOWER(CONVERT(NVARCHAR(36), id)) FROM @ids WHERE n = 0);
    DECLARE @oldTxt NVARCHAR(36) = LOWER(CONVERT(NVARCHAR(36), @oldId));

    -- lines entry form of the header sheet(s) that point to this line sheet
    DECLARE @hs UNIQUEIDENTIFIER;
    DECLARE ch CURSOR LOCAL FAST_FORWARD FOR
      SELECT h.sheet_id FROM Sheets h
      WHERE h.file_id = @fid AND h.is_deleted = 0 AND ISJSON(h.settings_json) = 1 AND JSON_VALUE(h.settings_json, '$.lines.lineSheetId') = LOWER(CONVERT(NVARCHAR(36), @sid));
    OPEN ch; FETCH NEXT FROM ch INTO @hs;
    WHILE @@FETCH_STATUS = 0
    BEGIN
      DECLARE @disp NVARCHAR(MAX) = (
        SELECT N'[' + STRING_AGG(CASE WHEN LOWER(d.[value]) = @oldTxt THEN @five ELSE N'"' + d.[value] + N'"' END, N',') WITHIN GROUP (ORDER BY TRY_CONVERT(INT, d.[key])) + N']'
        FROM Sheets h2 CROSS APPLY OPENJSON(h2.settings_json, '$.lines.displayColumnIds') d WHERE h2.sheet_id = @hs);
      IF @disp IS NOT NULL
        UPDATE Sheets SET settings_json = JSON_MODIFY(settings_json, '$.lines.displayColumnIds', JSON_QUERY(@disp)), updated_at = SYSUTCDATETIME() WHERE sheet_id = @hs;
      FETCH NEXT FROM ch INTO @hs;
    END
    CLOSE ch; DEALLOCATE ch;

    -- dashboards of the file: widgets that used the old column read Code now
    UPDATE w SET config = REPLACE(w.config, @oldTxt, @code), data_source = REPLACE(w.data_source, @oldTxt, @code), updated_at = SYSUTCDATETIME()
    FROM DashboardWidgets w JOIN Dashboards d ON d.dashboard_id = w.dashboard_id
    WHERE d.file_id = @fid AND (w.config LIKE N'%' + @oldTxt + N'%' OR w.data_source LIKE N'%' + @oldTxt + N'%');
  END
  COMMIT;
  FETCH NEXT FROM cs INTO @sid, @fid, @oldId, @ord, @by;
END
CLOSE cs; DEALLOCATE cs;

-- PDF layout (original + copies): the old column entry → five; group headers widened by 4; a few widths trimmed to make room
UPDATE Files
SET pdf_templates = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(pdf_templates,
      N'{"columnId":"51a77598-947c-4ce9-b3ac-fd9345854f1d","columnName":"Code / วัตถุดิบ / Batch no.","header":"Code / วัตถุดิบ / Batch no.","widthMm":20,"align":"left"}',
      N'{"columnId":"","columnName":"Code","header":"Code","widthMm":7,"align":"left"},{"columnId":"","columnName":"วัตถุดิบ","header":"วัตถุดิบ","widthMm":9,"align":"left"},{"columnId":"","columnName":"วัตถุดิบ 2X","header":"วัตถุดิบ 2X","widthMm":9,"align":"left"},{"columnId":"","columnName":"Batch","header":"Batch","widthMm":8,"align":"left"},{"columnId":"","columnName":"Batch 2X","header":"Batch 2X","widthMm":8,"align":"left"}'),
      N'"span":12}]', N'"span":16}]'),
      N'{"label":"โปรแกรม","span":1},{"label":"","span":1},{"label":"","span":1},{"label":"ผลผ่าน (รอบ A)"', N'{"label":"โปรแกรม","span":1},{"label":"","span":5},{"label":"","span":1},{"label":"ผลผ่าน (รอบ A)"'),
      N'"header":"/ Sensitivity","widthMm":24', N'"header":"/ Sensitivity","widthMm":18'),
      N'"header":"Result (Detect / Not detect)","widthMm":11', N'"header":"Result (Detect / Not detect)","widthMm":10'),
      N'"header":"Checked By","widthMm":12', N'"header":"Checked By","widthMm":11'),
    updated_at = SYSUTCDATETIME()
WHERE is_deleted = 0 AND pdf_templates LIKE N'%f3qcpf06-excel-a4-portrait%' AND pdf_templates LIKE N'%"columnName":"Code / วัตถุดิบ / Batch no."%';
SELECT N'done' AS result;
