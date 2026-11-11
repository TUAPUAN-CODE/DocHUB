# ข่าวสาร · ขอ Tag · Tag All · Root และหน้าจัดการสิทธิ์

## ข่าวสาร (เมนู ข่าวสาร, `/news`)

- โพสต์ = หัวข้อ + รายละเอียด (ลิงก์ https:// กดได้) + รูปไม่เกิน 10 รูป + ลิงก์ (ไม่บังคับ) + **Tag ของคนที่ควรเห็น** (อย่างน้อย 1 Tag)
- เห็นข่าว: คนที่มี Tag ของข่าว (Tag **All** = ทุกคน) · ผู้โพสต์ · Admin / Root เห็นทุกข่าว
- โพสต์ได้: User ขึ้นไป (Viewer อ่านอย่างเดียว) · ปักหมุด: Master ขึ้นไป · แก้/ลบ: ผู้โพสต์ หรือ Admin
- ตัวเลขที่เมนู = ข่าวใหม่ที่ยังไม่ได้อ่าน (`NewsReads.last_seen_at`) · ข่าวที่ส่งถึง Tag ที่ไม่ใช่ All มีแจ้งเตือนที่กระดิ่งด้วย
- ตาราง: `NewsPosts`, `NewsPostTags`, `NewsReads` (`database/24_news.sql`) · API `server/src/modules/news` · หน้าเว็บ `client/src/modules/news`

## Tag All และการขอ Tag (เมนู Tag, `/tags`)

- **All** เป็น Tag ของระบบ (`Tags.is_system = 1`): ทุกบัญชีมีโดยไม่ต้องมีแถวใน `UserTags` — อ่านสมาชิกผ่าน view **`UserTagsAll`**
  (ใช้ใน `shared/permissions.ts`, `services/lookup.ts`, `routes/access.ts`, ข่าวสาร) · เปลี่ยนชื่อ / ลบ / ใส่สมาชิกไม่ได้ (เปลี่ยนสี / คำอธิบายได้)
- แชร์ไฟล์ / โฟลเดอร์ / ข่าวให้ **All** = ทุกคน
- **Master และ Admin** สร้าง / แก้ไข Tag และกำหนดสมาชิกได้ (แท็บ จัดการ Tag) · ลบ Tag ได้เฉพาะ Admin
- คนอื่น **ขอ Tag** ได้: เลือก Tag + เลือกว่าจะส่งถึง Admin / Master คนไหน → คนนั้นได้แจ้งเตือนและตัวเลขที่เมนู Tag →
  อนุมัติ (ใส่ Tag ให้ทันที) / ไม่อนุมัติ (ใส่เหตุผล) · Admin เลือก “ทั้งหมด (Admin)” เพื่อพิจารณาคำขอที่ส่งถึงคนอื่นแทนได้
- ตาราง `TagRequests` (`database/23_tag_all_requests.sql`) · API `server/src/modules/tags/requests.ts` · หน้าเว็บ `client/src/modules/tags`

## Root และหน้าจัดการสิทธิ์ (`/permissions`)

- บทบาท **root** (`Roles.role_id = 4`) ทำได้ทุกอย่างเหมือน Admin + หน้า **จัดการสิทธิ์** · `requireRole(...)` ให้ root ผ่านทุกครั้ง, `isAdminRole()` = admin หรือ root
- Admin แก้ไข / ปิด / รีเซ็ตรหัสผ่านบัญชี Root ไม่ได้ และให้บทบาท Root ได้เฉพาะ Root · ขอสร้างบัญชีขอ Root ไม่ได้
- **บัญชี root** สร้างเองตอน server เปิดครั้งแรกด้วยเวอร์ชันนี้ (`server/src/scripts/rootAccount.ts`) เมื่อยังไม่เคยมีใครเป็น root:
  ชื่อผู้ใช้ `root` รหัสผ่าน `Root@` + วันที่วันนั้นตามเวลาไทย `ddmmyyyy` (ค.ศ.) เช่น 11 พ.ย. 2026 → `Root@11112026`
  (log ของ server บอกวันที่ที่ใช้ ไม่บอกรหัสผ่าน) — **เข้าแล้วเปลี่ยนรหัสผ่านทันที** · ไม่มีรหัสผ่านอยู่ใน repo
- หน้า **จัดการสิทธิ์**: ตาราง หน้า × บทบาท (Viewer / User / Master / Admin; Root เห็นทุกหน้าเสมอ) + แถว **ผู้ช่วย AI** (ปุ่ม AI บนแถบด้านบน)
  - รายการหน้าและค่าเริ่มต้นอยู่ที่ `server/src/modules/pageAccess/registry.ts` (key ตรงกับ `client/src/lib/pages.tsx`)
  - `floor` = บทบาทต่ำสุดที่ให้ได้ เพราะฝั่ง server ยังตรวจบทบาทนั้น (จัดการผู้ใช้ = Admin, อุปกรณ์ / ดึงข้อมูล = Master) · หน้าแรก / ตั้งค่า ทุกคนเห็นเสมอ
  - ค่าที่ Root บันทึกอยู่ใน `RolePageAccess` (`database/22_root_role_page_access.sql`) · หน้าที่ไม่มีแถว = ค่าเริ่มต้น (หน้าที่เพิ่มทีหลังจึงมีค่าเริ่มต้นเอง)
  - บันทึกแล้ว browser ทุกเครื่องได้ event `pages:changed` → เมนูเปลี่ยนทันที · server ตรวจด้วย `requirePage(key)` ที่ ข่าวสาร, Monitor, Search, AI
  - ซ่อนเมนูไม่ได้ลบสิทธิ์ไฟล์: ไฟล์ที่แชร์ยังเปิดจากลิงก์ได้
- ปุ่ม **AI**: ค่าเริ่มต้นเห็นเฉพาะ Admin และ Root (API `/ai/*` ใช้กฎเดียวกัน)

## อื่นๆ ในชุดนี้

- **อีเมลไม่บังคับ** (`database/25_optional_email.sql`): `Users.email` / `AccountRequests.email` เป็น NULL ได้ อีเมลที่ใส่ยังห้ามซ้ำ (filtered unique index)
- **ย้อนข้อมูลทั้งชีต**: ปุ่ม “ย้อนข้อมูล” กดได้เมื่อ เลือกเวลา → กด “ดูผลกระทบ” → พิมพ์เหตุผลอย่างน้อย 5 ตัวอักษร (หน้าต่างบอกว่ายังขาดกี่ตัว)
- **แดชบอร์ดบนมือถือ**: ขนาดตัวอักษรที่ตั้งไว้สำหรับจอใหญ่ถูกย่อเมื่อเปิดบนมือถือ (`phoneSized` ใน `components/dashboard/widgets.tsx`) ค่าที่บันทึกไม่เปลี่ยน
