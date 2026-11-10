# เปิด DocHUB ให้ใช้จากอินเทอร์เน็ต (Cloudflare Tunnel, ฟรี)

ฐานข้อมูล SQL Server และตัวแอปอยู่บน server บริษัทเหมือนเดิม Cloudflare แค่ส่งหน้าเว็บผ่าน tunnel
ที่ server เป็นฝ่ายต่อออกไป **ไม่ต้องเปิดพอร์ตขาเข้า ไม่ต้องมี IP สาธารณะ** และไม่มีข้อมูลย้ายออกนอกบริษัท

```
ผู้ใช้ ──HTTPS──► Cloudflare ──tunnel──► server บริษัท: DocHUB :4000 (API + Socket.IO + หน้าเว็บ) ──► SQL Server
```

- ต้องรันแบบ **production** (พอร์ต 4000 พอร์ตเดียว) — ห้ามเปิด Vite dev server (:5175) ออกอินเทอร์เน็ต
- **ห้ามเปิดพอร์ต 1433** (SQL Server) ออกอินเทอร์เน็ตเด็ดขาด
- คำสั่งด้านล่างเขียนสำหรับ Windows (PowerShell) รันจากโฟลเดอร์ของ repo นี้

---

## 1. Build — ไม่ต้องทำบน server

repo มี `client/dist` และ `server/dist` ที่ build แล้ว (ผู้พัฒนา build และ commit ให้ทุกครั้ง) บน server แค่ `git pull`
ต้อง `npm ci` ในโฟลเดอร์ `server` เฉพาะครั้งแรก หรือเมื่อแจ้งว่ามี package ใหม่

ผู้พัฒนา (หลังแก้โค้ด ก่อน commit):

```powershell
cd client
npm run build          # → client/dist
cd ..\server
npm run build          # → server/dist
cd ..
git add -A client/dist server/dist
```

- `client\.env` ต้องไม่มี `VITE_API_URL` ที่เป็น IP (ไม่มีบรรทัดนี้ หรือเป็น `/api`) ไม่อย่างนั้นคนนอกบริษัทจะเรียก API ไม่ได้
- ถ้าเพิ่ง clone ใหม่ให้ `npm ci` ในทั้งสองโฟลเดอร์ก่อน (อย่ารัน `npm ci` ตอนที่ dev server ยังเปิดอยู่ — มันลบ `node_modules` ที่โปรแกรมกำลังใช้)

## 2. `server\.env`

แก้ / เพิ่มเฉพาะบรรทัดเหล่านี้ (ค่าอื่น เช่น `DB_*` คงเดิม):

```env
NODE_ENV=production
PUBLIC_URL=https://dochub.example.dpdns.org
CORS_ORIGIN=https://dochub.example.dpdns.org,http://<IP-server>:4000,http://<IP-server>:5175
JWT_SECRET=<ค่าสุ่ม 96 ตัว จากคำสั่งด้านล่าง>
COOKIE_SECURE=false
SERVE_CLIENT_DIR=../client/dist
```

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

| ค่า | เหตุผล |
|---|---|
| `JWT_SECRET` | **ห้ามใช้ค่าตัวอย่าง** `change-me-to-a-long-random-string` — ค่านั้นอยู่ใน repo สาธารณะ ใครก็สร้าง token ของ admin เองได้ (โหมด production จะไม่ยอมเปิดถ้ายังเป็นค่านี้) เปลี่ยนแล้วทุกคนต้อง login ใหม่ 1 ครั้ง |
| `COOKIE_SECURE=false` | คนในโรงงานยังเข้าผ่าน `http://<IP-server>` (ไม่มี HTTPS) ถ้าเป็น `true` เบราว์เซอร์จะไม่เก็บ cookie ต่ออายุ → หลุดจากระบบ; ถ้าวันหนึ่งทุกคนใช้ลิงก์ HTTPS แล้ว เปลี่ยนเป็น `true` |
| `CORS_ORIGIN` | ลิงก์ที่ผู้ใช้พิมพ์ในเบราว์เซอร์ทั้งหมด คั่นด้วย `,` |
| `PUBLIC_URL` | ลิงก์สาธารณะ (ใช้กับ Google/Microsoft login ถ้าเปิดใช้) |

## 3. สลับ PM2 จาก dev เป็น production

