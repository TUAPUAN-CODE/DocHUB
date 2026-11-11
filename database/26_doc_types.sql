-- DataSheet Pro — Step 26: document types and format revisions. Idempotent.
--  Files.doc_type: master_data (data changes are issued as Rev) | record (a form: its format has Rev, the data recorded with it does
--  not; every row knows the form Rev it was entered with, from its created_at) | NULL = ทั่วไป (as before).
--  SheetRevisions now also freeze the sheet's format (columns with their options / formulas, form layout, lines, PDF layouts).
IF COL_LENGTH(N'dbo.Files', N'doc_type') IS NULL
    ALTER TABLE dbo.Files ADD doc_type NVARCHAR(20) NULL;
GO
IF COL_LENGTH(N'dbo.SheetRevisions', N'kind') IS NULL
    ALTER TABLE dbo.SheetRevisions ADD kind NVARCHAR(10) NOT NULL CONSTRAINT DF_SheetRev_Kind DEFAULT N'data'; -- data | format
GO
IF COL_LENGTH(N'dbo.SheetRevisions', N'format_json') IS NULL
    ALTER TABLE dbo.SheetRevisions ADD format_json NVARCHAR(MAX) NULL, format_diff_json NVARCHAR(MAX) NULL,
        format_changes INT NOT NULL CONSTRAINT DF_SheetRev_Fmt DEFAULT 0;
