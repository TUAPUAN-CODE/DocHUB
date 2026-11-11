-- DataSheet Pro — Step 23: the system tag "All" (everyone has it, without UserTags rows: read memberships through the view
-- UserTagsAll) and requests for a tag ("ขอ Tag"), sent to an admin / master the requester picks. Idempotent.
IF COL_LENGTH(N'dbo.Tags', N'is_system') IS NULL
    ALTER TABLE dbo.Tags ADD is_system BIT NOT NULL CONSTRAINT DF_Tags_System DEFAULT 0;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Tags WHERE is_system = 1)
BEGIN
    IF EXISTS (SELECT 1 FROM dbo.Tags WHERE tag_name = N'All')
        UPDATE dbo.Tags SET is_system = 1, updated_at = SYSUTCDATETIME() WHERE tag_name = N'All';
    ELSE
        INSERT INTO dbo.Tags (tag_name, color, description, created_by, is_system)
        VALUES (N'All', N'#0F766E', N'ทุกคนในระบบ (Tag ของระบบ ทุกบัญชีมีโดยอัตโนมัติ)',
                COALESCE((SELECT TOP 1 user_id FROM dbo.Users ORDER BY created_at), CAST('00000000-0000-0000-0000-000000000000' AS UNIQUEIDENTIFIER)), 1);
END
GO

-- memberships including the system tag (every user). Writes still go to UserTags.
IF OBJECT_ID(N'dbo.UserTagsAll', N'V') IS NULL
    EXEC(N'CREATE VIEW dbo.UserTagsAll AS
        SELECT ut.user_id, ut.tag_id FROM dbo.UserTags ut
        UNION
        SELECT u.user_id, t.tag_id FROM dbo.Users u CROSS JOIN dbo.Tags t WHERE t.is_system = 1');
GO

IF OBJECT_ID(N'dbo.TagRequests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TagRequests (
        request_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_TagRequests PRIMARY KEY DEFAULT NEWID(),
        user_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TagRequests_User REFERENCES dbo.Users(user_id) ON DELETE CASCADE,
        tag_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_TagRequests_Tag REFERENCES dbo.Tags(tag_id) ON DELETE CASCADE,
        approver_id  UNIQUEIDENTIFIER NOT NULL,          -- the admin / master (or root) the requester sent it to
        note         NVARCHAR(1000)   NULL,
        status       NVARCHAR(20)     NOT NULL CONSTRAINT DF_TagRequests_Status DEFAULT N'pending', -- pending | approved | rejected | cancelled
        reviewed_by  UNIQUEIDENTIFIER NULL,
        review_note  NVARCHAR(1000)   NULL,
        reviewed_at  DATETIME2        NULL,
        created_at   DATETIME2        NOT NULL CONSTRAINT DF_TagRequests_Cr DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_TagRequests_Approver ON dbo.TagRequests(approver_id, status);
    CREATE INDEX IX_TagRequests_User ON dbo.TagRequests(user_id, created_at DESC);
END
