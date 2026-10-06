-- DataSheet Pro — Step 17: shared PDF layouts. A file can point to a "master" file and use its layouts (edit once → every file follows). Idempotent.
IF COL_LENGTH('dbo.Files', 'pdf_master_id') IS NULL
    ALTER TABLE Files ADD pdf_master_id UNIQUEIDENTIFIER NULL;   -- Files.file_id of the master; NULL = own layouts
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_Files_PdfMaster' AND object_id = OBJECT_ID('dbo.Files'))
    CREATE INDEX IX_Files_PdfMaster ON dbo.Files(pdf_master_id) WHERE pdf_master_id IS NOT NULL;
GO
