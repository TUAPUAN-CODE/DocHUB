# หน้า Monitor (Admin) และข้อจำกัดของ Cloudflare

เมนู **Monitor** (เฉพาะ Admin): จำนวนการใช้งาน (request) ที่ server ตอบ แยก **ผ่าน Cloudflare** (มี header `cf-ray` = เปิดจากอินเทอร์เน็ต)
กับ **ในโรงงาน (LAN)** — ต่อนาที (60 นาทีล่าสุด), ต่อชั่วโมง (48 ชม.), ต่อวัน (31 วัน), ต่อเดือน, ข้อผิดพลาด 5xx, ตอบช้าเกิน 3 วินาที,
หน้าที่ถูกเรียกมากที่สุด และสถานะเครื่อง server · เก็บเป็นรายชั่วโมงในตาราง `TrafficHourly` (migration 21)

## ข้อจำกัดของ Cloudflare

ตัวเลข 100,000 request/วัน · 1,000 request/นาที · CPU 10 ms · subrequest 50 เป็นของ **Cloudflare Workers** (แผนฟรี) ซึ่งระบบนี้ไม่ได้ใช้
ระบบนี้ใช้ **Cloudflare Tunnel** + DNS proxy แผนฟรี: **ไม่มีโควตาจำนวน request** แต่มีข้อจำกัด
- ขนาด request (อัปโหลด) ไม่เกิน 100 MB ต่อครั้ง
- server ต้องเริ่มตอบภายใน 100 วินาที (ไม่อย่างนั้นผู้ใช้เห็น Error 524)
- ใช้ตามปกติ (fair use) — ห้ามใช้ส่งวิดีโอ/ไฟล์ใหญ่เป็นหลัก

หน้า Monitor แสดงแถบเทียบกับตัวเลขของ Workers ไว้ให้เห็นภาพเท่านั้น

## ตัวเลขจากฝั่ง Cloudflare (ไม่บังคับ)

1. Cloudflare → My Profile → API Tokens → Create Token → Custom: สิทธิ์ **Zone · Analytics · Read** เฉพาะโดเมน qcqrxdigital.dpdns.org
2. Zone ID: หน้า Overview ของโดเมน (คอลัมน์ขวา)
3. `server\.env`: `CF_API_TOKEN=…` และ `CF_ZONE_ID=…` → `pm2 restart dochub`

หน้า Monitor จะแสดงตาราง requests / cache / ภัยคุกคาม / ข้อมูล 30 วันจาก Cloudflare (ยังไม่ได้ทดสอบกับ Cloudflare จริง)
