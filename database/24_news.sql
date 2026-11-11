-- DataSheet Pro — Step 24: news board ("ข่าวสาร"). A post is seen by the users having one of its tags (tag All = everyone),
-- by its author and by admins. NewsReads keeps when each user last opened the board (unread badge). Idempotent.
IF OBJECT_ID(N'dbo.NewsPosts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NewsPosts (
        post_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_NewsPosts PRIMARY KEY DEFAULT NEWID(),
        title        NVARCHAR(200)    NOT NULL,
        body         NVARCHAR(MAX)    NOT NULL,
        images_json  NVARCHAR(MAX)    NULL,              -- ["/uploads/…", …]
        link_url     NVARCHAR(1000)   NULL,              -- optional link (a file of DocHUB or any web page)
        is_pinned    BIT              NOT NULL CONSTRAINT DF_NewsPosts_Pin DEFAULT 0,
        created_by   UNIQUEIDENTIFIER NOT NULL,
        created_at   DATETIME2        NOT NULL CONSTRAINT DF_NewsPosts_Cr DEFAULT SYSUTCDATETIME(),
        updated_by   UNIQUEIDENTIFIER NULL,
        updated_at   DATETIME2        NOT NULL CONSTRAINT DF_NewsPosts_Up DEFAULT SYSUTCDATETIME(),
        is_deleted   BIT              NOT NULL CONSTRAINT DF_NewsPosts_Del DEFAULT 0,
        deleted_by   UNIQUEIDENTIFIER NULL,
        deleted_at   DATETIME2        NULL
    );
    CREATE INDEX IX_NewsPosts_Created ON dbo.NewsPosts(is_deleted, created_at DESC);
END
GO

IF OBJECT_ID(N'dbo.NewsPostTags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NewsPostTags (
        post_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_NewsPostTags_Post REFERENCES dbo.NewsPosts(post_id) ON DELETE CASCADE,
        tag_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_NewsPostTags_Tag REFERENCES dbo.Tags(tag_id) ON DELETE CASCADE,
        CONSTRAINT PK_NewsPostTags PRIMARY KEY (post_id, tag_id)
    );
    CREATE INDEX IX_NewsPostTags_Tag ON dbo.NewsPostTags(tag_id);
END
GO

IF OBJECT_ID(N'dbo.NewsReads', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.NewsReads (
        user_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_NewsReads PRIMARY KEY,
        last_seen_at  DATETIME2        NOT NULL
    );
END
