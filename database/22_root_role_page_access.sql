-- DataSheet Pro — Step 22: role "root" (above admin: everything an admin can do + the "จัดการสิทธิ์" page) and which pages
-- of the left bar each role sees (rows saved by a root; a page without a row uses its default in
-- server/src/modules/pageAccess/registry.ts). The root account itself is created by the server at start-up
-- (server/src/scripts/rootAccount.ts). Idempotent.
IF NOT EXISTS (SELECT 1 FROM dbo.Roles WHERE role_id = 4)
    INSERT INTO dbo.Roles (role_id, role_name, description)
    VALUES (4, N'root', N'ผู้ดูแลระบบสูงสุด: ทำได้ทุกอย่าง และกำหนดว่าแต่ละบทบาทเห็นหน้าไหนในเมนู');
GO

IF OBJECT_ID(N'dbo.RolePageAccess', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.RolePageAccess (
        role_name   NVARCHAR(20)     NOT NULL,     -- viewer | user | master | admin
        page_key    NVARCHAR(50)     NOT NULL,     -- news | browse | monitor | ai …
        allowed     BIT              NOT NULL,
        updated_by  UNIQUEIDENTIFIER NULL,
        updated_at  DATETIME2        NOT NULL CONSTRAINT DF_RolePageAccess_At DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_RolePageAccess PRIMARY KEY (role_name, page_key)
    );
END
