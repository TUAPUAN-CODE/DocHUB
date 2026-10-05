-- DataSheet Pro — Step 14: document approval flows + user signatures. Idempotent.
IF OBJECT_ID(N'dbo.UserSignatures', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.UserSignatures (
        user_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_UserSignatures PRIMARY KEY REFERENCES dbo.Users(user_id),
        image_png   VARBINARY(MAX)   NOT NULL,
        updated_at  DATETIME2        NOT NULL CONSTRAINT DF_UserSignatures_Upd DEFAULT SYSUTCDATETIME()
    );
END
GO
IF OBJECT_ID(N'dbo.ApprovalFlows', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ApprovalFlows (
        flow_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ApprovalFlows PRIMARY KEY DEFAULT NEWID(),
        file_id     UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Files(file_id),
        flow_name   NVARCHAR(200)    NOT NULL,
        steps_json  NVARCHAR(MAX)    NOT NULL,  -- [{userId,label,allowForward,area:{page,x,y,w,h}}]
        created_by  UNIQUEIDENTIFIER NOT NULL,
        created_at  DATETIME2        NOT NULL CONSTRAINT DF_ApprovalFlows_Cr DEFAULT SYSUTCDATETIME(),
        is_deleted  BIT              NOT NULL CONSTRAINT DF_ApprovalFlows_Del DEFAULT 0
    );
    CREATE INDEX IX_ApprovalFlows_File ON dbo.ApprovalFlows (file_id);
END
GO
IF OBJECT_ID(N'dbo.ApprovalRequests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ApprovalRequests (
        request_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ApprovalRequests PRIMARY KEY DEFAULT NEWID(),
        file_id       UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Files(file_id),
        archive_id    UNIQUEIDENTIFIER NULL,
        title         NVARCHAR(300)    NOT NULL,
        status        VARCHAR(20)      NOT NULL CONSTRAINT DF_ApprovalReq_St DEFAULT 'pending', -- pending|approved|rejected
        steps_json    NVARCHAR(MAX)    NOT NULL,
        current_step  INT              NOT NULL CONSTRAINT DF_ApprovalReq_Cur DEFAULT 0,
        stored_name   NVARCHAR(100)    NOT NULL,
        created_by    UNIQUEIDENTIFIER NOT NULL,
        created_at    DATETIME2        NOT NULL CONSTRAINT DF_ApprovalReq_Cr DEFAULT SYSUTCDATETIME(),
        updated_at    DATETIME2        NOT NULL CONSTRAINT DF_ApprovalReq_Up DEFAULT SYSUTCDATETIME(),
        current_user_id UNIQUEIDENTIFIER NULL   -- approver whose turn it is (for the inbox)
    );
    CREATE INDEX IX_ApprovalReq_File ON dbo.ApprovalRequests (file_id, created_at DESC);
    CREATE INDEX IX_ApprovalReq_Cur ON dbo.ApprovalRequests (current_user_id, status);
END
GO
