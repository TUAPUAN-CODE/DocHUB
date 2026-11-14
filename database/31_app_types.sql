-- DataSheet Pro — Step 31: a type for each app of the "Application" page (e.g. QC) to sort / filter them, and the type shown first
-- (SystemSettings apps.defaultType, default QC). The QC dashboards that exist get the type QC (an app that already has a type is
-- left alone). Idempotent.
IF COL_LENGTH(N'dbo.Apps', N'app_type') IS NULL
    ALTER TABLE dbo.Apps ADD app_type NVARCHAR(50) NULL;
GO
IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = N'apps.defaultType')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES (N'apps.defaultType', N'QC');
GO
-- dashboards of the QC files: a settings row with only the type (the rest stays as it was)
INSERT INTO dbo.Apps (app_key, kind, ref_id, app_type)
SELECT N'dash:' + LOWER(CONVERT(NVARCHAR(36), d.dashboard_id)), N'dashboard', LOWER(CONVERT(NVARCHAR(36), d.dashboard_id)), N'QC'
FROM dbo.Dashboards d JOIN dbo.Files f ON f.file_id = d.file_id AND f.is_deleted = 0
WHERE d.dashboard_name IN (N'Quality Highlight Line', N'Quality Highlight', N'Quality Highlight Incoming', N'MD Record Problem', N'Anatomy-Manual')
  AND NOT EXISTS (SELECT 1 FROM dbo.Apps a WHERE a.app_key = N'dash:' + LOWER(CONVERT(NVARCHAR(36), d.dashboard_id)));
UPDATE a SET app_type = N'QC'
FROM dbo.Apps a JOIN dbo.Dashboards d ON a.app_key = N'dash:' + LOWER(CONVERT(NVARCHAR(36), d.dashboard_id))
WHERE a.app_type IS NULL AND d.dashboard_name IN (N'Quality Highlight Line', N'Quality Highlight', N'Quality Highlight Incoming', N'MD Record Problem', N'Anatomy-Manual')
  AND NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = N'apps.typesSeeded');
IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = N'apps.typesSeeded')
    INSERT INTO dbo.SystemSettings (setting_key, setting_value) VALUES (N'apps.typesSeeded', N'1');
