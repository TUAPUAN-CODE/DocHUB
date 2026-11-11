-- Copies of a file (ทำสำเนา) used to lose the header → lines setting of their sheets (settings_json.lines): the copy of a form like
-- F3QCPF06 had no "รายการตรวจ" column, lines typed in the copy were attached to nothing, and its PDF table stayed empty.
-- For every copy recorded in AuditLog (file_duplicate → sourceFileId) whose sheet has no lines setting while the same-named sheet of the
-- source has one pointing to a sheet of the source file: give the copy's sheet that setting, pointing to the copy's own line sheet
-- (same name), column ids matched by column name. Copies of copies are handled by repeating the pass. Only adds a missing setting;
-- idempotent (a sheet that has a lines setting is never touched).
SET NOCOUNT ON;
DECLARE @pass INT = 0, @done INT = 1;
WHILE @pass < 5 AND @done > 0
BEGIN
  SET @pass += 1; SET @done = 0;
  DECLARE @hs UNIQUEIDENTIFIER, @copyHead UNIQUEIDENTIFIER, @srcLines NVARCHAR(MAX), @srcLineSheet UNIQUEIDENTIFIER, @copyLineSheet UNIQUEIDENTIFIER;
  DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT hs.sheet_id, ch.sheet_id, JSON_QUERY(hs.settings_json, '$.lines'), ls.sheet_id, cl.sheet_id
    FROM AuditLog a
    JOIN Files cf ON cf.file_id = TRY_CONVERT(UNIQUEIDENTIFIER, a.entity_id) AND cf.is_deleted = 0
    JOIN Files sf ON sf.file_id = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(a.new_value, '$.sourceFileId'))
    JOIN Sheets hs ON hs.file_id = sf.file_id AND hs.is_deleted = 0 AND ISJSON(hs.settings_json) = 1 AND JSON_QUERY(hs.settings_json, '$.lines') IS NOT NULL
    JOIN Sheets ls ON ls.sheet_id = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(hs.settings_json, '$.lines.lineSheetId')) AND ls.file_id = sf.file_id
    JOIN Sheets ch ON ch.file_id = cf.file_id AND ch.is_deleted = 0 AND ch.sheet_name = hs.sheet_name
    JOIN Sheets cl ON cl.file_id = cf.file_id AND cl.is_deleted = 0 AND cl.sheet_name = ls.sheet_name
    WHERE a.action_type = N'file_duplicate' AND ISJSON(a.new_value) = 1
      AND (ch.settings_json IS NULL OR ISJSON(ch.settings_json) = 0 OR JSON_QUERY(ch.settings_json, '$.lines') IS NULL);
  OPEN c;
  FETCH NEXT FROM c INTO @hs, @copyHead, @srcLines, @srcLineSheet, @copyLineSheet;
  WHILE @@FETCH_STATUS = 0
  BEGIN
    -- the copy may have been handled already in this pass (two audit rows for one copy)
    IF NOT EXISTS (SELECT 1 FROM Sheets WHERE sheet_id = @copyHead AND ISJSON(settings_json) = 1 AND JSON_QUERY(settings_json, '$.lines') IS NOT NULL)
    BEGIN
      DECLARE @lines NVARCHAR(MAX) = JSON_MODIFY(@srcLines, '$.lineSheetId', LOWER(CONVERT(NVARCHAR(36), @copyLineSheet)));
      -- display columns: same column names in the copy's line sheet
      IF JSON_QUERY(@srcLines, '$.displayColumnIds') IS NOT NULL
      BEGIN
        DECLARE @disp NVARCHAR(MAX) = (
          SELECT N'[' + ISNULL(STRING_AGG(N'"' + LOWER(CONVERT(NVARCHAR(36), c2.column_id)) + N'"', N',') WITHIN GROUP (ORDER BY TRY_CONVERT(INT, d.[key])), N'') + N']'
          FROM OPENJSON(@srcLines, '$.displayColumnIds') d
          JOIN Columns c1 ON c1.column_id = TRY_CONVERT(UNIQUEIDENTIFIER, d.[value]) AND c1.sheet_id = @srcLineSheet
          JOIN Columns c2 ON c2.sheet_id = @copyLineSheet AND c2.is_deleted = 0 AND c2.column_name = c1.column_name);
        SET @lines = JSON_MODIFY(@lines, '$.displayColumnIds', JSON_QUERY(ISNULL(@disp, N'[]')));
      END;
      -- actions (one button for all lines): their column by name
      IF JSON_QUERY(@srcLines, '$.actions') IS NOT NULL
      BEGIN
        DECLARE @acts NVARCHAR(MAX) = (
          SELECT JSON_VALUE(x.[value], '$.label') AS label, LOWER(CONVERT(NVARCHAR(36), c2.column_id)) AS columnId,
                 JSON_VALUE(x.[value], '$.kind') AS kind, JSON_VALUE(x.[value], '$.value') AS value
          FROM OPENJSON(@srcLines, '$.actions') x
          JOIN Columns c1 ON c1.column_id = TRY_CONVERT(UNIQUEIDENTIFIER, JSON_VALUE(x.[value], '$.columnId')) AND c1.sheet_id = @srcLineSheet
          JOIN Columns c2 ON c2.sheet_id = @copyLineSheet AND c2.is_deleted = 0 AND c2.column_name = c1.column_name
          ORDER BY TRY_CONVERT(INT, x.[key])
          FOR JSON PATH, INCLUDE_NULL_VALUES);
        SET @lines = JSON_MODIFY(@lines, '$.actions', JSON_QUERY(ISNULL(@acts, N'[]')));
      END;
      UPDATE Sheets
      SET settings_json = JSON_MODIFY(CASE WHEN ISJSON(settings_json) = 1 THEN settings_json ELSE N'{}' END, '$.lines', JSON_QUERY(@lines)),
          updated_at = SYSUTCDATETIME()
      WHERE sheet_id = @copyHead;
      SET @done += 1;
    END;
    FETCH NEXT FROM c INTO @hs, @copyHead, @srcLines, @srcLineSheet, @copyLineSheet;
  END;
  CLOSE c; DEALLOCATE c;
END;
