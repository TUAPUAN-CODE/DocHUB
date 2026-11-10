# คู่มือในแอป (เมนู “คู่มือ”)

หน้า `/guide`: คู่มือแยกตามหัวข้อ อ่านเลื่อนลงเหมือนไฟล์ PDF ทุกขั้นตอนมีภาพหน้าจอจริงพร้อมกรอบ ลูกศร และข้อความบอกว่าต้องกดตรงไหน
พิมพ์หรือบันทึกเป็น PDF ได้ (ปุ่ม **พิมพ์ / บันทึก PDF**) · แตะภาพเพื่อขยาย · หัวข้อของ Admin แสดงเฉพาะ Admin

| ส่วน | ไฟล์ |
|---|---|
| หน้าคู่มือ (สารบัญ / ตัวอ่าน / ภาพขยาย) | `client/src/modules/guide/GuidePage.tsx` |
| กรอบ ลูกศร ข้อความบนภาพ (วาดตอนแสดง คมชัดทุกขนาด) | `client/src/modules/guide/Annotated.tsx` |
| เนื้อหา: ขั้นตอน ข้อความ จุดที่ต้องกด | `client/scripts/guide/guides.cjs` |
| ตัวแคปภาพ (Playwright กดตามขั้นตอนบนแอปจริง) | `client/scripts/guide/capture.cjs` |
| ผลลัพธ์ (commit ไว้ใน repo) | `client/public/guide/manifest.json` + `*.webp` |

## อัปเดตคู่มือ (เมื่อหน้าจอเปลี่ยน หรือเพิ่มเรื่องใหม่)

ทำบนเครื่องพัฒนา (ไม่ใช่ server จริง) ด้วย**ฐานข้อมูลเปล่า + ข้อมูลตัวอย่างเท่านั้น** — repo เป็น public ห้ามแคปข้อมูลบริษัท

```
cd client && npm run build
cd ../server
set DB_NAME=DocHubGuide
npm run db:reset && npm run db:seed
set PORT=4200 && set SERVE_CLIENT_DIR=../client/dist && npm run dev
```

อีกหน้าต่าง:

```
cd client
node scripts/guide/capture.cjs --base http://localhost:4200
node scripts/guide/capture.cjs --base http://localhost:4200 --only add-row,share-tag
npm run build
```

- แก้ข้อความ/เพิ่มเรื่องที่ `guides.cjs` (`r.shot({ title, text, tip, marks: [{ el, label }] })` = ขั้นตอนมีภาพ, `r.note({...})` = ข้อความล้วน, `**ตัวหนา**`)
- เรื่องที่ไม่สำเร็จจะเก็บของเดิมไว้ และมีภาพตอนผิดพลาด `client/public/guide/_failed-<id>.png` (ไม่ถูก commit)
- server จำกัดการเข้าสู่ระบบ 30 ครั้ง / 15 นาที และแต่ละเรื่องเข้าสู่ระบบ 1 ครั้ง: รันเป็นชุดละไม่เกิน ~25 เรื่องด้วย `--only` แล้วรีสตาร์ต server ระหว่างชุด
- ต้องมี Playwright บนเครื่อง (`require('playwright')`) — ไม่ได้เป็น dependency ของแอป
