-- DataSheet Pro — Step 18: data seeds that ship with the repository (database/seed/*.sql) run once per database.
-- A seed listed here is not run again, even if its data is deleted later (delete the row to run it again). Idempotent.
IF OBJECT_ID(N'dbo.AppliedSeeds', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AppliedSeeds (
        seed_name   NVARCHAR(200)  NOT NULL CONSTRAINT PK_AppliedSeeds PRIMARY KEY,   -- file name in database/seed
        result      NVARCHAR(200)  NOT NULL,                                          -- inserted | skipped (already there)
        applied_at  DATETIME2      NOT NULL CONSTRAINT DF_AppliedSeeds_At DEFAULT SYSUTCDATETIME()
    );
END
