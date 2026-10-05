# ดึงข้อมูลจากลิงก์ / API (Connectors)

เมนู **ดึงข้อมูลจากลิงก์/API** (master / admin) — ใส่ลิงก์ → กำหนดรูปแบบ → จับคู่คอลัมน์ → บันทึกลงตาราง ดึงเองหรือตั้งเวลา (รันบนเซิร์ฟเวอร์เดียวผ่าน lease `connectors`)

## รองรับ
- JSON (ระบุ JSON path ของอาร์เรย์, ฟิลด์ซ้อนจะแตกเป็น `a.b`), CSV, Excel (.xlsx เลือกชีต/แถวหัวคอลัมน์)
- Auth: บัญชี+รหัสผ่าน (Basic), Bearer token, API key header — กรอกในป๊อปอัปเมื่อลิงก์ตอบ 401/403 หรือส่งหน้า login กลับมา เก็บแบบ AES-256-GCM บนเซิร์ฟเวอร์ ไม่ส่งกลับเบราว์เซอร์
- SharePoint / OneDrive: ลิงก์ที่กดแชร์ → อ่านผ่าน Microsoft Graph (`/shares/{url}/driveItem/content`) ด้วยการเข้าสู่ระบบ Microsoft ในป๊อปอัป

## SharePoint ต้องตั้งค่า (ทำโดย IT / Azure admin)
Microsoft ไม่รับ "ชื่อบัญชี+รหัสผ่าน" ตรง ๆ กับ SharePoint Online (มี MFA) จึงใช้หน้า login ของ Microsoft แทน:
1. Azure Portal → App registrations → (ใช้แอปเดียวกับ login ที่ตั้ง `MS_CLIENT_ID` ไว้แล้ว หรือสร้างใหม่)
2. Redirect URI (Web): `https://<โดเมนระบบ>/api/connectors/ms/callback` (ตั้ง `PUBLIC_URL` ให้ตรง)
3. API permissions → Microsoft Graph → **Delegated**: `Files.Read.All`, `Sites.Read.All`, `offline_access` → Grant admin consent
4. `.env`: `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT` (แนะนำใส่ tenant ของบริษัท)
ผู้ใช้ที่กด "เข้าสู่ระบบด้วย Microsoft" ต้องมีสิทธิ์เปิดไฟล์นั้นจริง — ระบบอ่านไฟล์ในนามบัญชีนั้น

## ความปลอดภัย / ข้อจำกัด
- กันปลายทาง localhost / 127.x / 169.254.x (cloud metadata) และตรวจซ้ำทุกการ redirect; ปลายทางในเครือข่ายบริษัท (10.x, 172.16-31.x, 192.168.x) อนุญาตเพราะ API ภายในเป็นกรณีปกติ — ตั้ง `CONNECTOR_BLOCK_PRIVATE=true` เพื่อห้าม
- สร้าง/แก้ได้เฉพาะ master/admin และต้องมีสิทธิ์เขียนในตารางปลายทาง; ข้อมูลถูกเขียนในนามเจ้าของ connector ผ่านกฎตรวจข้อมูลเดียวกับการพิมพ์เอง (ค่าที่ไม่ผ่านจะถูกข้ามและแจ้งสาเหตุ)
- จำกัด `CONNECTOR_MAX_MB` (50) และ `CONNECTOR_MAX_ROWS` (50,000) ต่อรอบ
- เก็บความลับด้วย `SECRETS_KEY` (แนะนำตั้งแยก; ถ้าไม่ตั้งจะใช้ `JWT_SECRET` — เปลี่ยนค่านี้แล้วข้อมูลเข้าสู่ระบบที่เก็บไว้จะถอดไม่ได้ ต้องกรอกใหม่)
- ไม่มีการลบแถวที่หายไปจากต้นทาง (เพิ่ม/อัปเดตเท่านั้น)
- ยังไม่ได้ทดสอบกับ tenant Microsoft จริง
