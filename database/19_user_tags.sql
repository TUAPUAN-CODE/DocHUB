-- DataSheet Pro — Step 19: user tags. An admin defines tags and puts users in them (a user can have any number);
-- a file or folder can be shared with a tag: every user with that tag gets the access. Idempotent.
IF OBJECT_ID(N'dbo.Tags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Tags (
        tag_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Tags PRIMARY KEY DEFAULT NEWID(),
        tag_name     NVARCHAR(100)    NOT NULL,
        color        NVARCHAR(20)     NOT NULL CONSTRAINT DF_Tags_Color DEFAULT N'#1552F0',
        description  NVARCHAR(500)    NULL,
        created_by   UNIQUEIDENTIFIER NOT NULL,
        created_at   DATETIME2        NOT NULL CONSTRAINT DF_Tags_Cr DEFAULT SYSUTCDATETIME(),
        updated_at   DATETIME2        NOT NULL CONSTRAINT DF_Tags_Up DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_Tags_Name ON dbo.Tags(tag_name);
END
GO

IF OBJECT_ID(N'dbo.UserTags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserTags (
        user_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_UserTags_User REFERENCES dbo.Users(user_id) ON DELETE CASCADE,
        tag_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_UserTags_Tag REFERENCES dbo.Tags(tag_id) ON DELETE CASCADE,
        added_by  UNIQUEIDENTIFIER NULL,
        added_at  DATETIME2        NOT NULL CONSTRAINT DF_UserTags_At DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_UserTags PRIMARY KEY (user_id, tag_id)
    );
    CREATE INDEX IX_UserTags_Tag ON dbo.UserTags(tag_id);
END
GO

-- access granted to everyone with a tag (same levels and expiry as FileAccess / FolderAccess)
IF OBJECT_ID(N'dbo.FileTagAccess', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FileTagAccess (
        file_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_FileTagAccess_File REFERENCES dbo.Files(file_id),
        tag_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_FileTagAccess_Tag REFERENCES dbo.Tags(tag_id) ON DELETE CASCADE,
        permission  NVARCHAR(20)     NOT NULL,     -- read | write | manage
        granted_by  UNIQUEIDENTIFIER NOT NULL,
        granted_at  DATETIME2        NOT NULL CONSTRAINT DF_FileTagAccess_At DEFAULT SYSUTCDATETIME(),
        expires_at  DATETIME2        NULL,
        CONSTRAINT PK_FileTagAccess PRIMARY KEY (file_id, tag_id)
    );
    CREATE INDEX IX_FileTagAccess_Tag ON dbo.FileTagAccess(tag_id);
END
GO

IF OBJECT_ID(N'dbo.FolderTagAccess', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.FolderTagAccess (
        folder_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_FolderTagAccess_Folder REFERENCES dbo.Folders(folder_id),
        tag_id      UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_FolderTagAccess_Tag REFERENCES dbo.Tags(tag_id) ON DELETE CASCADE,
        permission  NVARCHAR(20)     NOT NULL,
        granted_by  UNIQUEIDENTIFIER NOT NULL,
        granted_at  DATETIME2        NOT NULL CONSTRAINT DF_FolderTagAccess_At DEFAULT SYSUTCDATETIME(),
        expires_at  DATETIME2        NULL,
        CONSTRAINT PK_FolderTagAccess PRIMARY KEY (folder_id, tag_id)
    );
    CREATE INDEX IX_FolderTagAccess_Tag ON dbo.FolderTagAccess(tag_id);
END
