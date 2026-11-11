-- DocHUB seed: document types of the files shipped by the other seeds (runs after them: name starts with zz_).
-- Quality Highlight - Master and the Metal Detector program tables = Master Data; form F3QCPF06 = แบบฟอร์มบันทึก.
-- Only files that still have no type; the server issues their first Rev at start-up (revisions/docTypes.ts).
SET NOCOUNT ON;
UPDATE Files SET doc_type = N'master_data'
WHERE doc_type IS NULL AND file_id IN ('a6e60e98-364e-4585-a4d0-eb09e3964ad2', 'e6499d97-95ae-4def-a537-3228d9398f52');
UPDATE Files SET doc_type = N'record'
WHERE doc_type IS NULL AND file_id IN ('3d6f2822-7ef7-4498-af39-36cdf924ea82');
SELECT N'inserted' AS result;
