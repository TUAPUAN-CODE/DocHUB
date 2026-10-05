-- DataSheet Pro — Step 15: data connectors (pull data from another link / API into a sheet). Idempotent.
IF OBJECT_ID(N'dbo.Connectors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Connectors (
        connector_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_Connectors PRIMARY KEY DEFAULT NEWID(),
        name           NVARCHAR(200)    NOT NULL,
        kind           VARCHAR(20)      NOT NULL,                 -- http | sharepoint
        config_json    NVARCHAR(MAX)    NOT NULL,                 -- url, method, headers, body, format, jsonPath, sheetName, headerRow
        secret_enc     NVARCHAR(MAX)    NULL,                     -- AES-256-GCM encrypted credentials (never returned to the browser)
        target_sheet_id UNIQUEIDENTIFIER NULL,
        mapping_json   NVARCHAR(MAX)    NULL,                     -- [{source, columnId}]
        key_column_id  UNIQUEIDENTIFIER NULL,                     -- upsert key (blank = always append)
        schedule_min   INT              NOT NULL CONSTRAINT DF_Conn_Sch DEFAULT 0,
        last_run_at    DATETIME2        NULL,
        last_status    VARCHAR(20)      NULL,                     -- ok | error | needs_auth
        last_message   NVARCHAR(1000)   NULL,
        running_since  DATETIME2        NULL,
        created_by     UNIQUEIDENTIFIER NOT NULL,
        created_at     DATETIME2        NOT NULL CONSTRAINT DF_Conn_Cr DEFAULT SYSUTCDATETIME(),
        is_deleted     BIT              NOT NULL CONSTRAINT DF_Conn_Del DEFAULT 0
    );
END
GO
