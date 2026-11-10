-- DataSheet Pro — Step 21: request counts per hour for the admin Monitor page (via Cloudflare tunnel / direct on the LAN).
-- Every server process adds its own counts (MERGE … +=), so several processes add up. Idempotent.
IF OBJECT_ID(N'dbo.TrafficHourly', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TrafficHourly (
        hour_start  DATETIME2     NOT NULL,                 -- UTC, start of the hour
        source      NVARCHAR(12)  NOT NULL,                 -- cloudflare | lan
        requests    INT           NOT NULL CONSTRAINT DF_Traffic_Req DEFAULT 0,
        errors      INT           NOT NULL CONSTRAINT DF_Traffic_Err DEFAULT 0,  -- HTTP 5xx
        slow        INT           NOT NULL CONSTRAINT DF_Traffic_Slow DEFAULT 0, -- took longer than 3 s
        bytes       BIGINT        NOT NULL CONSTRAINT DF_Traffic_Bytes DEFAULT 0,
        CONSTRAINT PK_TrafficHourly PRIMARY KEY (hour_start, source)
    );
END
