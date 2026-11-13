-- DataSheet Pro — Step 29: "Application" page. Every dashboard and the plan import are apps by themselves (no row needed); a row
-- here renames one / gives it an icon / hides it / limits it to roles or tags, or is an app an admin added (a file, a folder, a
-- dashboard or a web link). app_key: dash:<dashboard id> | page:<page key> | custom:<id>. Idempotent.
IF OBJECT_ID(N'dbo.Apps', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Apps (
        app_key      NVARCHAR(80)     NOT NULL CONSTRAINT PK_Apps PRIMARY KEY,
        kind         NVARCHAR(20)     NOT NULL,            -- dashboard | page | file | folder | url
        ref_id       NVARCHAR(100)    NULL,                -- dashboard / file / folder id, page key
        url          NVARCHAR(1000)   NULL,                -- kind url
        app_name     NVARCHAR(100)    NULL,                -- NULL = the name of what it opens
        icon_url     NVARCHAR(300)    NULL,                -- /uploads/…
        color        NVARCHAR(20)     NULL,
        description  NVARCHAR(500)    NULL,
        roles_json   NVARCHAR(400)    NULL,                -- ["user","master"] = only these roles (admin / root always); NULL = everyone allowed by the source
        tags_json    NVARCHAR(MAX)    NULL,                -- [tag ids] = only members of these tags; NULL = no tag limit
        is_hidden    BIT              NOT NULL CONSTRAINT DF_Apps_Hidden DEFAULT 0,
        sort_order   INT              NULL,
        created_by   UNIQUEIDENTIFIER NULL,
        created_at   DATETIME2        NOT NULL CONSTRAINT DF_Apps_Cr DEFAULT SYSUTCDATETIME(),
        updated_by   UNIQUEIDENTIFIER NULL,
        updated_at   DATETIME2        NOT NULL CONSTRAINT DF_Apps_Up DEFAULT SYSUTCDATETIME()
    );
END