```powershell
pm2 delete datahub-server                                   # ตัว dev ที่ฟังพอร์ต 4000 อยู่
pm2 start ecosystem.production.config.js --only dochub
pm2 logs dochub --lines 30                                  # ต้องเห็น "Serving client from" และ "listening on"
pm2 save
```

ทดสอบ: เปิด `http://localhost:4000` บน server แล้ว login

- ตัว `datahub-client` (Vite :5175) ปล่อยรันต่อได้ช่วงเปลี่ยนผ่าน — ลิงก์เดิม `http://<IP-server>:5175` ยังใช้ได้เพราะมันส่งต่อไปที่ :4000
  เมื่อทุกคนย้ายไปใช้ `http://<IP-server>:4000` หรือลิงก์ HTTPS แล้ว ค่อย `pm2 delete datahub-client` แล้ว `pm2 save`
- **ย้อนกลับเป็นแบบเดิม:** `pm2 delete dochub` แล้ว `pm2 start ecosystem.config.js --only datahub-server`

## 4. โดเมน (ทำครั้งเดียว)

1. ขอโดเมน (เช่นโดเมนฟรี `.dpdns.org` ของ DigitalPlat — 1 บัญชีได้ 1 ชื่อ, ต่ออายุฟรีภายใน 120 วันก่อนหมดอายุ) ตอนจดเลือก delegation เป็น **External nameservers** หรือ **Configure later**
2. Cloudflare → **Add a domain** → แพ็กเกจ **Free** → ไม่ต้องเพิ่ม DNS record เอง → คัดลอก nameserver 2 ตัว
3. ใส่ nameserver 2 ตัวนั้นที่ผู้จดโดเมน (ลบตัวอื่นออก) → รอ Cloudflare ขึ้น **Active**
4. **DNSSEC ปิดไว้** · **อย่าเพิ่ม A record ที่เป็น IP บริษัท** (record ของ tunnel ถูกสร้างให้ในขั้นที่ 5)

## 5. Cloudflare Tunnel (ทำครั้งเดียว หลังโดเมน Active)

```powershell
winget install --id Cloudflare.cloudflared      # เปิด PowerShell ใหม่หลังติดตั้ง แล้วลอง: cloudflared --version
cloudflared tunnel login                        # เปิดเบราว์เซอร์ → เลือกโดเมน → Authorize
cloudflared tunnel create dochub                # จด Tunnel ID (UUID) ที่พิมพ์ออกมา
cloudflared tunnel route dns dochub dochub.example.dpdns.org
```

คัดลอก [`deploy/cloudflared/config.example.yml`](../deploy/cloudflared/config.example.yml) ไปเป็น
`%USERPROFILE%\.cloudflared\config.yml` แล้วใส่ Tunnel ID, ชื่อผู้ใช้ Windows และชื่อโดเมนให้ตรง

ทดสอบก่อน (ปิดด้วย Ctrl+C):

```powershell
cloudflared tunnel --config "$env:USERPROFILE\.cloudflared\config.yml" run
```

เปิด `https://dochub.example.dpdns.org` จากมือถือที่ใช้เน็ตมือถือ → ต้องเห็นหน้า login · จากนั้นให้ PM2 ดูแล:

```powershell
pm2 start ecosystem.production.config.js --only dochub-tunnel
pm2 save
```

- PM2 หา `cloudflared.exe` เองจากที่ติดตั้งปกติ ถ้าหาไม่เจอให้ตั้ง `CLOUDFLARED_PATH` (ดูที่อยู่ด้วย `where.exe cloudflared`)
- ต้องรัน PM2 ด้วยผู้ใช้ Windows คนเดียวกับที่สั่ง `cloudflared tunnel login` (ไฟล์อยู่ใน `%USERPROFILE%\.cloudflared`)

## 6. ตั้งค่าใน Cloudflare ที่แนะนำ

- **SSL/TLS → Edge Certificates → Always Use HTTPS = On**
- **AI Crawl Control:** Block (Search / Training / Agents) — กัน share link (`/s/<token>`) ที่หลุดไปถูกเก็บโดย search engine/AI
- อยากล็อกให้เข้าได้เฉพาะพนักงาน: Zero Trust → Access → Application ครอบ `dochub.<โดเมน>` (ฟรี ≤ 50 คน, ยืนยันด้วยรหัส OTP ทางอีเมล)

## ใช้บนมือถือ

