-- DataSheet Pro — Step 17: sheet revisions ("ออก Rev"). A revision is a frozen copy of a sheet's rows plus what changed
-- since the previous revision, issued on purpose by a user (like REV.8 of an Excel file). Idempotent.
IF OBJECT_ID(N'dbo.SheetRevisions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.SheetRevisions (
        revision_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_SheetRevisions PRIMARY KEY DEFAULT NEWID(),
        sheet_id       UNIQUEIDENTIFIER NOT NULL,
        rev_no         INT              NOT NULL,
        note           NVARCHAR(1000)   NULL,
        row_count      INT              NOT NULL,
        added_count    INT              NOT NULL CONSTRAINT DF_SheetRev_Add DEFAULT 0,
        changed_count  INT              NOT NULL CONSTRAINT DF_SheetRev_Chg DEFAULT 0,
        removed_count  INT              NOT NULL CONSTRAINT DF_SheetRev_Rem DEFAULT 0,
        snapshot_json  NVARCHAR(MAX)    NOT NULL,                 -- {cols:[{id,name,type,stamp}], rows:[{id,no,v:{columnId:value}}]}
        diff_json      NVARCHAR(MAX)    NULL,                     -- changes since the previous revision (null for the first one)
        created_by     UNIQUEIDENTIFIER NOT NULL,
        created_at     DATETIME2        NOT NULL CONSTRAINT DF_SheetRev_Cr DEFAULT SYSUTCDATETIME()
    );
    CREATE UNIQUE INDEX UX_SheetRevisions_No ON dbo.SheetRevisions(sheet_id, rev_no) INCLUDE (created_at);
END
GO
