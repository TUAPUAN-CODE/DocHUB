-- DataSheet Pro — Step 30.
-- (1) "รับทราบ" of the records widget (Quality Highlight): which employee read which item, when — and the daily summary.
-- (2) Quality Highlight dashboards redesigned: the Rev panel goes, the search card takes the whole width with coloured boxes, a
--     detail view and the รับทราบ button; "Quality Highlight" is renamed "Quality Highlight Line"; Incoming searches every column.
--     Done only while the old Rev panel is still there (a dashboard edited afterwards is never touched again).
-- (3) Bone "ก้างแต่ละส่วน แยกกะ": a palette whose colours are far apart, only while the chart still has the old palette.
-- Idempotent.
IF OBJECT_ID(N'dbo.WidgetAcks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.WidgetAcks (
        ack_id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_WidgetAcks PRIMARY KEY DEFAULT NEWID(),
        dashboard_id     UNIQUEIDENTIFIER NOT NULL,
        widget_id        UNIQUEIDENTIFIER NOT NULL,
        sheet_id         UNIQUEIDENTIFIER NOT NULL,
        row_id           UNIQUEIDENTIFIER NOT NULL,
        row_label        NVARCHAR(400)    NULL,          -- e.g. "QHL-001 · ABC12" (Sub Doc No · Short Code) as shown when read
        employee_id      UNIQUEIDENTIFIER NULL,          -- the employee picked in the drop-down (a user of DocHUB)
        employee_name    NVARCHAR(200)    NOT NULL,
        acked_by         UNIQUEIDENTIFIER NOT NULL,      -- the signed-in account that pressed รับทราบ (a shared tablet, a supervisor …)
        acked_at         DATETIME2        NOT NULL CONSTRAINT DF_WidgetAcks_At DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_WidgetAcks_Widget ON dbo.WidgetAcks(widget_id, acked_at DESC);
    CREATE INDEX IX_WidgetAcks_Row ON dbo.WidgetAcks(row_id, acked_at DESC);
END
GO

-- (2) Quality Highlight dashboards
DECLARE @d UNIQUEIDENTIFIER;
DECLARE qh CURSOR LOCAL FAST_FORWARD FOR
    SELECT d.dashboard_id FROM dbo.Dashboards d
    WHERE d.dashboard_name IN (N'Quality Highlight', N'Quality Highlight Line', N'Quality Highlight Incoming')
      AND EXISTS (SELECT 1 FROM dbo.DashboardWidgets w WHERE w.dashboard_id = d.dashboard_id AND w.widget_type = N'revision')
      AND EXISTS (SELECT 1 FROM dbo.DashboardWidgets w WHERE w.dashboard_id = d.dashboard_id AND w.widget_type = N'records');
OPEN qh;
FETCH NEXT FROM qh INTO @d;
WHILE @@FETCH_STATUS = 0
BEGIN
    DELETE FROM dbo.DashboardWidgets WHERE dashboard_id = @d AND widget_type = N'revision';
    UPDATE dbo.DashboardWidgets
    SET width = 1232,
        config = JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(JSON_MODIFY(CASE WHEN ISJSON(config) = 1 THEN config ELSE N'{}' END,
                   '$.showRev', CAST(0 AS BIT)), '$.cardStyle', N'boxes'), '$.ack', CAST(1 AS BIT)), '$.detail', CAST(1 AS BIT)),
        updated_at = SYSUTCDATETIME()
    WHERE dashboard_id = @d AND widget_type = N'records';
    -- Incoming: search Material, Mat Name, Supplier … (every column), whatever columns are added later
    UPDATE w SET config = JSON_MODIFY(JSON_MODIFY(w.config, '$.searchAll', CAST(1 AS BIT)), '$.placeholder', N'พิมพ์ Material / Mat Name / Supplier (บางส่วนก็ได้)')
    FROM dbo.DashboardWidgets w JOIN dbo.Dashboards d ON d.dashboard_id = w.dashboard_id
    WHERE w.dashboard_id = @d AND w.widget_type = N'records' AND d.dashboard_name = N'Quality Highlight Incoming';
    UPDATE dbo.Dashboards SET dashboard_name = N'Quality Highlight Line', updated_at = SYSUTCDATETIME() WHERE dashboard_id = @d AND dashboard_name = N'Quality Highlight';
    FETCH NEXT FROM qh INTO @d;
END;
CLOSE qh; DEALLOCATE qh;
GO

-- (3) Bone: colours far apart for the 14 parts
UPDATE w
SET config = JSON_MODIFY(w.config, '$.colors', JSON_QUERY(N'["#E6194B","#1E40AF","#F59E0B","#16A34A","#7E22CE","#06B6D4","#EC4899","#78350F","#84CC16","#111827","#F97316","#0F766E","#A3A3A3","#C026D3"]')),
    updated_at = SYSUTCDATETIME()
FROM dbo.DashboardWidgets w JOIN dbo.Dashboards d ON d.dashboard_id = w.dashboard_id
WHERE d.dashboard_name = N'Anatomy-Manual' AND w.widget_type = N'bar' AND w.title = N'ก้างแต่ละส่วน แยกกะ (ชิ้น)'
  AND ISJSON(w.config) = 1
  AND REPLACE(JSON_QUERY(w.config, '$.colors'), ' ', '') = N'["#DC2626","#1552F0","#F59E0B","#16A34A","#7C3AED","#0EA5E9","#DB2777","#64748B","#EA580C","#0D9488","#9333EA","#65A30D","#BE123C","#0369A1"]';