- **เพิ่มไอคอนลงหน้าจอโฮม:** iPhone (Safari) → ปุ่มแชร์ → *เพิ่มไปยังหน้าจอโฮม* · Android (Chrome) → ⋮ → *ติดตั้งแอป* / *เพิ่มลงในหน้าจอหลัก*
  เปิดจากไอคอนจะเต็มจอแบบแอป (ไม่มีแถบของ Safari — เปิดในแท็บ Safari จะซ่อนแถบไม่ได้) · ไอคอนที่เพิ่มไว้ก่อนอัปเดตนี้ไม่เปลี่ยนเอง: ลบไอคอนเดิม, รีเฟรชหน้าเว็บ แล้วเพิ่มใหม่
  ถ้ายังได้ไอคอนตัวอักษร: Cloudflare → Caching → Configuration → Purge Everything แล้วลองใหม่
- **ในชีต:** ปุ่ม *ซ่อนเครื่องมือ* (ขวาของแท็บชีต) ซ่อนแถบด้านบน/เครื่องมือ/ตัวกรองเพื่อดูข้อมูลเต็มจอ, ปุ่ม *เครื่องมือ* แสดงกลับ (ตัวเลขบนปุ่ม = มีตัวกรอง/คำค้นอยู่) · เครื่องจำค่าที่เลือกไว้; มือถือเริ่มแบบซ่อน (แตะ *เครื่องมือ* เพื่อกลับไปเมนู/ค้นหา)
- ไอคอนอยู่ที่ `client/public/` (ทำจาก `client/public/icons/icon.svg`) · ชื่อแอปบนหน้าจอโฮม (Quality) ตั้งที่ `client/public/manifest.webmanifest` และ `client/index.html`

## อัปเดตโค้ดครั้งต่อไป

```powershell
git pull
```

เท่านั้น: หน้าเว็บใหม่มีผลทันที (ผู้ใช้กด F5) · `dochub` รีสตาร์ตเองประมาณ 5 วินาทีหลังมี `server/dist` ใหม่ (PM2 watch)

- ครั้งแรกหลังเปลี่ยนมาใช้วิธีนี้ ให้ PM2 อ่านค่าใหม่ 1 ครั้ง: `pm2 delete dochub` → `pm2 start ecosystem.production.config.js --only dochub` → `pm2 save`
- ถ้าเคย build บน server เอง แล้ว `git pull` บอกว่าไฟล์ใน dist ถูกแก้ไข: `git checkout -- client/dist server/dist` แล้ว pull ใหม่

## ความปลอดภัย (ตรวจก่อนเปิดลิงก์)

- [ ] `JWT_SECRET` เป็นค่าสุ่มใหม่ (ไม่ใช่ค่าตัวอย่าง)
- [ ] เปลี่ยนรหัสบัญชีตัวอย่างจาก seed (`admin` / `Admin@123`, `master`, `user`) หรือปิดบัญชีที่ไม่ใช้
- [ ] พอร์ต 1433 และ 4000 ไม่ได้ถูกเปิดที่ router / firewall (tunnel ไม่ต้องใช้)
- [ ] `DB_USER` ไม่ใช่ `sa`
- [ ] ตั้งเตือนต่ออายุโดเมน

## แก้ปัญหา

| อาการ | ตรวจ |
|---|---|
| `pm2 logs dochub` ขึ้น `JWT_SECRET must be a random value` | ยังไม่ได้เปลี่ยน `JWT_SECRET` ใน `server\.env` |
| `Cannot connect to SQL Server` | ค่า `DB_*` ใน `server\.env` / SQL Server เปิดอยู่ไหม |
| เปิด :4000 ได้แต่หน้าเว็บว่าง / 404 | `SERVE_CLIENT_DIR=../client/dist` และ build client แล้วหรือยัง |
| login แล้วเด้งออก | `COOKIE_SECURE=false` ตอนเข้าผ่าน http |
| ลิงก์สาธารณะขึ้น Error 1033 | tunnel ไม่ได้รัน → `pm2 logs dochub-tunnel` |
| ลิงก์สาธารณะขึ้น 502 | DocHUB ไม่ได้รันที่ :4000 → `pm2 logs dochub` |
| Cloudflare ค้าง Pending | nameserver ที่ผู้จดโดเมนต้องตรงกับใน Cloudflare ทุกตัวอักษร |
