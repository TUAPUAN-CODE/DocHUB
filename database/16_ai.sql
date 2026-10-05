-- DataSheet Pro — Step 16: per-user AI provider keys (encrypted). Idempotent.
IF OBJECT_ID(N'dbo.AiKeys', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AiKeys (
        user_id    UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.Users(user_id),
        provider   VARCHAR(20)      NOT NULL,           -- gemini | anthropic | openai
        key_enc    NVARCHAR(MAX)    NOT NULL,
        model      NVARCHAR(100)    NULL,
        base_url   NVARCHAR(500)    NULL,
        updated_at DATETIME2        NOT NULL CONSTRAINT DF_AiKeys_Upd DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AiKeys PRIMARY KEY (user_id, provider)
    );
END
GO
