/**
 * เนื้อหาคู่มือ: แต่ละเรื่อง = ขั้นตอนที่ทำจริงบนแอป + ข้อความ + จุดที่ต้องกด (กรอบ/ลูกศร)
 * r.shot({ title, text, tip, marks: [{ el, label, place? }] }) แคปหน้าจอ · r.note({...}) ขั้นตอนที่ไม่มีภาพ
 * **ตัวหนา** ใช้ได้ใน text / tip / label · ข้อมูลที่ใช้ = ข้อมูลตัวอย่างของ npm run db:seed เท่านั้น
 */
const FILE = 'IR LINE PF1-09';
const role = (p, r, name, o = {}) => p.getByRole(r, { name, ...o });
const sidebar = (p, name) => p.locator('aside nav a, aside a').filter({ hasText: name });
/** the whole input box (icon + input), not only the inner <input> */
const box = (el) => el.locator('xpath=ancestor-or-self::*[contains(concat(" ", @class, " "), " ds-input ")][1]').or(el); // (the input itself when it has no box)
/** a field of the row form: <label><span>name</span> control</label> */
const fld = (scope, name) => scope.locator('label').filter({ has: scope.page().locator('span', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')}$`) }) }).first();
const ctl = (f) => f.locator('input, textarea, button:not([title="สแกนใส่ช่องนี้"]), [role="switch"]').first();
const QH_FILE = 'a6e60e98-364e-4585-a4d0-eb09e3964ad2';
const QH_DASH = '1e6bcab4-c396-44a7-9522-48c85ae4ae3e';
/** pick a value from a SearchSelect popover */
async function choose(r, button, text) {
  await button.click();
  await r.settle(350);
  await r.page.getByText(text, { exact: true }).last().click();
  await r.settle(250);
}

async function openDemoFile(r) {
  const p = r.page;
  await r.go('/browse');
  await p.getByText('Production Reports', { exact: true }).first().click(); await r.settle();
  await p.getByText('QC Line', { exact: true }).first().click(); await r.settle();
  await p.getByText(FILE, { exact: true }).first().click(); await r.settle(1500);
}

module.exports = [
  /* ================================================================ */
  {
    id: 'start', title: 'เริ่มต้นใช้งาน', icon: 'rocket', description: 'เข้าสู่ระบบ ขอสร้างบัญชี และรู้จักหน้าจอหลัก',
    guides: [
      {
        id: 'login', title: 'เข้าสู่ระบบ', summary: 'เปิดเว็บไซต์แล้วเข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่านที่ได้รับ', as: null,
        run: async (r) => {
          const p = r.page;
          await r.go('/login');
          await r.shot({
            title: 'เปิดหน้าเข้าสู่ระบบ',
            text: 'เปิดเบราว์เซอร์ (Chrome, Edge หรือ Safari) แล้วพิมพ์ที่อยู่ **https://dochub.qcqrxdigital.dpdns.org** ในช่องที่อยู่ด้านบน แล้วกด Enter\nจะเห็นหน้าเข้าสู่ระบบตามภาพ',
            tip: 'บนมือถือเพิ่มไอคอนไว้ที่หน้าจอได้ ดูเรื่อง “เพิ่มไอคอน Quality บนหน้าจอมือถือ”',
            marks: [{ el: box(p.locator('input[autocomplete="username"]')), label: 'ช่องชื่อผู้ใช้หรืออีเมล' }, { el: box(p.locator('input[autocomplete="current-password"]')), label: 'ช่องรหัสผ่าน' }],
          });
          await p.fill('input[autocomplete="username"]', 'user');
          await p.fill('input[autocomplete="current-password"]', 'User@1234');
          await r.shot({
            title: 'กรอกชื่อผู้ใช้และรหัสผ่าน',
            text: 'คลิกที่ช่องแรกแล้วพิมพ์**ชื่อผู้ใช้** (หรืออีเมล) จากนั้นคลิกช่องที่สองแล้วพิมพ์**รหัสผ่าน** (ตัวพิมพ์เล็ก/ใหญ่ต้องตรงกัน)',
            marks: [
              { el: box(p.locator('input[autocomplete="username"]')), label: 'พิมพ์ชื่อผู้ใช้ที่ได้รับจากผู้ดูแลระบบ' },
              { el: p.getByRole('button', { name: 'แสดงรหัสผ่าน' }), label: 'กดรูปตาเพื่อดูรหัสผ่านที่พิมพ์ (ไม่บังคับ)', place: 'right' },
            ],
          });
          await r.shot({
            title: 'กดปุ่ม “เข้าสู่ระบบ”',
            text: 'กดปุ่ม **เข้าสู่ระบบ** สีน้ำเงิน ถ้าชื่อผู้ใช้หรือรหัสผ่านผิด จะมีข้อความสีแดงแจ้งเหนือปุ่ม ให้ตรวจแล้วพิมพ์ใหม่',
            tip: 'ลืมรหัสผ่าน: แจ้งผู้ดูแลระบบ (Admin) ให้ตั้งรหัสผ่านใหม่ · ยังไม่มีบัญชี: ดูเรื่อง “ขอสร้างบัญชี”',
            marks: [{ el: p.locator('button[type="submit"]'), label: 'กด เข้าสู่ระบบ' }],
          });
          await p.click('button[type="submit"]');
          await p.waitForURL((x) => !x.pathname.startsWith('/login'));
          await r.shot({
            title: 'เข้าสู่ระบบสำเร็จ',
            text: 'ระบบจะพาไปที่**หน้าแรก** เห็นชื่อของคุณที่มุมขวาบน และเมนูทางซ้าย\nระบบจำการเข้าสู่ระบบไว้ ครั้งต่อไปเปิดเว็บแล้วเข้าใช้งานได้เลย',
            wait: 1200,
            marks: [{ el: p.getByRole('button', { name: 'เมนูผู้ใช้' }), label: 'ชื่อของคุณ = เข้าสู่ระบบแล้ว' }, { el: p.locator('aside nav').first(), label: 'เมนูหลัก', place: 'right' }],
          });
        },
      },
      {
        id: 'signup', title: 'ขอสร้างบัญชี (ยังไม่มีบัญชี)', summary: 'ส่งคำขอบัญชีใหม่ พร้อมเลือกระดับที่ต้องการ แล้วรอผู้ดูแลระบบอนุมัติ', as: null,
        run: async (r) => {
          const p = r.page;
          await r.go('/login');
          await r.shot({
            title: 'กด “ขอสร้างบัญชี” ที่หน้าเข้าสู่ระบบ',
            text: 'ที่หน้าเข้าสู่ระบบ ใต้ปุ่มเข้าสู่ระบบ กดลิงก์ **ขอสร้างบัญชี**',
            marks: [{ el: p.getByRole('link', { name: 'ขอสร้างบัญชี' }), label: 'กด ขอสร้างบัญชี' }],
          });
          await p.getByRole('link', { name: 'ขอสร้างบัญชี' }).click();
          await r.settle();
          const inp = p.locator('form input');
          await inp.nth(0).fill('วิไล ใจงาม');
          await inp.nth(1).fill('wilai@example.com');
          await inp.nth(2).fill('wilai');
          await r.shot({
            title: 'กรอกชื่อ อีเมล และชื่อผู้ใช้',
            text: 'กรอกข้อมูลให้ครบทุกช่องที่มีเครื่องหมาย *\n**ชื่อผู้ใช้** คือชื่อที่จะใช้เข้าสู่ระบบ ใช้ได้เฉพาะ a-z ตัวเลข และ . _ - อย่างน้อย 3 ตัว',
            marks: [
              { el: box(inp.nth(0)), label: 'ชื่อ-นามสกุลจริง', place: 'right' },
              { el: box(inp.nth(1)), label: 'อีเมลที่ใช้งานอยู่', place: 'right' },
              { el: box(inp.nth(2)), label: 'ตั้งชื่อผู้ใช้สำหรับเข้าสู่ระบบ', place: 'right' },
            ],
          });
          await inp.nth(3).fill('Wilai2026!');
          await inp.nth(4).fill('Wilai2026!');
          await r.shot({
            title: 'ตั้งรหัสผ่าน',
            text: 'ตั้งรหัสผ่านอย่างน้อย 8 ตัวอักษร แล้วพิมพ์ซ้ำอีกครั้งในช่อง **ยืนยันรหัสผ่าน** ให้ตรงกัน\nจำรหัสผ่านนี้ไว้ ใช้เข้าสู่ระบบหลังได้รับอนุมัติ',
            marks: [{ el: box(inp.nth(3)), label: 'รหัสผ่าน (อย่างน้อย 8 ตัว)', place: 'right' }, { el: box(inp.nth(4)), label: 'พิมพ์รหัสผ่านซ้ำ', place: 'right' }],
          });
          await p.locator('form select').selectOption('user');
          await p.locator('form textarea').fill('QC ไลน์ PF1 บันทึกผลตรวจประจำวัน');
          await p.locator('form select').scrollIntoViewIfNeeded();
          await r.shot({
            title: 'เลือกระดับที่ต้องการ และบอกแผนก',
            text: 'เลือก**ระดับที่ต้องการ**:\n• **Viewer** ดูข้อมูลอย่างเดียว\n• **User** กรอก/แก้ไขข้อมูลในไฟล์ที่ได้รับสิทธิ์ (พนักงานส่วนใหญ่)\n• **Master** สร้างฟอร์มเอกสารและโฟลเดอร์ได้\n• **Admin** ผู้ดูแลระบบ\nผู้ดูแลระบบเป็นคนกำหนดระดับจริงตอนอนุมัติ',
            marks: [{ el: p.locator('form select'), label: 'เลือกระดับ', place: 'right' }, { el: p.locator('form textarea'), label: 'แผนก / เหตุผล ช่วยให้อนุมัติเร็วขึ้น', place: 'right' }],
          });
          await r.shot({
            title: 'กด “ส่งคำขอ”',
            text: 'ตรวจข้อมูลอีกครั้งแล้วกด **ส่งคำขอ**',
            marks: [{ el: role(p, 'button', 'ส่งคำขอ'), label: 'กด ส่งคำขอ', place: 'above' }],
          });
          await role(p, 'button', 'ส่งคำขอ').click();
          await p.getByText('ส่งคำขอสร้างบัญชีแล้ว').waitFor();
          await r.shot({
            title: 'รอผู้ดูแลระบบอนุมัติ',
            text: 'ผู้ดูแลระบบได้รับการแจ้งเตือนทันที เมื่ออนุมัติแล้วกลับไปหน้าเข้าสู่ระบบ แล้วใช้**ชื่อผู้ใช้และรหัสผ่านที่ตั้งไว้**ได้เลย',
            tip: 'ถ้าบริษัทเปิดใช้ปุ่ม **Microsoft** ที่หน้าเข้าสู่ระบบ ก็ขอบัญชีด้วยอีเมล Microsoft ได้: กดปุ่ม Microsoft → เข้าสู่ระบบ Microsoft → ระบบจะพามาที่ฟอร์มนี้ (ไม่ต้องตั้งรหัสผ่าน)',
            marks: [{ el: p.getByText('ส่งคำขอสร้างบัญชีแล้ว'), label: 'ส่งคำขอเรียบร้อย' }, { el: role(p, 'button', 'กลับไปหน้าเข้าสู่ระบบ'), label: 'กลับไปหน้าเข้าสู่ระบบ' }],
          });
        },
      },
      {
        id: 'tour', title: 'รู้จักหน้าจอหลัก', summary: 'เมนูด้านซ้าย ช่องค้นหา การแจ้งเตือน และเมนูของฉัน', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.shot({
            title: 'เมนูด้านซ้าย',
            text: 'เมนูหลักอยู่ด้านซ้ายเสมอ กดเพื่อไปหน้าต่างๆ ได้ทุกเมื่อ',
            marks: [
              { el: sidebar(p, 'ไฟล์ทั้งหมด'), label: 'ไฟล์ทั้งหมด: เปิดโฟลเดอร์และไฟล์', place: 'right' },
              { el: sidebar(p, 'คำขอสิทธิ์'), label: 'คำขอสิทธิ์: ขอ/ติดตามสิทธิ์เข้าถึงไฟล์', place: 'right' },
              { el: sidebar(p, 'คู่มือ'), label: 'คู่มือ: วิธีใช้งานทุกเรื่อง (หน้านี้)', place: 'right' },
            ],
          });
          await r.shot({
            title: 'แถบด้านบน',
            text: 'ด้านบนมีช่องค้นหาไฟล์ ปุ่มกระดิ่งแจ้งเตือน และชื่อของคุณ',
            marks: [
              { el: p.getByPlaceholder('ค้นหาไฟล์หรือโฟลเดอร์…'), label: 'ค้นหาไฟล์/โฟลเดอร์จากชื่อ' },
              { el: role(p, 'button', 'การแจ้งเตือน'), label: 'การแจ้งเตือน (ตัวเลขสีแดง = ยังไม่ได้อ่าน)', place: 'below' },
              { el: role(p, 'button', 'เมนูผู้ใช้'), label: 'เมนูของฉัน', place: 'left' },
            ],
          });
          await role(p, 'button', 'การแจ้งเตือน').click();
          await r.settle();
          await r.shot({
            title: 'ดูการแจ้งเตือน',
            text: 'กดรูป**กระดิ่ง**เพื่อดูการแจ้งเตือน เช่น ได้รับสิทธิ์ไฟล์ใหม่ คำขอสิทธิ์ได้รับอนุมัติ กดที่รายการเพื่อเปิดเรื่องนั้น',
            marks: [{ el: role(p, 'button', 'การแจ้งเตือน'), label: 'กดกระดิ่ง', place: 'left' }],
          });
          await p.keyboard.press('Escape');
          await p.mouse.click(640, 700);
          await r.settle(300);
          await role(p, 'button', 'เมนูผู้ใช้').click();
          await r.settle();
          await r.shot({
            title: 'เมนูของฉัน',
            text: 'กดที่**ชื่อของคุณ**มุมขวาบน จะมีเมนู:\n• **โปรไฟล์ของฉัน** แก้ชื่อ อีเมล และเปลี่ยนรหัสผ่าน\n• **ธีมและรูปแบบ** เปลี่ยนสีหน้าจอ\n• **ออกจากระบบ** ใช้เมื่อใช้เครื่องร่วมกับคนอื่น',
            marks: [{ el: p.getByRole('menuitem', { name: 'โปรไฟล์ของฉัน' }).or(p.getByText('โปรไฟล์ของฉัน')), label: 'แก้ข้อมูล / เปลี่ยนรหัสผ่าน', place: 'left' }, { el: p.getByRole('menuitem', { name: 'ออกจากระบบ' }).or(p.locator('[role="menu"] >> text=ออกจากระบบ')), label: 'ออกจากระบบ', place: 'left' }],
          });
        },
      },
      {
        id: 'password', title: 'เปลี่ยนรหัสผ่าน', summary: 'เปลี่ยนรหัสผ่านของตัวเองจากหน้าโปรไฟล์', as: 'user',
        run: async (r) => {
          const p = r.page;
          await role(p, 'button', 'เมนูผู้ใช้').click();
          await r.settle(300);
          const prof = p.getByText('โปรไฟล์ของฉัน').first();
          await r.shot({ title: 'เปิดเมนูของฉัน แล้วกด “โปรไฟล์ของฉัน”', text: 'กดที่**ชื่อของคุณ**มุมขวาบน แล้วเลือก **โปรไฟล์ของฉัน**', marks: [{ el: prof, label: 'กด โปรไฟล์ของฉัน', place: 'left' }] });
          await prof.click();
          await r.settle(900);
          const tab = p.getByRole('button', { name: 'รหัสผ่าน', exact: true }).or(p.getByRole('tab', { name: 'รหัสผ่าน' })).first();
          await r.shot({ title: 'เลือกแท็บ “รหัสผ่าน”', text: 'หน้า **ตั้งค่า** มีแท็บด้านขวาบน กดแท็บ **รหัสผ่าน**', marks: [{ el: tab, label: 'กดแท็บ รหัสผ่าน', place: 'below' }] });
          await tab.click();
          await r.settle(500);
          const cur = p.locator('input[type="password"]').nth(0);
          await cur.scrollIntoViewIfNeeded();
          await cur.fill('User@1234');
          await p.locator('input[type="password"]').nth(1).fill('NewPass2026!');
          await p.locator('input[type="password"]').nth(2).fill('NewPass2026!');
          await r.shot({
            title: 'กรอกรหัสผ่านเดิมและรหัสผ่านใหม่',
            text: 'เลื่อนลงไปที่ส่วน **เปลี่ยนรหัสผ่าน**\n1) พิมพ์รหัสผ่านปัจจุบัน 2) พิมพ์รหัสผ่านใหม่ (อย่างน้อย 8 ตัว) 3) พิมพ์รหัสผ่านใหม่ซ้ำอีกครั้ง',
            marks: [
              { el: p.locator('input[type="password"]').nth(0), label: 'รหัสผ่านปัจจุบัน', place: 'right' },
              { el: p.locator('input[type="password"]').nth(1), label: 'รหัสผ่านใหม่', place: 'right' },
              { el: p.locator('input[type="password"]').nth(2), label: 'พิมพ์รหัสผ่านใหม่ซ้ำ', place: 'right' },
            ],
          });
          const btn = role(p, 'button', 'เปลี่ยนรหัสผ่าน');
          await r.shot({
            title: 'กด “เปลี่ยนรหัสผ่าน”',
            text: 'กดปุ่ม **เปลี่ยนรหัสผ่าน** ระบบแจ้ง “เปลี่ยนรหัสผ่านแล้ว” ครั้งต่อไปใช้รหัสผ่านใหม่เข้าสู่ระบบ',
            tip: 'ลืมรหัสผ่านเดิม: ให้ผู้ดูแลระบบรีเซ็ตให้ (เมนู จัดการผู้ใช้ → ⋯ → รีเซ็ตรหัสผ่าน)',
            marks: [{ el: btn, label: 'กด เปลี่ยนรหัสผ่าน' }],
          });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'files', title: 'ไฟล์และโฟลเดอร์', icon: 'folder', description: 'เปิด ค้นหา สร้าง ย้าย และจัดการไฟล์',
    guides: [
      {
        id: 'open-file', title: 'เปิดโฟลเดอร์และไฟล์', summary: 'ไล่จากเมนู ไฟล์ทั้งหมด → โฟลเดอร์ → ไฟล์ที่ต้องการ', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “ไฟล์ทั้งหมด”', text: 'กดเมนู **ไฟล์ทั้งหมด** ทางซ้าย', marks: [{ el: sidebar(p, 'ไฟล์ทั้งหมด'), label: 'กด ไฟล์ทั้งหมด', place: 'right' }] });
          await sidebar(p, 'ไฟล์ทั้งหมด').click(); await r.settle();
          await r.shot({ title: 'เลือกโฟลเดอร์', text: 'จะเห็นโฟลเดอร์ระดับบนสุด กดที่การ์ดโฟลเดอร์ที่ต้องการเพื่อเปิด (เช่น **Production Reports**)', marks: [{ el: p.getByText('Production Reports', { exact: true }).first(), label: 'กดที่โฟลเดอร์' }] });
          await p.getByText('Production Reports', { exact: true }).first().click(); await r.settle();
          await r.shot({
            title: 'เปิดโฟลเดอร์ย่อย',
            text: 'ในโฟลเดอร์อาจมีโฟลเดอร์ย่อยอีกชั้น กดเข้าไปเรื่อยๆ จนเจอไฟล์ · แถบชื่อด้านบน (breadcrumb) ใช้กดย้อนกลับขึ้นไปได้',
            marks: [{ el: p.getByText('QC Line', { exact: true }).first(), label: 'กดโฟลเดอร์ย่อย' }, { el: p.locator('nav').filter({ hasText: 'ไฟล์ทั้งหมด' }).first(), label: 'กดชื่อด้านบนเพื่อย้อนกลับ', place: 'below' }],
          });
          await p.getByText('QC Line', { exact: true }).first().click(); await r.settle();
          await r.shot({ title: 'กดที่ไฟล์', text: 'ไฟล์จะมีไอคอนตาราง กดที่การ์ดไฟล์เพื่อเปิด', marks: [{ el: p.getByText(FILE, { exact: true }).first(), label: `กดไฟล์ ${FILE}` }] });
          await p.getByText(FILE, { exact: true }).first().click(); await r.settle(1500);
          await r.shot({
            title: 'หน้าไฟล์ (ตารางข้อมูล)',
            text: 'ไฟล์เปิดเป็นตาราง แต่ละไฟล์มีได้หลาย**ชีต** (แท็บด้านบน) · เลื่อนตารางซ้าย-ขวา/ขึ้น-ลงได้ · ด้านล่างมีปุ่มเปลี่ยนหน้า',
            marks: [
              { el: role(p, 'button', 'Daily Output'), label: 'แท็บชีต กดเพื่อสลับชีต', place: 'below' },
              { el: role(p, 'button', 'เพิ่มแถว'), label: 'เพิ่มแถวใหม่', place: 'below' },
              { el: p.getByPlaceholder('ค้นหาในชีต…'), label: 'ค้นหาข้อมูลในชีต', place: 'below' },
            ],
          });
        },
      },
      {
        id: 'search-files', title: 'ค้นหาไฟล์และโฟลเดอร์', summary: 'พิมพ์ชื่อบางส่วนในช่องค้นหาด้านบน', as: 'user',
        run: async (r) => {
          const p = r.page;
          const box = p.getByPlaceholder('ค้นหาไฟล์หรือโฟลเดอร์…');
          await box.click();
          await box.fill('PF1');
          await r.settle(1200);
          await r.shot({ title: 'พิมพ์คำค้นในช่องค้นหา', text: 'คลิกช่อง **ค้นหาไฟล์หรือโฟลเดอร์** ด้านบน แล้วพิมพ์ชื่อบางส่วน ระบบแสดงผลทันทีด้านล่างช่อง · กดที่ผลลัพธ์เพื่อเปิด', tip: 'คีย์ลัด: กด **Ctrl + K** เพื่อไปที่ช่องค้นหาได้ทันที', marks: [{ el: box, label: 'พิมพ์ชื่อไฟล์บางส่วน', place: 'right' }] });
          await box.press('Enter');
          await r.settle(1200);
          await r.shot({ title: 'กด Enter เพื่อดูผลทั้งหมด', text: 'กด **Enter** จะเปิดหน้าผลการค้นหาทั้งหมด กดชื่อไฟล์เพื่อเปิด', marks: [{ el: p.getByText(FILE, { exact: true }).last(), label: 'กดเพื่อเปิดไฟล์' }] });
        },
      },
      {
        id: 'create-folder', title: 'สร้างโฟลเดอร์', summary: 'สร้างโฟลเดอร์ใหม่หรือโฟลเดอร์ย่อยเพื่อจัดเก็บไฟล์', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/browse');
          await p.getByText('Production Reports', { exact: true }).first().click(); await r.settle();
          await r.shot({ title: 'เปิดโฟลเดอร์ที่จะสร้างโฟลเดอร์ย่อย', text: 'ไปที่โฟลเดอร์ที่ต้องการ (หรือหน้า **ไฟล์ทั้งหมด** เพื่อสร้างโฟลเดอร์ระดับบนสุด) แล้วกดปุ่ม **สร้างใหม่**', marks: [{ el: role(p, 'button', 'สร้างใหม่'), label: 'กด สร้างใหม่', place: 'left' }] });
          await role(p, 'button', 'สร้างใหม่').click(); await r.settle(300);
          await r.shot({ title: 'เลือก “โฟลเดอร์”', text: 'จากเมนูที่ขึ้นมา เลือก **โฟลเดอร์**', marks: [{ el: p.getByRole('menuitem', { name: 'โฟลเดอร์' }).or(p.locator('[role="menu"]').getByText('โฟลเดอร์', { exact: true })), label: 'เลือก โฟลเดอร์', place: 'left' }] });
          await p.getByRole('menuitem', { name: 'โฟลเดอร์' }).or(p.locator('[role="menu"]').getByText('โฟลเดอร์', { exact: true })).first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await dlg.locator('input').first().fill('รายงานประจำเดือน');
          await r.shot({ title: 'ตั้งชื่อและเลือกสี', text: 'พิมพ์**ชื่อโฟลเดอร์** เลือกสี และใส่คำอธิบาย (ไม่บังคับ)', marks: [{ el: dlg.locator('input').first(), label: 'พิมพ์ชื่อโฟลเดอร์', place: 'right' }, { el: role(dlg, 'button', 'บันทึก'), label: 'กด บันทึก', place: 'above' }] });
          await role(dlg, 'button', 'บันทึก').click(); await r.settle(900);
          await r.shot({ title: 'โฟลเดอร์ใหม่พร้อมใช้งาน', text: 'โฟลเดอร์ใหม่จะแสดงในรายการทันที · ผู้สร้างโฟลเดอร์มีสิทธิ์**จัดการ**โฟลเดอร์นั้น (แชร์ให้คนอื่นได้)', marks: [{ el: p.getByText('รายงานประจำเดือน', { exact: true }).first(), label: 'โฟลเดอร์ที่สร้าง' }] });
        },
      },
      {
        id: 'item-menu', title: 'เปลี่ยนชื่อ ย้าย ทำสำเนา และลบ', summary: 'เมนู ⋯ ของไฟล์/โฟลเดอร์', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/browse');
          await p.getByText('Production Reports', { exact: true }).first().click(); await r.settle();
          await p.getByText('QC Line', { exact: true }).first().click(); await r.settle();
          const card = p.locator('a, div').filter({ hasText: FILE }).filter({ has: p.getByRole('button', { name: 'ตัวเลือก' }) }).last();
          const more = card.getByRole('button', { name: 'ตัวเลือก' });
          await card.hover();
          await r.shot({ title: 'กดปุ่ม ⋯ ที่การ์ดไฟล์', text: 'ชี้ที่การ์ดไฟล์หรือโฟลเดอร์ แล้วกดปุ่ม **⋯** (หรือคลิกขวาที่การ์ด)', marks: [{ el: more, label: 'กด ⋯', place: 'right' }] });
          await more.click(); await r.settle(300);
          const menu = p.locator('[role="menu"]').last();
          await r.shot({
            title: 'เลือกคำสั่งที่ต้องการ',
            text: '• **เปลี่ยนชื่อ / แก้ไขรายละเอียด** ชื่อ สี คำอธิบาย\n• **ย้าย** ไปโฟลเดอร์อื่น\n• **ทำสำเนา** ใช้เป็นแม่แบบไฟล์ใหม่\n• **แชร์** ให้สิทธิ์คนอื่น\n• **ลบ** ย้ายไปถังขยะ (กู้คืนได้)',
            marks: [{ el: menu, label: 'เมนูคำสั่งของไฟล์', place: 'right' }],
          });
          const move = menu.getByText('ย้าย', { exact: false }).first();
          await move.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await dlg.getByRole('button', { name: 'Production Reports' }).locator('xpath=preceding-sibling::button[1]').click();
          await r.settle(300);
          await dlg.getByRole('button', { name: 'Weekly Summary' }).click();
          await r.shot({ title: 'ตัวอย่าง: ย้ายไฟล์', text: 'เลือกโฟลเดอร์ปลายทาง (กดลูกศร ▸ เพื่อดูโฟลเดอร์ย่อย) แล้วกด **ย้ายมาที่นี่** · ถ้าไม่ต้องการแล้วกด **ยกเลิก**', marks: [{ el: dlg.getByRole('button', { name: 'Weekly Summary' }), label: 'เลือกโฟลเดอร์ปลายทาง', place: 'right' }, { el: role(dlg, 'button', 'ย้ายมาที่นี่'), label: 'กด ย้ายมาที่นี่', place: 'above' }] });
          await role(dlg, 'button', 'ยกเลิก').click();
        },
      },
    ],
  },


  /* ================================================================ */
  {
    id: 'data', title: 'กรอกและแก้ไขข้อมูล', icon: 'sheet', description: 'เพิ่มแถว แก้ไขเซลล์ ค้นหา กรอง ประวัติ และกู้คืน',
    guides: [
      {
        id: 'add-row', title: 'เพิ่มแถวใหม่ (กรอกข้อมูล)', summary: 'กรอกข้อมูลผ่านฟอร์มทีละช่อง แล้วบันทึกลงตาราง', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          await r.shot({ title: 'กดปุ่ม “+ เพิ่มแถว”', text: 'เปิดไฟล์ที่ต้องการกรอก (ดูเรื่อง “เปิดโฟลเดอร์และไฟล์”) แล้วกดปุ่ม **+ เพิ่มแถว** บนแถบเครื่องมือ', marks: [{ el: role(p, 'button', 'เพิ่มแถว'), label: 'กด + เพิ่มแถว', place: 'below' }] });
          await role(p, 'button', 'เพิ่มแถว').click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({
            title: 'ฟอร์มกรอกข้อมูลจะเปิดขึ้น',
            text: 'แต่ละช่องคือหัวคอลัมน์ของตาราง ช่องที่มีเครื่องหมายดอกจัน (*) สีแดงต้องกรอก\nหน้าต่างนี้**ไม่ปิดเอง**ถ้าเผลอแตะนอกกรอบ ข้อมูลที่พิมพ์ไว้ไม่หาย',
            marks: [{ el: dlg.locator('h2').first(), label: 'ฟอร์มเพิ่มแถวใหม่' }, { el: role(dlg, 'button', 'ปิด').first(), label: 'ปิดฟอร์มโดยไม่บันทึก', place: 'left' }],
          });
          await ctl(fld(dlg, 'วันที่')).fill(new Date().toISOString().slice(0, 10));
          await r.shot({ title: 'กรอกวันที่', text: 'คลิกช่อง**วันที่** แล้วพิมพ์ วัน/เดือน/ปี หรือกดรูปปฏิทินเพื่อเลือกวัน', marks: [{ el: ctl(fld(dlg, 'วันที่')), label: 'กรอกหรือเลือกวันที่', place: 'below' }] });
          await ctl(fld(dlg, 'ไลน์')).click(); await r.settle(400);
          const opt = p.getByRole('option', { name: 'PF1-10' }).or(p.getByRole('button', { name: 'PF1-10', exact: true })).last();
          await r.shot({ title: 'เลือกค่าจากรายการ', text: 'ช่องที่มีลูกศร ⌄ เป็นช่อง**เลือกจากรายการ** กดที่ช่องแล้วเลือกค่าที่ต้องการ (พิมพ์ค้นหาในรายการได้)', marks: [{ el: opt, label: 'กดเลือกค่า', place: 'right' }] });
          await opt.click(); await r.settle(300);
          await choose(r, ctl(fld(dlg, 'กะ')), 'กะเช้า');
          await ctl(fld(dlg, 'ผู้บันทึก')).fill('สมหญิง');
          await ctl(fld(dlg, 'ยอดผลิต')).fill('1250');
          await ctl(fld(dlg, 'ของเสีย')).fill('12');
          await r.shot({
            title: 'กรอกช่องที่เหลือ',
            text: 'ช่องข้อความพิมพ์ได้เลย · ช่องตัวเลขพิมพ์ได้เฉพาะตัวเลข · ถ้ากรอกไม่ถูกรูปแบบ ช่องจะเป็นสีแดงพร้อมบอกเหตุผล',
            marks: [{ el: ctl(fld(dlg, 'ผู้บันทึก')), label: 'พิมพ์ข้อความ', place: 'right' }, { el: ctl(fld(dlg, 'ยอดผลิต')), label: 'พิมพ์ตัวเลข', place: 'left' }],
          });
          await ctl(fld(dlg, 'ตรวจสอบแล้ว')).click();
          await r.shot({
            title: 'สวิตช์ ใช่/ไม่ใช่ และป้ายเลือกได้หลายค่า',
            text: 'สวิตช์: แตะเพื่อสลับ **ใช่ / ไม่ใช่** · ป้าย (เช่น แท็ก): แตะเลือกได้หลายค่า แตะซ้ำเพื่อยกเลิก',
            marks: [{ el: dlg.locator('[role="switch"]').first(), label: 'แตะเพื่อสลับ ใช่/ไม่ใช่', place: 'left' }, { el: fld(dlg, 'แท็ก'), label: 'แตะป้ายเพื่อเลือก', place: 'above' }],
          });
          const save = role(dlg, 'button', 'เพิ่มแถว');
          await r.shot({
            title: 'กด “เพิ่มแถว” เพื่อบันทึก',
            text: 'ตรวจข้อมูลแล้วกด **เพิ่มแถว** · ถ้าจะกรอกหลายแถวติดกัน ติ๊ก **เพิ่มต่ออีกแถว** ก่อนกด ฟอร์มจะเปิดค้างไว้ให้กรอกแถวถัดไป',
            marks: [{ el: save, label: 'กด เพิ่มแถว', place: 'above' }, { el: dlg.getByText('เพิ่มต่ออีกแถว'), label: 'ติ๊กเพื่อกรอกแถวถัดไปต่อ', place: 'above' }],
          });
          await save.click(); await r.settle(1200);
          await r.shot({ title: 'บันทึกเรียบร้อย', text: 'แถวใหม่อยู่ในตารางทันที และทุกคนที่เปิดไฟล์นี้อยู่จะเห็นพร้อมกัน · ระบบเก็บประวัติว่าใครกรอกเมื่อไร', marks: [{ el: p.locator('tbody tr').filter({ hasText: '1,250' }).first(), label: 'แถวที่เพิ่งเพิ่ม' }] });
        },
      },
      {
        id: 'edit-cell', title: 'แก้ไขข้อมูลในตาราง', summary: 'ดับเบิลคลิกที่ช่องเพื่อแก้ไข แล้วกด Enter', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const cell = p.locator('tbody td').filter({ hasText: /^ธนกร$/ }).first();
          await r.shot({ title: 'ดับเบิลคลิกช่องที่จะแก้', text: 'หาแถวที่ต้องการ แล้ว**ดับเบิลคลิก**ที่ช่อง (บนมือถือแตะ 2 ครั้ง) หรือคลิกครั้งเดียวแล้วกด **Enter**', marks: [{ el: cell, label: 'ดับเบิลคลิกที่ช่อง' }] });
          await cell.dblclick(); await r.settle(400);
          await p.keyboard.press('Control+A'); await p.keyboard.type('ธนกร (แก้ไข)');
          await r.shot({ title: 'พิมพ์ค่าใหม่ แล้วกด Enter', text: 'ช่องจะกลายเป็นช่องพิมพ์ พิมพ์ค่าใหม่แล้วกด **Enter** เพื่อบันทึก หรือกด **Esc** เพื่อยกเลิก', marks: [{ el: p.locator('tbody input, tbody textarea').first(), label: 'พิมพ์แล้วกด Enter' }] });
          await p.keyboard.press('Enter'); await r.settle(900);
          await r.shot({
            title: 'บันทึกทันที แก้ผิดย้อนกลับได้',
            text: 'ค่าใหม่บันทึกทันทีไม่ต้องกดปุ่มบันทึก · ถ้าแก้ผิด กดปุ่ม **ย้อนกลับ** (หรือ Ctrl+Z)',
            marks: [{ el: p.locator('tbody td', { hasText: 'ธนกร (แก้ไข)' }).first(), label: 'ค่าใหม่' }, { el: role(p, 'button', 'ย้อนกลับ (Ctrl+Z)'), label: 'ย้อนกลับการแก้ไข', place: 'below' }],
          });
          const lineCell = p.locator('tbody tr').first().locator('td').nth(2);
          await lineCell.dblclick(); await r.settle(500);
          await r.shot({ title: 'ช่องแบบเลือกจากรายการ', text: 'ช่องที่เป็นรายการ (เช่น ไลน์) ดับเบิลคลิกแล้วจะมีรายการให้เลือก กดค่าที่ต้องการได้เลย', marks: [{ el: lineCell, label: 'ดับเบิลคลิก แล้วเลือกจากรายการ' }] });
          await p.keyboard.press('Escape');
        },
      },
      {
        id: 'row-view', title: 'ดูและแก้ไขข้อมูลทั้งแถว', summary: 'เปิดแถวในฟอร์มเพื่ออ่านข้อมูลยาวๆ หรือแก้หลายช่องพร้อมกัน', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const cell = p.locator('tbody td').filter({ hasText: /^ปิยะ$/ }).first();
          await cell.click({ button: 'right' }); await r.settle(400);
          const item = p.getByRole('menuitem', { name: 'เปิดแถวในฟอร์ม' });
          await r.shot({ title: 'คลิกขวาที่แถว แล้วเลือก “เปิดแถวในฟอร์ม”', text: '**คลิกขวา**ที่แถวที่ต้องการ (บนมือถือแตะค้าง) แล้วเลือก **เปิดแถวในฟอร์ม** · หรือชี้ที่เลขแถวแล้วกดรูป**ตา**', marks: [{ el: item, label: 'กด เปิดแถวในฟอร์ม', place: 'right' }] });
          await item.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({ title: 'อ่านข้อมูลทุกช่องของแถว', text: 'หน้าต่างนี้แสดงทุกช่องของแถว อ่านข้อความยาวได้ครบ · กด **แก้ไข** เพื่อแก้หลายช่องพร้อมกัน · ปิดด้วยปุ่ม ✕', marks: [{ el: role(dlg, 'button', 'ปิด').first(), label: 'ปิด', place: 'left' }] });
        },
      },
      {
        id: 'search-filter', title: 'ค้นหา กรอง และเรียงข้อมูล', summary: 'หาแถวที่ต้องการจากตารางใหญ่', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const q = p.getByPlaceholder('ค้นหาในชีต…');
          await q.fill('วิชัย'); await r.settle(1200);
          await r.shot({ title: 'ค้นหาคำในชีต', text: 'พิมพ์คำในช่อง **ค้นหาในชีต…** ตารางจะเหลือเฉพาะแถวที่มีคำนั้น · ลบคำออกเพื่อแสดงทุกแถว', marks: [{ el: box(q), label: 'พิมพ์คำค้น', place: 'below' }] });
          await q.fill(''); await r.settle(900);
          const f = role(p, 'button', 'ตัวกรอง ไลน์');
          await p.locator('th').filter({ hasText: 'ไลน์' }).first().hover();
          await r.shot({ title: 'กรองตามคอลัมน์', text: 'ชี้ที่หัวคอลัมน์ จะเห็นปุ่ม**กรวย** (ตัวกรอง) กดเพื่อเลือกเฉพาะค่าที่ต้องการ', marks: [{ el: f, label: 'กดปุ่มตัวกรอง', place: 'below' }] });
          await f.click(); await r.settle(500);
          await p.getByText('เลือกทั้งหมด', { exact: true }).click(); await r.settle(200);
          const pf = p.getByText('PF1-09', { exact: true }).last();
          await pf.click(); await r.settle(200);
          const apply = role(p, 'button', 'ใช้ตัวกรอง');
          await r.shot({
            title: 'ติ๊กค่าที่ต้องการ แล้วกด “ใช้ตัวกรอง”',
            text: 'กด **เลือกทั้งหมด** เพื่อเอาติ๊กออกทั้งหมดก่อน แล้วติ๊กเฉพาะค่าที่ต้องการ (เช่น PF1-09) จากนั้นกด **ใช้ตัวกรอง** · ใช้ตัวกรองหลายคอลัมน์พร้อมกันได้',
            marks: [{ el: pf, label: 'ติ๊กค่าที่ต้องการ', place: 'right' }, { el: apply, label: 'กด ใช้ตัวกรอง', place: 'right' }],
          });
          await apply.click(); await r.settle(1000);
          await r.shot({ title: 'ตารางเหลือเฉพาะแถวที่ตรง', text: 'หัวคอลัมน์ที่กรองอยู่จะมีสัญลักษณ์บอก และจำนวนแถวด้านล่างลดลง · เปิดตัวกรองอีกครั้งแล้วกด **ล้างตัวกรอง** เพื่อแสดงทุกแถว', marks: [{ el: role(p, 'button', 'ตัวกรอง ไลน์'), label: 'คอลัมน์ที่กรองอยู่', place: 'below' }] });
          await role(p, 'button', 'ตัวกรอง ไลน์').click(); await r.settle(400);
          await p.getByText('ล้างตัวกรอง').last().click().catch(() => undefined); await r.settle(800);
          await p.keyboard.press('Escape'); await p.mouse.click(700, 760); await r.settle(300);
          const sort = role(p, 'button', 'เรียงตาม ยอดผลิต');
          await p.locator('th').filter({ hasText: 'ยอดผลิต' }).first().hover();
          await r.shot({ title: 'เรียงข้อมูล', text: 'กดปุ่ม**ลูกศร**ที่หัวคอลัมน์เพื่อเรียงจากน้อยไปมาก กดอีกครั้งเพื่อเรียงจากมากไปน้อย', marks: [{ el: sort, label: 'กดเพื่อเรียง', place: 'below' }] });
        },
      },
      {
        id: 'history', title: 'ดูประวัติการแก้ไข', summary: 'ดูว่าใครแก้ช่องไหน เมื่อไร ค่าเดิมคืออะไร และย้อนค่าได้', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const cell = p.locator('tbody td').filter({ hasText: /^วิชัย$/ }).first();
          await cell.click({ button: 'right' }); await r.settle(400);
          const item = p.getByRole('menuitem', { name: 'ประวัติของเซลล์' });
          await r.shot({ title: 'คลิกขวาที่ช่อง แล้วเลือก “ประวัติของเซลล์”', text: '**คลิกขวา**ที่ช่องที่ต้องการ (บนมือถือแตะค้าง) แล้วเลือก **ประวัติของเซลล์** · ถ้าต้องการดูทั้งแถวเลือก **ประวัติของแถว**', marks: [{ el: item, label: 'กด ประวัติของเซลล์', place: 'right' }] });
          await item.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({ title: 'รายการประวัติ', text: 'เห็นทุกครั้งที่ช่องนี้ถูกแก้ ใครแก้ เวลา และค่าก่อน/หลัง · ถ้ามีสิทธิ์จะมีปุ่ม**ย้อนกลับ**ไปค่าเดิม', marks: [{ el: dlg.locator('h2').first(), label: 'ประวัติของช่องนี้' }] });
        },
      },
      {
        id: 'delete-row', title: 'ลบแถว และกู้คืนแถวที่ลบ', summary: 'ลบแถวที่กรอกผิด และนำกลับมาได้ถ้าลบพลาด', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const cell = p.locator('tbody td').filter({ hasText: /^อรุณี$/ }).first();
          await cell.click({ button: 'right' }); await r.settle(400);
          const del = p.getByRole('menuitem', { name: 'ลบแถว' });
          await r.shot({ title: 'คลิกขวาที่แถว แล้วเลือก “ลบแถว”', text: 'คลิกขวาที่แถวที่จะลบ แล้วเลือก **ลบแถว** (เลือกหลายแถวด้วยช่องติ๊กหน้าแถวเพื่อลบพร้อมกันได้)', marks: [{ el: del, label: 'กด ลบแถว', place: 'right' }] });
          await del.click(); await r.settle(500);
          const ok = p.getByRole('dialog').getByRole('button', { name: /ลบ/ }).last();
          if (await ok.count()) { await r.shot({ title: 'ยืนยันการลบ', text: 'กดปุ่ม **ลบ** เพื่อยืนยัน', marks: [{ el: ok, label: 'กด ลบ', place: 'above' }] }); await ok.click(); await r.settle(900); }
          const trash = role(p, 'button', 'แถวที่ถูกลบ');
          await r.shot({ title: 'ลบพลาด? เปิด “แถวที่ถูกลบ”', text: 'แถวที่ลบไม่ได้หายถาวร กดปุ่ม **แถวที่ถูกลบ** บนแถบเครื่องมือ', marks: [{ el: trash, label: 'กด แถวที่ถูกลบ', place: 'below' }] });
          await trash.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          const tick = dlg.locator('tbody [role="checkbox"]').first();
          await tick.click(); await r.settle(300);
          const restore = dlg.getByRole('button', { name: /กู้คืน/ }).last();
          await r.shot({ title: 'ติ๊กแถว แล้วกด “กู้คืน”', text: 'ติ๊กช่องหน้าแถวที่ต้องการ แล้วกด **กู้คืน** แถวจะกลับไปอยู่ในตารางพร้อมข้อมูลเดิมทุกช่อง', marks: [{ el: dlg.locator('tbody tr').first(), label: 'ติ๊กแถวที่จะกู้คืน', place: 'above' }, { el: restore, label: 'กด กู้คืน', place: 'left' }] });
          await restore.click(); await r.settle(800);
        },
      },
      {
        id: 'import-export', title: 'นำเข้าและส่งออก Excel', summary: 'ดึงข้อมูลจาก Excel เข้าตาราง หรือส่งออกเป็น Excel / CSV / PDF', as: 'master',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const exp = role(p, 'button', 'ส่งออกไฟล์');
          await r.shot({ title: 'ส่งออก: กดปุ่มดาวน์โหลด', text: 'กดปุ่ม **ส่งออกไฟล์** (รูปลูกศรลง) บนแถบเครื่องมือ', marks: [{ el: exp, label: 'กด ส่งออกไฟล์', place: 'below' }] });
          await exp.click(); await r.settle(400);
          await r.shot({ title: 'เลือกรูปแบบไฟล์', text: 'เลือก **Excel (.xlsx)** สำหรับเปิดใน Excel · **CSV** สำหรับโปรแกรมอื่น · **PDF** สำหรับพิมพ์ ระบบส่งออกตามตัวกรองที่ใช้อยู่', marks: [{ el: p.locator('[role="menu"]').last(), label: 'เลือกรูปแบบไฟล์', place: 'left' }] });
          await p.keyboard.press('Escape'); await p.mouse.click(700, 760); await r.settle(300);
          const imp = role(p, 'button', 'นำเข้า');
          await r.shot({ title: 'นำเข้า: กดปุ่ม “นำเข้า”', text: 'กดปุ่ม **นำเข้า** บนแถบเครื่องมือ', marks: [{ el: imp, label: 'กด นำเข้า', place: 'below' }] });
          await imp.click(); await r.settle();
          await r.shot({ title: 'เลือกไฟล์ Excel แล้วจับคู่คอลัมน์', text: 'เลือกไฟล์ Excel/CSV จากเครื่อง ระบบจะจับคู่หัวคอลัมน์ให้อัตโนมัติ ตรวจแล้วกดนำเข้า · ปิดหน้าต่างด้วยปุ่ม ✕', marks: [{ el: role(p.getByRole('dialog'), 'button', 'ปิด').first(), label: 'ปิดหน้าต่าง', place: 'left' }] });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'share', title: 'แชร์และสิทธิ์', icon: 'share', description: 'ให้สิทธิ์ผู้ใช้หรือ Tag ส่งลิงก์ ขอสิทธิ์ และอนุมัติ',
    guides: [
      {
        id: 'share-user', title: 'แชร์ไฟล์ให้ผู้ใช้', summary: 'ให้คนอื่นดูหรือกรอกข้อมูลในไฟล์ของคุณ', as: 'master',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          await r.shot({ title: 'กดปุ่ม “แชร์”', text: 'เปิดไฟล์ (หรือโฟลเดอร์) แล้วกดปุ่ม **แชร์** มุมขวาบน · ต้องมีสิทธิ์ **จัดการ** ไฟล์นั้น', marks: [{ el: role(p, 'button', 'แชร์').first(), label: 'กด แชร์', place: 'left' }] });
          await role(p, 'button', 'แชร์').first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          const pick = dlg.getByText('ค้นหาผู้ใช้เพื่อเพิ่ม…');
          await pick.click(); await r.settle(300);
          await p.keyboard.type('สมหญิง'); await r.settle(900);
          const opt = p.getByText('สมหญิง ขยันงาน', { exact: true }).last();
          await r.shot({ title: 'ค้นหาและเลือกผู้ใช้', text: 'ในช่อง **ค้นหาผู้ใช้เพื่อเพิ่ม…** พิมพ์ชื่อ ชื่อผู้ใช้ หรืออีเมล แล้วกดเลือกคนที่ต้องการ', marks: [{ el: opt, label: 'กดเลือกผู้ใช้', place: 'right' }] });
          await opt.click(); await r.settle(300);
          const perm = dlg.locator('select').first();
          await r.shot({
            title: 'เลือกระดับสิทธิ์และระยะเวลา',
            text: '• **ดูข้อมูล** อ่านอย่างเดียว\n• **แก้ไขข้อมูล** เพิ่ม/แก้แถวได้\n• **จัดการ** แก้โครงสร้าง แชร์ต่อ ลบไฟล์\nเลือกวันหมดอายุได้ (ไม่เลือก = ไม่หมดอายุ)',
            marks: [{ el: perm, label: 'ระดับสิทธิ์', place: 'below' }, { el: dlg.locator('select').nth(1), label: 'ระยะเวลา', place: 'below' }],
          });
          const add = role(dlg, 'button', 'เพิ่ม');
          await r.shot({ title: 'กด “เพิ่ม”', text: 'กดปุ่ม **เพิ่ม** ผู้ใช้จะได้รับการแจ้งเตือน และเห็นไฟล์ในเมนู ไฟล์ทั้งหมด ทันที', marks: [{ el: add, label: 'กด เพิ่ม', place: 'left' }] });
          await add.click(); await r.settle(900);
          await r.shot({ title: 'ผู้มีสิทธิ์โดยตรง', text: 'รายชื่ออยู่ในหัวข้อ **ผู้มีสิทธิ์โดยตรง** · เปลี่ยนระดับได้จากช่องเลือกท้ายชื่อ · กดรูป**ถังขยะ**เพื่อถอนสิทธิ์', marks: [{ el: dlg.getByText('ผู้มีสิทธิ์โดยตรง'), label: 'รายชื่อผู้ที่แชร์ให้', place: 'right' }] });
        },
      },
      {
        id: 'share-tag', title: 'แชร์ไฟล์ให้ทั้งกลุ่มด้วย Tag', summary: 'ทุกคนที่มี Tag เดียวกันได้สิทธิ์พร้อมกันในครั้งเดียว', as: 'master',
        run: async (r) => {
          const p = r.page;
          const tags = await r.call('GET', '/tags');
          let tag = tags.find((t) => t.name === 'QC ไลน์ PF1');
          if (!tag) tag = await r.call('POST', '/tags', { name: 'QC ไลน์ PF1', color: '#0E9F6E', description: 'พนักงาน QC ไลน์ PF1' });
          const users = (await r.call('GET', '/users?pageSize=50')).items;
          await r.call('POST', `/tags/${tag.id}/members`, { userIds: users.filter((u) => ['user', 'master'].includes(u.username)).map((u) => u.id) });
          await openDemoFile(r);
          await role(p, 'button', 'แชร์').first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          const seg = role(dlg, 'button', 'แชร์ให้ Tag');
          await r.shot({ title: 'กด “แชร์ให้ Tag”', text: 'ในหน้าต่างแชร์ กดปุ่ม **แชร์ให้ Tag** (Tag สร้างโดยผู้ดูแลระบบ ดูเรื่อง “จัดการ Tag”)', marks: [{ el: seg, label: 'กด แชร์ให้ Tag', place: 'right' }] });
          await seg.click(); await r.settle(300);
          await dlg.getByLabel('เลือก Tag').selectOption({ label: `${tag.name} (2 คน)` }).catch(async () => dlg.getByLabel('เลือก Tag').selectOption(tag.id));
          await r.shot({
            title: 'เลือก Tag ระดับสิทธิ์ แล้วกด “เพิ่ม”',
            text: 'เลือก Tag (ในวงเล็บคือจำนวนคนใน Tag) เลือกระดับสิทธิ์และระยะเวลา แล้วกด **เพิ่ม**',
            marks: [{ el: dlg.getByLabel('เลือก Tag'), label: 'เลือก Tag', place: 'below' }, { el: role(dlg, 'button', 'เพิ่ม'), label: 'กด เพิ่ม', place: 'left' }],
          });
          await role(dlg, 'button', 'เพิ่ม').click(); await r.settle(1000);
          await r.shot({
            title: 'ทุกคนใน Tag ได้สิทธิ์แล้ว',
            text: 'Tag ที่แชร์อยู่ในหัวข้อ **แชร์ให้ Tag** · คนที่ถูกเพิ่มเข้า Tag ทีหลังได้สิทธิ์อัตโนมัติ เอาออกจาก Tag = สิทธิ์หายทันที',
            tip: 'ระดับสูงสุดยังขึ้นกับบทบาท: Viewer ดูได้อย่างเดียว · User ไม่เกิน “แก้ไขข้อมูล”',
            marks: [{ el: dlg.getByText('แชร์ให้ Tag', { exact: true }).last(), label: 'Tag ที่ได้สิทธิ์', place: 'right' }],
          });
        },
      },
      {
        id: 'copy-link', title: 'ส่งลิงก์ไฟล์ให้เพื่อน', summary: 'คัดลอกลิงก์ไฟล์/โฟลเดอร์ ผู้รับเข้าสู่ระบบแล้วเปิดไฟล์นั้นได้ทันที', as: 'master',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          await role(p, 'button', 'แชร์').first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({
            title: 'กด “คัดลอกลิงก์”',
            text: 'กดปุ่ม **แชร์** แล้วดูช่อง **ลิงก์ของไฟล์นี้** ด้านบน กด **คัดลอกลิงก์** แล้วนำไปวางใน LINE / อีเมล',
            tip: 'ผู้รับต้องมีสิทธิ์ในไฟล์ (เพิ่มในหน้าต่างเดียวกัน) ถ้ายังไม่มีสิทธิ์ เขาจะเห็นปุ่มขอสิทธิ์',
            marks: [{ el: role(dlg, 'button', 'คัดลอกลิงก์'), label: 'กด คัดลอกลิงก์', place: 'below' }],
          });
          const url = await dlg.locator('input[aria-label="ลิงก์"]').inputValue();
          await r.open(null);
          await r.page.goto(url);
          await r.page.waitForURL(/\/login/); await r.settle();
          await r.shot({ title: 'ผู้รับกดลิงก์: เข้าสู่ระบบก่อน', text: 'ถ้าผู้รับยังไม่ได้เข้าสู่ระบบ จะเห็นหน้าเข้าสู่ระบบ ให้กรอกชื่อผู้ใช้/รหัสผ่าน (หรือ Microsoft) แล้วกด **เข้าสู่ระบบ**', marks: [{ el: r.page.locator('button[type="submit"]'), label: 'เข้าสู่ระบบ' }] });
          await r.page.fill('input[autocomplete="username"]', 'user');
          await r.page.fill('input[autocomplete="current-password"]', 'User@1234');
          await r.page.click('button[type="submit"]');
          await r.page.waitForURL(/\/files\//); await r.settle(1500);
          await r.shot({ title: 'เปิดไฟล์ให้ทันที', text: 'หลังเข้าสู่ระบบ ระบบพาไปที่ไฟล์จากลิงก์โดยตรง ไม่ต้องหาเอง · ถ้าเข้าสู่ระบบอยู่แล้ว กดลิงก์แล้วเปิดไฟล์เลย', marks: [{ el: r.page.locator('h1').first(), label: 'ไฟล์จากลิงก์' }] });
        },
      },
      {
        id: 'request-access', title: 'ขอสิทธิ์เข้าถึงไฟล์', summary: 'เปิดไฟล์ที่ยังไม่มีสิทธิ์ แล้วส่งคำขอพร้อมเหตุผล', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.go(`/files/${QH_FILE}`, 1500);
          await r.shot({ title: 'เปิดไฟล์ที่ยังไม่มีสิทธิ์', text: 'ถ้าเปิดไฟล์ (หรือลิงก์) ที่ยังไม่มีสิทธิ์ จะเห็นหน้า **คุณยังไม่มีสิทธิ์เข้าถึงไฟล์นี้** พร้อมฟอร์มขอสิทธิ์', marks: [{ el: p.getByText('คุณยังไม่มีสิทธิ์เข้าถึงไฟล์นี้'), label: 'ยังไม่มีสิทธิ์' }] });
          const note = p.locator('textarea').first();
          await note.fill('ต้องดูข้อมูล Quality Highlight ประกอบการตรวจไลน์ PF1');
          await r.shot({
            title: 'เลือกระดับ ระยะเวลา และพิมพ์เหตุผล',
            text: 'เลือก**ระดับสิทธิ์ที่ขอ** และ**ระยะเวลา** แล้วพิมพ์**เหตุผล** อย่างน้อย 10 ตัวอักษร (ช่วยให้อนุมัติเร็วขึ้น)',
            marks: [{ el: p.locator('select').first(), label: 'ระดับที่ขอ', place: 'left' }, { el: note, label: 'เหตุผลที่ต้องใช้ไฟล์', place: 'left' }],
          });
          const send = role(p, 'button', 'ส่งคำขอสิทธิ์');
          await r.shot({ title: 'กด “ส่งคำขอสิทธิ์”', text: 'กด **ส่งคำขอสิทธิ์** ผู้ดูแลไฟล์ได้รับการแจ้งเตือนทันที', marks: [{ el: send, label: 'กด ส่งคำขอสิทธิ์', place: 'below' }] });
          await send.click(); await r.settle(1200);
          await r.shot({ title: 'รอการอนุมัติ', text: 'หน้าไฟล์จะแสดง **คำขอของคุณกำลังรอการอนุมัติ** เมื่อได้รับอนุมัติจะมีการแจ้งเตือน แล้วเปิดไฟล์ได้เลย · ดูคำขอทั้งหมดได้ที่เมนู **คำขอสิทธิ์**', marks: [{ el: p.getByText('คำขอของคุณกำลังรอการอนุมัติ'), label: 'รออนุมัติ' }, { el: sidebar(p, 'คำขอสิทธิ์'), label: 'ติดตามคำขอ', place: 'right' }] });
        },
      },
      {
        id: 'approve-access', title: 'อนุมัติคำขอสิทธิ์', summary: 'ผู้ดูแลไฟล์อนุมัติหรือปฏิเสธคำขอสิทธิ์', as: 'admin',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “คำขอสิทธิ์”', text: 'เมื่อมีคำขอใหม่ จะมีการแจ้งเตือนและตัวเลขที่เมนู **คำขอสิทธิ์** กดเมนูนี้', marks: [{ el: sidebar(p, 'คำขอสิทธิ์'), label: 'กด คำขอสิทธิ์', place: 'right' }] });
          await sidebar(p, 'คำขอสิทธิ์').click(); await r.settle(1000);
          const mine = role(p, 'button', 'รอฉันอนุมัติ');
          await r.shot({ title: 'เลือก “รอฉันอนุมัติ”', text: 'ด้านขวาบนเลือก **รอฉันอนุมัติ** (คำขอที่ส่งถึงคุณ) · **คำขอของฉัน** คือคำขอที่คุณส่งไปเอง', marks: [{ el: mine, label: 'กด รอฉันอนุมัติ', place: 'below' }] });
          await mine.click(); await r.settle(900);
          const approve = role(p, 'button', 'อนุมัติ', { exact: true }).first();
          await r.shot({ title: 'ดูคำขอแล้วกด “อนุมัติ”', text: 'แต่ละคำขอบอกชื่อผู้ขอ ไฟล์ ระดับที่ขอ ระยะเวลา และเหตุผล · กด **อนุมัติ** หรือ **ปฏิเสธ**', marks: [{ el: approve, label: 'กด อนุมัติ', place: 'left' }] });
          await approve.click(); await r.settle(600);
          const dlg = p.getByRole('dialog');
          if (await dlg.count()) {
            await r.shot({ title: 'ยืนยันระดับสิทธิ์', text: 'ปรับระดับหรือวันหมดอายุได้ก่อนยืนยัน แล้วกด **อนุมัติ** ผู้ขอได้รับการแจ้งเตือนทันที', marks: [{ el: dlg.getByRole('button', { name: /อนุมัติ/ }).last(), label: 'กด อนุมัติ', place: 'above' }] });
            await dlg.getByRole('button', { name: /อนุมัติ/ }).last().click(); await r.settle(800);
          }
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'qh', title: 'Quality Highlight', icon: 'sparkles', description: 'ค้นหา Note การผลิต แก้ Master และออก Rev',
    guides: [
      {
        id: 'qh-search', title: 'ค้นหา Sub Doc No. / Short Code บนแดชบอร์ด', summary: 'ดู Note ที่ต้องแจ้ง (ให้Spread) และรูป ของรหัสที่ต้องการ', as: 'admin',
        run: async (r) => {
          const p = r.page;
          const f = await r.call('GET', `/files/${QH_FILE}`);
          await r.shot({ title: 'กดเมนู “แดชบอร์ด”', text: 'กดเมนู **แดชบอร์ด** ทางซ้าย', marks: [{ el: sidebar(p, 'แดชบอร์ด'), label: 'กด แดชบอร์ด', place: 'right' }] });
          await sidebar(p, 'แดชบอร์ด').click(); await r.settle(1000);
          await r.shot({ title: 'เลือก “Quality Highlight”', text: 'กดที่การ์ด **Quality Highlight**', tip: 'กดรูปดาวเพื่อเก็บไว้ในรายการโปรด จะเปิดได้จากหน้าแรก', marks: [{ el: p.getByText('Quality Highlight', { exact: true }).first(), label: 'กด Quality Highlight' }] });
          await r.go(`/files/${QH_FILE}/dashboards/${QH_DASH}`, 1800);
          const search = p.getByPlaceholder(/Sub Doc No/).first(); // the dashboard's search box (not the one in the top bar)
          await r.shot({ title: 'ช่องค้นหา', text: 'ด้านบนของแดชบอร์ดมีช่องค้นหา ใช้ได้ทั้ง **Sub Doc No.** และ **Short Code** (พิมพ์บางส่วนก็ได้)', marks: [{ el: box(search), label: 'พิมพ์ Sub Doc No. หรือ Short Code', place: 'below' }] });
          const sheet = f.sheets[0].id;
          const sh = await r.call('GET', `/sheets/${sheet}`);
          const col = (sh.columns ?? []).find((c) => c.name === 'Sub Doc No.');
          const imgCol = (sh.columns ?? []).find((c) => c.name === 'รูปภาพ');
          const page = await r.call('POST', `/sheets/${sheet}/rows/query`, { page: 1, pageSize: 400 });
          const rows = page.rows ?? page.items ?? [];
          const val = (row, c) => (row.cells ?? row.values ?? row)[c.id];
          const withPic = rows.find((x) => imgCol && JSON.stringify(val(x, imgCol) ?? '').includes('/uploads/')) ?? rows[0];
          const code = String(val(withPic, col) ?? '').trim();
          await search.fill(code); await r.settle(1500);
          await r.shot({ title: 'ดูผลการค้นหา', text: 'ระบบแสดงทุกแถวที่ตรง (Sub Doc No. เดียวกันรวมเป็นการ์ดเดียว) พร้อม Material, Short Code, **ให้Spread**, วันที่/ผู้แก้ล่าสุด และรูป · แตะรูปเพื่อดูเต็มจอ · ลบคำค้นเพื่อดูทั้งหมด', marks: [{ el: box(search), label: 'คำที่ค้น', place: 'right' }, { el: p.locator('img[src*="/uploads/"]').first(), label: 'แตะรูปเพื่อดูเต็มจอ', place: 'right' }] });
          await r.note({ title: 'ดู Rev ล่าสุด', text: 'ด้านขวา (บนมือถืออยู่ด้านล่าง) มีวิดเจ็ต **Rev ล่าสุด** บอกว่า Rev ไหน และแก้อะไรไปจาก Rev ก่อน · แถวที่เปลี่ยนจะมีป้าย “แก้ไขใน Rev.N” / “ใหม่ใน Rev.N”' });
        },
      },
      {
        id: 'qh-rev', title: 'แก้ Master และออก Rev ใหม่', summary: 'แก้ Note แล้วออก Rev พร้อมรายการสิ่งที่เปลี่ยนจาก Rev ก่อน', as: 'admin', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await r.go(`/files/${QH_FILE}`, 2000);
          const cell = p.locator('tbody tr').first().locator('td').nth(4);
          await r.shot({ title: 'เปิดไฟล์ Master แล้วแก้ช่องที่ต้องการ', text: 'เปิดไฟล์ **Quality Highlight - Master** แล้วแก้ข้อมูลตามปกติ (ดูเรื่อง “แก้ไขข้อมูลในตาราง”) · **วันที่ Update** และ **Updated by** ระบบเติมให้เอง', marks: [{ el: cell, label: 'ดับเบิลคลิกเพื่อแก้' }] });
          await cell.dblclick(); await r.settle(400);
          await p.keyboard.press('End'); await p.keyboard.type(' (ตรวจซ้ำทุกล็อต)');
          await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter').catch(() => undefined);
          await p.keyboard.press('Enter').catch(() => undefined);
          await r.settle(1200);
          const rev = p.getByRole('button', { name: /^Rev\.\d+/ }).first();
          await r.shot({ title: 'ปุ่ม Rev บอกจำนวนแถวที่แก้ค้างอยู่', text: 'ปุ่ม **Rev.N** บนแถบเครื่องมือจะมีตัวเลข **+จำนวนแถว** ที่แก้แล้วแต่ยังไม่ออก Rev · กดปุ่มนี้', marks: [{ el: rev, label: 'กดปุ่ม Rev', place: 'below' }] });
          await rev.click(); await r.settle(900);
          const dlg = p.getByRole('dialog');
          const issue = dlg.getByRole('button', { name: /^ออก Rev/ }).last();
          await dlg.locator('textarea, input[type="text"]').first().fill('ปรับ Note ให้Spread ตามผลประชุม QC').catch(() => undefined);
          await r.shot({ title: 'ตรวจรายการที่เปลี่ยน แล้วออก Rev', text: 'หน้าต่างแสดงสิ่งที่เปลี่ยน: ค่าเดิมขีดฆ่าสีแดง → ค่าใหม่สีเขียว · แถวเพิ่มใหม่ · แถวที่ลบ\nใส่หมายเหตุ แล้วกด **ออก Rev.N+1**', marks: [{ el: issue, label: 'กด ออก Rev', place: 'above' }] });
          await issue.click(); await r.settle(1200);
          await r.shot({ title: 'แดชบอร์ดแสดง Rev ใหม่ทันที', text: 'Rev ใหม่ถูกบันทึก (ย้อนดู Rev เก่าได้ทุกเมื่อ: เมนู ⋯ ของไฟล์ → “Rev ของชีตนี้” หรือเลือกในวิดเจ็ต Rev บนแดชบอร์ด)', marks: [{ el: p.getByRole('button', { name: /^Rev\.\d+/ }).first(), label: 'Rev ล่าสุด', place: 'below' }] });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'dash', title: 'แดชบอร์ด', icon: 'dashboard', description: 'ดูภาพรวมข้อมูลเป็นกราฟ',
    guides: [
      {
        id: 'dashboard-open', title: 'เปิดแดชบอร์ด', summary: 'ดูกราฟและตัวเลขสรุปจากข้อมูลในไฟล์', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “แดชบอร์ด”', text: 'กดเมนู **แดชบอร์ด** ทางซ้าย จะเห็นแดชบอร์ดทุกอันที่คุณมีสิทธิ์', marks: [{ el: sidebar(p, 'แดชบอร์ด'), label: 'กด แดชบอร์ด', place: 'right' }] });
          await sidebar(p, 'แดชบอร์ด').click(); await r.settle(1000);
          const card = p.getByText('ภาพรวมการผลิต', { exact: true }).first();
          await r.shot({ title: 'เลือกแดชบอร์ด', text: 'กดที่ชื่อแดชบอร์ดที่ต้องการ', marks: [{ el: card, label: 'กดเพื่อเปิด' }] });
          await card.click(); await r.settle(2500);
          await r.shot({ title: 'อ่านแดชบอร์ด', text: 'ตัวเลขและกราฟคำนวณจากข้อมูลล่าสุดในไฟล์ อัปเดตเองเมื่อมีคนกรอกข้อมูล · ชี้ที่กราฟเพื่อดูค่า · ปุ่มลูกศรซ้ายบนกลับไปที่ไฟล์', marks: [{ el: role(p, 'button', 'กลับไปที่ไฟล์').or(p.getByRole('link', { name: 'กลับไปที่ไฟล์' })).first(), label: 'กลับไปที่ไฟล์', place: 'right' }] });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'admin', title: 'ผู้ดูแลระบบ (Admin)', icon: 'shield', description: 'จัดการผู้ใช้ อนุมัติบัญชีใหม่ และ Tag', roles: ['admin'],
    guides: [
      {
        id: 'admin-add-user', title: 'เพิ่มผู้ใช้ใหม่', summary: 'สร้างบัญชีให้พนักงาน กำหนดบทบาทและ Tag', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “จัดการผู้ใช้”', text: 'กดเมนู **จัดการผู้ใช้** ทางซ้าย (เห็นเฉพาะ Admin)', marks: [{ el: sidebar(p, 'จัดการผู้ใช้'), label: 'กด จัดการผู้ใช้', place: 'right' }] });
          await sidebar(p, 'จัดการผู้ใช้').click(); await r.settle(1000);
          await r.shot({ title: 'กด “เพิ่มผู้ใช้”', text: 'หน้า **ผู้ใช้งาน** แสดงทุกบัญชี ค้นหา/กรองตามบทบาท สถานะ หรือ Tag ได้ · กด **เพิ่มผู้ใช้** มุมขวาบน', marks: [{ el: role(p, 'button', 'เพิ่มผู้ใช้'), label: 'กด เพิ่มผู้ใช้', place: 'left' }] });
          await role(p, 'button', 'เพิ่มผู้ใช้').click(); await r.settle();
          const dlg = p.getByRole('dialog');
          const ins = dlg.locator('input');
          await ins.nth(0).fill('ประเสริฐ มั่นคง'); await ins.nth(1).fill('prasert'); await ins.nth(2).fill('prasert@example.com'); await ins.nth(3).fill('Welcome2026!');
          await r.shot({ title: 'กรอกข้อมูลบัญชี', text: 'กรอก**ชื่อที่แสดง ชื่อผู้ใช้ อีเมล** และ**รหัสผ่านเริ่มต้น** (แจ้งพนักงานให้เปลี่ยนเองภายหลัง)', marks: [{ el: ins.nth(1), label: 'ชื่อผู้ใช้สำหรับเข้าสู่ระบบ', place: 'left' }, { el: ins.nth(3), label: 'รหัสผ่านเริ่มต้น', place: 'left' }] });
          await r.shot({ title: 'เลือกบทบาทและ Tag แล้วกด “สร้างผู้ใช้”', text: 'เลือก**บทบาท** (คำอธิบายใต้ช่องบอกว่าทำอะไรได้) และแตะ **Tag** ที่ต้องการ (เลือกได้หลาย Tag) แล้วกด **สร้างผู้ใช้**', marks: [{ el: dlg.locator('select').first(), label: 'บทบาท', place: 'left' }, { el: role(dlg, 'button', 'สร้างผู้ใช้'), label: 'กด สร้างผู้ใช้', place: 'above' }] });
          await role(dlg, 'button', 'สร้างผู้ใช้').click(); await r.settle(1000);
          const row = p.locator('tr').filter({ hasText: '@prasert' });
          await row.getByRole('button', { name: 'ตัวเลือก' }).click(); await r.settle(300);
          await r.shot({ title: 'แก้ไข / รีเซ็ตรหัสผ่าน / ปิดการใช้งาน', text: 'กดปุ่ม **⋯** ท้ายแถวผู้ใช้:\n• **แก้ไข** ชื่อ อีเมล บทบาท Tag\n• **รีเซ็ตรหัสผ่าน** เมื่อพนักงานลืมรหัสผ่าน\n• **ปิดการใช้งาน** เมื่อพนักงานลาออก (เข้าสู่ระบบไม่ได้ทันที)', marks: [{ el: p.locator('[role="menu"]').last(), label: 'คำสั่งของผู้ใช้', place: 'left' }] });
        },
      },
      {
        id: 'admin-requests', title: 'อนุมัติคำขอสร้างบัญชี', summary: 'ตรวจคำขอบัญชีใหม่ กำหนดระดับจริง และใส่ Tag', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          if (!(await r.call('GET', '/account-requests?status=pending')).length)
            await r.signup({ displayName: 'วิไล ใจงาม', email: 'wilai@example.com', username: 'wilai', password: 'Wilai2026!', requestedRole: 'user', note: 'QC ไลน์ PF1 บันทึกผลตรวจประจำวัน' });
          await r.go('/users', 900);
          await r.shot({ title: 'แท็บ “คำขอสร้างบัญชี”', text: 'เมื่อมีคนขอบัญชี Admin ได้รับการแจ้งเตือน และมีตัวเลขที่เมนู **จัดการผู้ใช้** · กดแท็บ **คำขอสร้างบัญชี**', marks: [{ el: p.getByRole('link', { name: /คำขอสร้างบัญชี/ }), label: 'กดแท็บ คำขอสร้างบัญชี', place: 'below' }] });
          await p.getByRole('link', { name: /คำขอสร้างบัญชี/ }).click(); await r.settle(900);
          const approve = role(p, 'button', 'อนุมัติ', { exact: true }).first();
          await r.shot({ title: 'ดูรายละเอียดคำขอ', text: 'เห็นชื่อ อีเมล ชื่อผู้ใช้ (หรือป้าย Microsoft) **ระดับที่ขอ** และแผนก/เหตุผล · กด **อนุมัติ** หรือ **ปฏิเสธ**', marks: [{ el: p.getByText('ขอระดับ').first(), label: 'ระดับที่ผู้ใช้ขอ' }, { el: approve, label: 'กด อนุมัติ', place: 'left' }] });
          await approve.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({ title: 'กำหนดระดับจริงและ Tag', text: 'ช่อง **ระดับที่ให้** ตั้งต้นตามที่ขอ เปลี่ยนได้ตามความเหมาะสม · แตะ Tag เพื่อใส่ผู้ใช้เข้ากลุ่มทันที · กด **อนุมัติและสร้างบัญชี**', marks: [{ el: dlg.locator('select').first(), label: 'ระดับที่ให้จริง', place: 'left' }, { el: role(dlg, 'button', 'อนุมัติและสร้างบัญชี'), label: 'กด อนุมัติและสร้างบัญชี', place: 'above' }] });
          await role(dlg, 'button', 'อนุมัติและสร้างบัญชี').click(); await r.settle(1000);
          await r.note({ title: 'ผู้ขอเข้าใช้งานได้ทันที', text: 'บัญชีถูกสร้างแล้ว ผู้ขอเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่านที่ตั้งตอนขอ (หรือปุ่ม Microsoft) · คำขอที่อนุมัติ/ปฏิเสธแล้วดูได้ในตัวเลือก **ทั้งหมด**' });
        },
      },
      {
        id: 'admin-tags', title: 'จัดการ Tag', summary: 'สร้าง Tag แล้วใส่ผู้ใช้เข้ากลุ่ม เพื่อแชร์ไฟล์ให้ทั้งกลุ่ม', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          for (const t of await r.call('GET', '/tags')) if (t.name === 'กะดึก') await r.call('DELETE', `/tags/${t.id}`); // a re-run starts clean
          await r.go('/users/tags', 900);
          await r.shot({ title: 'แท็บ “Tag” แล้วกด “สร้าง Tag”', text: 'ไปที่ **จัดการผู้ใช้ → Tag** แล้วกด **สร้าง Tag**', marks: [{ el: role(p, 'button', 'สร้าง Tag').first(), label: 'กด สร้าง Tag', place: 'left' }] });
          await role(p, 'button', 'สร้าง Tag').first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await dlg.locator('input').first().fill('กะดึก');
          await dlg.locator('textarea').first().fill('พนักงานกะดึกทุกไลน์');
          await r.shot({ title: 'ตั้งชื่อ สี และคำอธิบาย', text: 'ตั้งชื่อ Tag เช่น แผนก ไลน์ผลิต หรือกะ เลือกสี แล้วกด **สร้าง Tag**', marks: [{ el: dlg.locator('input').first(), label: 'ชื่อ Tag', place: 'right' }, { el: role(dlg, 'button', 'สร้าง Tag'), label: 'กด สร้าง Tag', place: 'above' }] });
          await role(dlg, 'button', 'สร้าง Tag').click(); await r.settle(900);
          const card = p.locator('div.ds-card').filter({ has: p.getByText('กะดึก', { exact: true }) }).first();
          const members = card.getByRole('button', { name: 'สมาชิก', exact: true });
          await r.shot({ title: 'กด “สมาชิก” เพื่อใส่ผู้ใช้', text: 'การ์ด Tag บอกจำนวนสมาชิก กดปุ่ม **สมาชิก**', marks: [{ el: members, label: 'กด สมาชิก', place: 'left' }] });
          await members.click(); await r.settle();
          const m = p.getByRole('dialog');
          await m.getByText('ค้นหาผู้ใช้เพื่อเพิ่มเข้า Tag…').click(); await r.settle(300);
          await p.keyboard.type('สม'); await r.settle(900);
          const who = p.getByText('สมหญิง ขยันงาน', { exact: true }).last();
          await r.shot({ title: 'ค้นหาแล้วกดเลือกผู้ใช้', text: 'พิมพ์ชื่อผู้ใช้ แล้วกดเลือก ผู้ใช้ถูกเพิ่มเข้า Tag ทันที (เพิ่มได้หลายคน) · กดรูปคนมีขีดเพื่อเอาออก', marks: [{ el: who, label: 'กดเลือกผู้ใช้', place: 'right' }] });
          await who.click(); await r.settle(900);
          await r.shot({ title: 'สมาชิกใน Tag', text: 'รายชื่อสมาชิกอยู่ด้านล่าง ปิดหน้าต่างด้วยปุ่ม **ปิด**', marks: [{ el: m.getByText('สมหญิง ขยันงาน', { exact: true }).last(), label: 'สมาชิกที่เพิ่ม', place: 'right' }] });
          await role(m, 'button', 'ปิด').last().click(); await r.settle(500);
          await r.note({ title: 'นำ Tag ไปใช้', text: 'ตอนแชร์ไฟล์/โฟลเดอร์ เลือก **แชร์ให้ Tag** (ดูเรื่อง “แชร์ไฟล์ให้ทั้งกลุ่มด้วย Tag”) · ใส่ Tag ให้ผู้ใช้ได้จากหน้าต่าง **แก้ไขผู้ใช้** หรือตอนอนุมัติบัญชีใหม่ด้วย' });
        },
      },
      {
        id: 'admin-microsoft', title: 'เปิดปุ่มเข้าสู่ระบบด้วย Microsoft', summary: 'ลงทะเบียนแอปใน Microsoft Azure แล้วตั้งค่าบน server (ทำครั้งเดียว)', as: null, roles: ['admin'],
        run: async (r) => {
          r.note({ title: 'ลงทะเบียนแอปใน Azure', text: 'เข้า **https://portal.azure.com** ด้วยบัญชีผู้ดูแล Microsoft 365 ของบริษัท → **Microsoft Entra ID** → **App registrations** → **New registration**\n• Name: DocHUB\n• Supported account types: เฉพาะบัญชีบริษัท = *Accounts in this organizational directory only*\n• Redirect URI เลือก **Web** แล้วใส่ **https://dochub.qcqrxdigital.dpdns.org/api/auth/oauth/microsoft/callback**\nกด **Register**' });
          r.note({ title: 'จดรหัสแอป และสร้าง Secret', text: 'หน้า **Overview** จด **Application (client) ID** และ **Directory (tenant) ID**\nไปที่ **Certificates & secrets** → **New client secret** → คัดลอกช่อง **Value** (เห็นครั้งเดียว ห้ามส่งในแชต/LINE)' });
          r.note({ title: 'ใส่ค่าใน server\\.env แล้วรีสตาร์ต', text: 'แก้ไฟล์ **server\\.env** บนเครื่อง server:\nPUBLIC_URL=https://dochub.qcqrxdigital.dpdns.org\nMS_CLIENT_ID=(Application ID)\nMS_CLIENT_SECRET=(Value)\nMS_TENANT=(Directory ID)\nแล้วสั่ง **pm2 restart dochub** ที่ cmd · หน้าเข้าสู่ระบบจะมีปุ่ม Microsoft', tip: 'คนที่ยังไม่มีบัญชี กดปุ่ม Microsoft แล้วจะไปที่ฟอร์มขอสร้างบัญชี Admin อนุมัติตามปกติ' });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'phone', title: 'ใช้งานบนมือถือ', icon: 'phone', description: 'เมนู แถบเครื่องมือ และไอคอนบนหน้าจอมือถือ',
    guides: [
      {
        id: 'phone-install', title: 'เพิ่มไอคอน Quality บนหน้าจอมือถือ', summary: 'เปิดแอปจากไอคอนได้เหมือนแอปทั่วไป', as: 'user', device: 'phone',
        run: async (r) => {
          r.note({ title: 'iPhone (Safari)', text: 'เปิด **https://dochub.qcqrxdigital.dpdns.org** ใน **Safari** → กดปุ่ม**แชร์** (สี่เหลี่ยมมีลูกศรชี้ขึ้น ด้านล่างจอ) → เลื่อนหา **เพิ่มไปยังหน้าจอโฮม** → กด **เพิ่ม**\nจะได้ไอคอนชื่อ **Quality** บนหน้าจอ' });
          r.note({ title: 'Android (Chrome)', text: 'เปิดเว็บใน **Chrome** → กดปุ่ม **⋮** มุมขวาบน → **เพิ่มไปยังหน้าจอหลัก** (หรือ **ติดตั้งแอป**) → กด **เพิ่ม**' });
          await r.shot({ title: 'เปิดจากไอคอน', text: 'แตะไอคอน **Quality** เพื่อเปิด ระบบจำการเข้าสู่ระบบไว้ ไม่ต้องพิมพ์รหัสทุกครั้ง', marks: [{ el: r.page.getByRole('button', { name: 'เปิดเมนู' }), label: 'เมนู ☰' }] });
        },
      },
      {
        id: 'phone-menu', title: 'เปิดเมนูบนมือถือ', summary: 'ปุ่ม ☰ มุมซ้ายบนเปิดเมนูทั้งหมด', as: 'user', device: 'phone',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดปุ่ม ☰', text: 'บนมือถือ เมนูหลักซ่อนอยู่ กดปุ่ม **☰** มุมซ้ายบน', marks: [{ el: role(p, 'button', 'เปิดเมนู'), label: 'กด ☰', place: 'right' }] });
          await role(p, 'button', 'เปิดเมนู').click(); await r.settle(600);
          const drawer = p.locator('nav').filter({ hasText: 'ไฟล์ทั้งหมด' }).last();
          await r.shot({ title: 'เลือกเมนู', text: 'แตะเมนูที่ต้องการ เมนูจะปิดเองแล้วไปที่หน้านั้น · ปิดเมนูโดยไม่เลือกด้วยปุ่ม ✕', marks: [{ el: drawer.getByText('ไฟล์ทั้งหมด').first(), label: 'แตะเมนูที่ต้องการ', place: 'right' }] });
        },
      },
      {
        id: 'phone-file', title: 'กรอกข้อมูลบนมือถือ', summary: 'แสดงเครื่องมือ เพิ่มแถว และดูตารางบนจอเล็ก', as: 'user', device: 'phone',
        run: async (r) => {
          const p = r.page;
          const acc = await r.call('GET', '/files/accessible?q=PF1');
          await r.go(`/files/${acc[0].id}`, 2000);
          const tools = p.getByRole('button', { name: /แสดงเครื่องมือ|เครื่องมือ/ }).first();
          await r.shot({ title: 'แสดงแถบเครื่องมือ', text: 'บนมือถือแถบเครื่องมือซ่อนไว้เพื่อให้เห็นตารางเต็มจอ กดปุ่ม **เครื่องมือ** เพื่อแสดง/ซ่อน', marks: [{ el: tools, label: 'แสดง/ซ่อนเครื่องมือ' }] });
          await tools.click(); await r.settle(600);
          const add = role(p, 'button', 'เพิ่มแถว');
          await r.shot({ title: 'กด “+ เพิ่มแถว”', text: 'กด **+ เพิ่มแถว** แล้วกรอกฟอร์มทีละช่องเหมือนบนคอมพิวเตอร์ (เลื่อนลงเพื่อกรอกช่องถัดไป)', marks: [{ el: add, label: 'กด + เพิ่มแถว' }] });
          await add.click(); await r.settle();
          await r.shot({ title: 'ฟอร์มเต็มจอ', text: 'กรอกแล้วกด **เพิ่มแถว** ด้านล่าง · แตะนอกฟอร์มไม่ปิดฟอร์ม ปิดด้วยปุ่ม ✕ เท่านั้น', marks: [{ el: role(p.getByRole('dialog'), 'button', 'ปิด').first(), label: 'ปิดฟอร์ม' }] });
        },
      },
    ],
  },
];
