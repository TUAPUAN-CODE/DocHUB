-- DataSheet Pro — Step 25: e-mail is optional (some staff have none). Users.email / AccountRequests.email become NULL-able;
-- an e-mail that is given is still unique (filtered unique index instead of the UNIQUE constraint). Idempotent.
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name = N'UQ_Users_Email' AND parent_object_id = OBJECT_ID(N'dbo.Users'))
    ALTER TABLE dbo.Users DROP CONSTRAINT UQ_Users_Email;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.Users') AND name = N'email' AND is_nullable = 0)
    ALTER TABLE dbo.Users ALTER COLUMN email NVARCHAR(255) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'UX_Users_Email' AND object_id = OBJECT_ID(N'dbo.Users'))
    CREATE UNIQUE INDEX UX_Users_Email ON dbo.Users(email) WHERE email IS NOT NULL;
GO

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'dbo.AccountRequests') AND name = N'email' AND is_nullable = 0)
    ALTER TABLE dbo.AccountRequests ALTER COLUMN email NVARCHAR(255) NULL;
