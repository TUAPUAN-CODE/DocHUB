# อีเมลแจ้ง Quality Highlight เมื่อนำเข้าแผนผลิต

เมื่อนำเข้าแผนผลิต (วางไฟล์ที่แอป **แผนผลิต** หรือในโฟลเดอร์ InkCode › แผนผลิต) แล้วมี **Doc No** ในแผนที่ตรงกับ **Sub Doc No.** ใน
Quality Highlight - Master ระบบส่งอีเมลหนึ่งฉบับต่อแผน ถึงคนที่ผู้ใช้พิมพ์ไว้ — ตารางรายการในแผน (เวลา · ไลน์ · Product · ประเทศ · Doc No)
พร้อมรายละเอียดจาก Quality Highlight ของแต่ละ Doc No (Material · Short Code · Note ให้Spread · วันที่/ผู้อัปเดต) และลิงก์ไปไฟล์ (ถ้าตั้ง `PUBLIC_URL`)

## ตั้งค่า (Master / Admin) — หน้า แผนผลิต › การ์ด "อีเมลแจ้ง Quality Highlight"

1. **เชื่อม Outlook** — กดเชื่อมแล้วเข้าสู่ระบบ Microsoft ด้วยกล่องที่จะใช้ส่ง (อีเมลออกจากกล่องนี้ และอยู่ใน Sent Items)
2. ใส่ **ถึง (To)** / **สำเนา (CC)** / **หัวข้อ** / **ข้อความนำ** เอง — ใช้ `{date}` วันที่ผลิต · `{count}` จำนวน Doc No ที่ตรง · `{file}` ชื่อไฟล์แผน
3. เปิดสวิตช์ แล้วกด **บันทึก** · ปุ่ม **ส่งอีเมลทดสอบถึงตัวเอง** ส่งตัวอย่างจากข้อมูล Quality Highlight จริงเข้ากล่องที่เชื่อม

- แผนเดิม (วันเดียวกัน Doc No ชุดเดียวกัน ผู้รับชุดเดียวกัน) **ไม่ส่งซ้ำ** — เปลี่ยนผู้รับแล้วจึงส่งใหม่ได้
- ถ้าไม่มี Doc No ตรง / ยังไม่ใส่ผู้รับ / Outlook หมดอายุ — ระบบไม่ส่ง และบอกเหตุผลใต้ผลการนำเข้า (การนำเข้าแผนไม่ล้มเหลวเพราะอีเมล)

## ตั้งค่าที่ Azure (ครั้งเดียว โดยผู้ดูแล Microsoft 365 ของบริษัท)

ใช้แอป Microsoft เดียวกับการนำเข้าลิงก์ OneDrive (`MS_CLIENT_ID` / `MS_CLIENT_SECRET` / `MS_TENANT` ใน `.env` — ดู docs/CONNECTORS.md)

- **API permissions › Microsoft Graph › Delegated:** เพิ่ม `Mail.Send` และ `User.Read` (กด Grant admin consent ถ้าองค์กรบังคับ)
- Redirect URI เดิม `…/api/connectors/ms/callback` ใช้ต่อได้ ไม่ต้องเพิ่ม
- ตั้ง `PUBLIC_URL` ใน `.env` ถ้าต้องการลิงก์ในอีเมล

## ที่เก็บข้อมูล

ตั้งค่าอยู่ใน `SystemSettings` คีย์ `inkcode.qhMail` · โทเคน Outlook เข้ารหัสไว้ที่ `inkcode.mailSender` (ไม่ส่งกลับไปที่หน้าเว็บ) ·
รายการที่ส่งแล้วที่ `inkcode.qhMail.sent` (300 ล่าสุด)
