-- DataSheet Pro — Step 20: requests for a new account ("ขอสร้างบัญชี"), by sign-up form or by signing in with Microsoft /
-- Google for the first time. The requester asks for a role; an admin approves with the role they decide. Idempotent.
IF OBJECT_ID(N'dbo.AccountRequests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AccountRequests (
        request_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_AccountRequests PRIMARY KEY DEFAULT NEWID(),
        username          NVARCHAR(100)    NULL,              -- sign-up form (Microsoft / Google: made from the e-mail on approval)
        email             NVARCHAR(255)    NOT NULL,
        display_name      NVARCHAR(200)    NOT NULL,
        password_hash     NVARCHAR(255)    NULL,              -- sign-up form only (bcrypt)
        provider          NVARCHAR(20)     NULL,              -- microsoft | google
        provider_subject  NVARCHAR(200)    NULL,
        requested_role    NVARCHAR(20)     NOT NULL,          -- viewer | user | master | admin
        note              NVARCHAR(1000)   NULL,              -- department / reason
        status            NVARCHAR(20)     NOT NULL CONSTRAINT DF_AccReq_Status DEFAULT N'pending', -- pending | approved | rejected
        granted_role      NVARCHAR(20)     NULL,
        user_id           UNIQUEIDENTIFIER NULL,              -- account created on approval
        reviewed_by       UNIQUEIDENTIFIER NULL,
        review_note       NVARCHAR(1000)   NULL,
        reviewed_at       DATETIME2        NULL,
        created_at        DATETIME2        NOT NULL CONSTRAINT DF_AccReq_Cr DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_AccountRequests_Status ON dbo.AccountRequests(status, created_at DESC);
END
