-- DataSheet Pro — Step 28: tag "Ink" (people told about InkCode plans) and the setting of which tags get the news post
-- "New Code ตรวจ 100%" made by the plan import (SystemSettings inkcode.newCodeNewsTags = JSON array of tag ids; changed on the
-- page นำเข้าแผนผลิต). Only adds what is missing; idempotent.
IF OBJECT_ID(N'dbo.Tags', N'U') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dbo.Tags WHERE tag_name = N'Ink')
BEGIN
    DECLARE @by UNIQUEIDENTIFIER = (SELECT TOP 1 user_id FROM dbo.Users ORDER BY created_at);
    IF @by IS NOT NULL
        INSERT INTO dbo.Tags (tag_name, color, description, created_by)
        VALUES (N'Ink', N'#0EA5E9', N'รับข่าวแจ้ง New Code ตรวจ 100% จากแผนผลิต InkCode', @by);
END
GO
IF NOT EXISTS (SELECT 1 FROM dbo.SystemSettings WHERE setting_key = N'inkcode.newCodeNewsTags')
   AND EXISTS (SELECT 1 FROM dbo.Tags WHERE tag_name = N'Ink')
BEGIN
    INSERT INTO dbo.SystemSettings (setting_key, setting_value)
    SELECT N'inkcode.newCodeNewsTags', N'["' + LOWER(CONVERT(NVARCHAR(36), tag_id)) + N'"]' FROM dbo.Tags WHERE tag_name = N'Ink';
END
