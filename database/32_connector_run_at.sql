-- DataSheet Pro — Step 32: a connector can run every day at a clock time (e.g. 05:00) instead of "every N minutes". Idempotent.
IF COL_LENGTH(N'dbo.Connectors', N'run_at') IS NULL
    ALTER TABLE dbo.Connectors ADD run_at VARCHAR(5) NULL;   -- 'HH:mm' (server local time) — used when schedule_min = 1440
GO
