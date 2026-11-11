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
const MD_FOLDER = 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT';
const MD_FILE = 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT (F3QCPF06)';
const MD_PROG = 'Program และค่า Sensitivity ของเครื่อง Metal Detector';
const MDP_FILE = 'af0b3ece-bb7b-41b0-8351-b1d26d8eea2c'; // บันทึกการแก้ไขเครื่อง Metal Detector (F3QCPP28), seed metal_detector_record_problem.sql
const MDP_DASH = 'f1fc4992-3f46-4f93-83b0-a9c323671e3f';
/** people in tag MD (who may sign the metal detector form) */
async function mdMembers(r) {
  const md = (await r.call('GET', '/tags')).find((t) => t.name === 'MD');
  const users = (await r.call('GET', '/users?pageSize=50')).items;
  if (md) await r.call('POST', `/tags/${md.id}/members`, { userIds: users.filter((u) => ['user', 'admin'].includes(u.username)).map((u) => u.id) });
  // as the seed does on a new server: everyone in tag MD may fill the forms of the folder
  const top = (await r.call('GET', '/folders/tree')).find?.((f) => f.name === MD_FOLDER && !f.parentId);
  if (md && top) await r.call('PUT', `/folders/${top.id}/access/tags`, { tagId: md.id, permission: 'write' });
}
async function openMd(r, fileName) {
  const p = r.page;
  await r.go('/browse');
  await p.getByText(MD_FOLDER, { exact: true }).first().click(); await r.settle();
  await p.getByText('Data', { exact: true }).first().click(); await r.settle();
  await p.getByText(fileName, { exact: true }).first().click(); await r.settle(1800);
}
const QH_DASH = '1e6bcab4-c396-44a7-9522-48c85ae4ae3e';
const QI_FILE = '54d453cc-9f4c-4fee-a9c6-a8705dfad684'; // Quality Highlight - Incoming (seed quality_highlight_incoming.sql)
const QI_DASH = 'f1dec61e-7270-435a-92c7-98279a338ea9';
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


/* ---- ข่าวสาร / Tag / จัดการสิทธิ์ ---- */
const NEWS_ALL = 'ประกาศ: หยุดซ่อมบำรุงไลน์ PF1 วันเสาร์ 14 พ.ย.';
const NEWS_QC = 'QC: เพิ่มจุดตรวจซีลกระป๋องทุก 30 นาที';
const NEWS_MINE = 'แจ้งเปลี่ยนกะ ไลน์ PF1 สัปดาห์หน้า';
const REQ_TAG = 'ไลน์ PF1';
const POSTER = `<div style="height:540px;box-sizing:border-box;background:linear-gradient(135deg,#1552F0,#0F766E);color:#fff;display:flex;flex-direction:column;justify-content:center;padding:56px">
  <div style="font-size:30px;opacity:.85">ประกาศ</div><div style="font-size:66px;font-weight:700;line-height:1.2">หยุดซ่อมบำรุง<br>ไลน์ PF1</div>
  <div style="font-size:34px;margin-top:18px">เสาร์ 14 พ.ย. 2026 · 08:00–17:00</div></div>`;
/** a tag (created when missing) with these accounts in it */
async function tagWith(r, name, color, usernames, description) {
  let t = (await r.call('GET', '/tags')).find((x) => x.name === name);
  if (!t) t = await r.call('POST', '/tags', { name, color, description });
  const users = (await r.call('GET', '/users?pageSize=100')).items;
  const ids = users.filter((u) => usernames.includes(u.username)).map((u) => u.id);
  if (ids.length) await r.call('POST', `/tags/${t.id}/members`, { userIds: ids });
  return t;
}
/** tag QC (user + master), a pinned post to everyone with a poster and a post to QC — unread for "user" */
async function newsStage(r) {
  const qc = await tagWith(r, 'QC', '#E11D48', ['user', 'master'], 'ฝ่ายควบคุมคุณภาพ');
  const all = (await r.call('GET', '/tags')).find((t) => t.isSystem);
  for (const x of (await r.call('GET', '/news?pageSize=50')).items) if ([NEWS_ALL, NEWS_QC, NEWS_MINE].includes(x.title)) await r.call('DELETE', `/news/${x.id}`);
  const img = await r.upload('master', await r.picture(POSTER), 'poster.png');
  await r.callAs('master', 'POST', '/news', { title: NEWS_QC, body: 'ตั้งแต่วันจันทร์ที่ 16 พ.ย. ให้ตรวจซีลกระป๋องทุก 30 นาที (เดิมทุก 1 ชั่วโมง)\nบันทึกผลในไฟล์ IR LINE PF1-09 ช่อง “ผลตรวจซีล”', tagIds: [qc.id] });
  await r.callAs('master', 'POST', '/news', { title: NEWS_ALL, body: 'ไลน์ PF1 หยุดซ่อมบำรุงประจำปี เสาร์ที่ 14 พ.ย. 2026 เวลา 08:00–17:00\nพนักงานไลน์ PF1 เข้างานที่ไลน์ PF2 ตามตารางที่หัวหน้าแจ้ง', tagIds: [all.id], pinned: true, images: [img] });
  return { qc, all };
}
/** user has no pending request for REQ_TAG and is not in it */
async function tagRequestReset(r) {
  const t = await tagWith(r, REQ_TAG, '#7C3AED', [], 'พนักงานประจำไลน์ PF1');
  const users = (await r.call('GET', '/users?pageSize=100')).items;
  const me = users.find((u) => u.username === 'user');
  await r.call('DELETE', `/tags/${t.id}/members/${me.id}`);
  for (const q of await r.callAs('user', 'GET', '/tag-requests/mine')) if (q.status === 'pending') await r.callAs('user', 'DELETE', `/tag-requests/${q.id}`);
  return { t, me, users };
}
/** "YYYY-MM-DDTHH:mm" now in Thailand, rounded down to the minute (datetime-local input) */
const thaiNow = () => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
};

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
          // a re-run starts clean: the example request of this guide is taken back first
          for (const q of await r.call('GET', '/account-requests?status=pending')) if (q.username === 'manop') await r.call('POST', `/account-requests/${q.id}/reject`, { reviewNote: 'ตัวอย่างคู่มือ' });
          await p.getByRole('link', { name: 'ขอสร้างบัญชี' }).click();
          await r.settle();
          const inp = p.locator('form input');
          await inp.nth(0).fill('มานพ ตั้งใจ');
          await inp.nth(2).fill('manop');
          await r.shot({
            title: 'กรอกชื่อ อีเมล และชื่อผู้ใช้',
            text: 'กรอกข้อมูลให้ครบทุกช่องที่มีเครื่องหมาย *\n**อีเมลไม่บังคับ** — ไม่มีอีเมลเว้นว่างได้\n**ชื่อผู้ใช้** คือชื่อที่จะใช้เข้าสู่ระบบ ใช้ได้เฉพาะ a-z ตัวเลข และ . _ - อย่างน้อย 3 ตัว',
            marks: [
              { el: box(inp.nth(0)), label: 'ชื่อ-นามสกุลจริง', place: 'right' },
              { el: box(inp.nth(1)), label: 'อีเมล (ไม่มีเว้นว่างได้)', place: 'right' },
              { el: box(inp.nth(2)), label: 'ตั้งชื่อผู้ใช้สำหรับเข้าสู่ระบบ', place: 'right' },
            ],
          });
          await inp.nth(3).fill('Manop2026!');
          await inp.nth(4).fill('Manop2026!');
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
              { el: sidebar(p, 'คำขออนุมัติ'), label: 'คำขออนุมัติ: เอกสาร สิทธิ์ไฟล์ บัญชี Tag', place: 'right' },
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
            text: 'กดที่**ชื่อของคุณ**มุมขวาบน จะมีเมนู:\n• **โปรไฟล์ของฉัน** แก้ชื่อ ชื่อผู้ใช้ อีเมล และเปลี่ยนรหัสผ่าน\n• **ธีมและรูปแบบ** เปลี่ยนสีหน้าจอ\n• **ออกจากระบบ** ใช้เมื่อใช้เครื่องร่วมกับคนอื่น',
            marks: [{ el: p.getByRole('menuitem', { name: 'โปรไฟล์ของฉัน' }).or(p.getByText('โปรไฟล์ของฉัน')), label: 'แก้ข้อมูล / เปลี่ยนรหัสผ่าน', place: 'left' }, { el: p.getByRole('menuitem', { name: 'ออกจากระบบ' }).or(p.locator('[role="menu"] >> text=ออกจากระบบ')), label: 'ออกจากระบบ', place: 'left' }],
          });
        },
      },
      {
        id: 'screen-options', title: 'ซ่อนเมนูด้านซ้าย และซูมหน้าจอ', summary: 'ย่อเมนูเหลือแค่ไอคอน ซ่อนเมนู และขยาย/ย่อขนาดตัวอักษรทั้งหน้า', as: 'user',
        run: async (r) => {
          const p = r.page;
          const nav = role(p, 'button', 'ซ่อน / ย่อเมนูด้านซ้าย');
          await nav.click(); await r.settle(300);
          await r.shot({ title: 'ปุ่มเมนูด้านซ้าย', text: 'กดปุ่มรูป**แผงด้านซ้าย**ที่มุมซ้ายบน แล้วเลือก:\n• **แสดงเมนูเต็ม** — มีชื่อเมนู\n• **แสดงเฉพาะไอคอน** — เมนูแคบลง เหลือที่ให้ตารางมากขึ้น (ชี้ที่ไอคอนเพื่อดูชื่อ)\n• **ซ่อนเมนู** — ซ่อนทั้งหมด กดปุ่มเดิมเพื่อเปิดกลับ', marks: [{ el: p.locator('[role="menu"]').last(), label: 'เลือกรูปแบบเมนู', place: 'right' }] });
          await p.getByText('แสดงเฉพาะไอคอน').click(); await r.settle(500);
          await r.shot({ title: 'เมนูแบบไอคอน', text: 'เมนูเหลือแค่ไอคอน ตัวเลขสีส้มยังแสดงที่มุมไอคอน · ระบบจำการตั้งค่านี้ไว้ในเครื่องนี้', marks: [{ el: p.locator('aside.ds-sidebar'), label: 'เมนูแบบไอคอน', place: 'right' }] });
          await nav.click(); await r.settle(300); await p.getByText('แสดงเมนูเต็ม').click(); await r.settle(400);
          const zoom = role(p, 'button', 'ขนาดหน้าจอ (ซูม)');
          await zoom.click(); await r.settle(300);
          await r.shot({ title: 'ซูมหน้าจอ', text: 'กดปุ่ม**แว่นขยาย**ที่แถบด้านบน แล้วกด **+** เพื่อขยาย หรือ **−** เพื่อย่อทั้งหน้า (70%–150%) · **กลับเป็น 100%** เพื่อคืนค่า\nจำไว้ในเครื่องนี้ ไม่กระทบคนอื่น', marks: [{ el: role(p, 'button', 'ขยาย (ซูมเข้า)'), label: 'ขยาย', place: 'left' }, { el: role(p, 'button', 'ย่อ (ซูมออก)'), label: 'ย่อ', place: 'below' }] });
          await p.keyboard.press('Escape');
        },
      },
      {
        id: 'profile-edit', title: 'แก้ชื่อ ชื่อผู้ใช้ และอีเมลของตัวเอง', summary: 'เปลี่ยนชื่อที่แสดง ชื่อผู้ใช้สำหรับเข้าสู่ระบบ และอีเมล', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.go('/settings?tab=profile', 1200);
          const uname = p.locator('input[autocomplete="username"]').first();
          await r.shot({ title: 'หน้าโปรไฟล์ของฉัน', text: 'กดชื่อของคุณมุมขวาบน → **โปรไฟล์ของฉัน**\n• **ชื่อที่แสดง** — ชื่อที่คนอื่นเห็น\n• **ชื่อผู้ใช้** — ใช้เข้าสู่ระบบ (a-z 0-9 . _ - อย่างน้อย 3 ตัว ห้ามซ้ำกับคนอื่น)\n• **อีเมล** — ไม่บังคับ\nแก้แล้วกด **บันทึกโปรไฟล์**', marks: [{ el: box(uname), label: 'ชื่อผู้ใช้ (เข้าสู่ระบบ)', place: 'right' }, { el: role(p, 'button', 'บันทึกโปรไฟล์'), label: 'กด บันทึก', place: 'right' }] });
          r.note({ title: 'เปลี่ยนชื่อผู้ใช้แล้ว', text: 'ครั้งต่อไปให้**เข้าสู่ระบบด้วยชื่อผู้ใช้ใหม่** (รหัสผ่านเดิม) — ชื่อเดิมใช้ไม่ได้แล้ว · ลืมว่าเปลี่ยนเป็นอะไร เข้าด้วยอีเมลได้ (ถ้ามี) หรือให้ Admin ดูให้ที่หน้าจัดการผู้ใช้\nAdmin แก้ชื่อผู้ใช้ของคนอื่นได้ที่ **จัดการผู้ใช้ → ⋯ → แก้ไข**' });
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
        id: 'data-search', title: 'ค้นหาข้อมูลจากทุกไฟล์ (Search)', summary: 'พิมพ์คำเดียว ระบบหาให้ทุกแถวในทุกชีตที่มีคำนั้น', as: 'user',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “Search”', text: 'กดเมนู **Search** ทางซ้าย', marks: [{ el: sidebar(p, 'Search'), label: 'กด Search', place: 'right' }] });
          await sidebar(p, 'Search').click(); await r.settle();
          const q = p.getByLabel('คำที่ต้องการหา');
          await r.shot({ title: 'เลือก “ค้นหาทุกข้อมูล”', text: 'หน้า Search มี 2 แบบ: **ค้นหาทุกข้อมูล** (พิมพ์คำแล้วหาจากทุกไฟล์) และ **ย้อนรอย (Traceback)** (เลือกไฟล์/ชีต/คอลัมน์ เพื่อดูว่าล็อตทำมาจากอะไร)', marks: [{ el: role(p, 'button', 'ค้นหาทุกข้อมูล'), label: 'ค้นหาทุกข้อมูล', place: 'below' }, { el: role(p, 'button', 'ย้อนรอย (Traceback)'), label: 'ย้อนรอยล็อต (แบบเดิม)', place: 'below' }] });
          await q.fill('สมหญิง'); await r.settle(2200);
          await r.shot({
            title: 'พิมพ์คำที่ต้องการหา',
            text: 'พิมพ์อย่างน้อย 2 ตัวอักษร เช่น รหัสสินค้า เลขล็อต ชื่อคน ระบบค้นในทุกชีตของทุกไฟล์ที่คุณมีสิทธิ์ (ทุกคอลัมน์) แล้วแสดงแยกตาม **ไฟล์ › ชีต** พร้อมไฮไลต์คำที่เจอ',
            marks: [{ el: box(q), label: 'พิมพ์คำที่ต้องการหา', place: 'below' }, { el: p.locator('section').first().locator('header'), label: 'ไฟล์ › ชีต ที่เจอ และจำนวนแถว', place: 'below' }],
          });
          const first = p.locator('section').first().locator('li button').first();
          await r.shot({ title: 'กดที่ผลลัพธ์เพื่อเปิดแถว', text: 'กดที่แถวที่ต้องการ ระบบเปิดไฟล์และแสดงข้อมูลทั้งแถวนั้นให้ทันที', marks: [{ el: first, label: 'กดเพื่อเปิดแถวนี้', place: 'below' }] });
          await first.click(); await r.settle(2200);
          await r.shot({ title: 'แถวที่ค้นเจอ', text: 'เห็นข้อมูลทุกช่องของแถวนั้น กด **แก้ไข** ถ้ามีสิทธิ์ หรือปิดหน้าต่างเพื่อดูทั้งตาราง', marks: [{ el: p.getByRole('dialog').locator('h2').first(), label: 'แถวที่ค้นเจอ' }] });
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
          const cell = p.locator('tbody td').filter({ hasText: /^ธนกร( \(แก้ไข\))?$/ }).first(); // (an interrupted run may have left the edited value)
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
          // put the example value back so the guide can run again
          await p.locator('tbody td', { hasText: 'ธนกร (แก้ไข)' }).first().dblclick(); await r.settle(300);
          await p.keyboard.press('Control+A'); await p.keyboard.type('ธนกร'); await p.keyboard.press('Enter'); await r.settle(700);
          const lineCell = p.locator('tbody tr').first().locator('td').nth(2);
          await lineCell.dblclick(); await r.settle(500);
          await r.shot({ title: 'ช่องแบบเลือกจากรายการ', text: 'ช่องที่เป็นรายการ (เช่น ไลน์) ดับเบิลคลิกแล้วจะมีรายการให้เลือก กดค่าที่ต้องการได้เลย', marks: [{ el: lineCell, label: 'ดับเบิลคลิก แล้วเลือกจากรายการ' }] });
          await p.keyboard.press('Escape');
        },
      },
      {
        id: 'type-excel', title: 'พิมพ์ลงตารางแบบ Excel (คอมพิวเตอร์)', summary: 'คลิกช่องแล้วพิมพ์ทับได้เลย · เพิ่มแถวใหม่โดยพิมพ์ในแถว * ล่างสุด', as: 'user',
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const colOf = (name) => p.evaluate((n) => [...document.querySelectorAll('thead th')].findIndex((th) => th.textContent.includes(n)) - 1, name);
          const qty = await colOf('ยอดผลิต');
          const cell = p.locator(`[data-cell="0:${qty}"]`);
          await cell.click(); await r.settle(200);
          await p.keyboard.type('1250'); await r.settle(300);
          await r.shot({ title: 'คลิกช่อง แล้วพิมพ์ทับได้เลย', text: 'คลิกช่องครั้งเดียว แล้ว**พิมพ์ได้ทันที** (ค่าเดิมถูกแทนที่) กด **Enter** ลงไปช่องล่าง · **Tab** ไปช่องขวา · ลูกศรย้ายช่อง · **Delete** ล้างค่า · **Ctrl+C / Ctrl+V** คัดลอก-วางจาก Excel ได้', marks: [{ el: cell, label: 'พิมพ์ทับได้เลย' }] });
          await p.keyboard.press('Escape'); await r.settle(300); // Esc: the old value stays
          const last = await p.locator('tbody tr').count();
          const d = last - 1;
          const draft = p.locator('tr.draft-row');
          await draft.scrollIntoViewIfNeeded();
          await p.locator(`[data-cell="${d}:${qty}"]`).click(); await r.settle(200);
          await p.keyboard.type('980'); await p.keyboard.press('Tab'); await r.settle(200); await p.keyboard.type('4'); await p.keyboard.press('Enter'); await r.settle(500);
          await r.shot({
            title: 'แถวใหม่: พิมพ์ในแถว * ล่างสุด',
            text: 'แถวที่มีเครื่องหมาย “*” ล่างสุดคือแถวใหม่ พิมพ์ทีละช่องได้เลย ช่องที่**จำเป็น**ซึ่งยังว่างจะเป็นสีชมพู · เมื่อกรอกช่องจำเป็นครบ ระบบ**บันทึกเป็นแถวใหม่ให้เอง** แล้วขึ้นแถว * ใหม่ให้พิมพ์ต่อ · ปุ่ม ✓ บันทึกทันที · ✕ ล้างแถวที่พิมพ์ค้างไว้',
            marks: [{ el: draft.locator('td').first(), label: 'แถวใหม่ (*)', place: 'right' }],
          });
          await draft.getByRole('button', { name: 'ล้างแถวใหม่' }).click(); await r.settle(300);
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
        id: 'image-delete', title: 'เพิ่มและลบรูปในแถว', summary: 'ลบรูปที่ใส่ผิด หรือเพิ่มรูปใหม่ในช่องรูปภาพ', as: 'admin',
        run: async (r) => {
          const p = r.page;
          // a row of Quality Highlight that has pictures
          const sid = (await r.call('GET', `/files/${QH_FILE}`)).sheets[0].id;
          const cols = (await r.call('GET', `/sheets/${sid}`)).columns;
          const img = cols.find((c) => c.dataType === 'image');
          const row = (await r.call('POST', `/sheets/${sid}/rows/query`, { pageSize: 500 })).rows.find((x) => Array.isArray(x.values[img.id]) && x.values[img.id].length);
          const key = row.values[cols[0].id];
          await r.go(`/files/${QH_FILE}`, 1800);
          await p.getByPlaceholder('ค้นหาในชีต…').fill(String(key)); await r.settle(1200);
          const idx = (await p.locator('thead th').allInnerTexts()).findIndex((t) => t.trim().endsWith(img.name));
          const cell = p.locator('tbody tr').first().locator('td').nth(idx);
          await r.shot({ title: 'ดับเบิลคลิกช่องรูปภาพ', text: 'หาแถวที่ต้องการ แล้ว**คลิกที่ช่องรูปภาพ (นอกตัวรูป) แล้วกด Enter** หรือดับเบิลคลิกที่ว่างในช่อง (บนมือถือแตะ 2 ครั้ง) — หรือเปิดแถวในฟอร์ม (คลิกขวา → เปิดแถวในฟอร์ม → แก้ไข) ก็ได้เหมือนกัน', marks: [{ el: cell, label: 'ดับเบิลคลิกช่องรูป', place: 'below' }] });
          await cell.click({ position: { x: 4, y: 4 } }); await r.settle(200); await p.keyboard.press('Enter'); await r.settle(700); // (a double click on a picture opens it large)
          const del = p.getByRole('button', { name: 'ลบรูปนี้' }).first();
          await r.shot({ title: 'กด ✕ ที่มุมรูปเพื่อลบ', text: 'ทุกรูปมีปุ่ม **✕** สีดำที่มุมขวาบน กดเพื่อลบรูปนั้น (กดที่ตัวรูปเพื่อดูภาพใหญ่)\n• **ถ่ายรูป** / **เพิ่มรูป** = ใส่รูปเพิ่ม\n• **ลบรูปทั้งหมด** = ล้างทั้งช่อง\nกด **เสร็จ** แล้วจึงบันทึก — ลบผิดกด **ย้อนกลับ** (Ctrl+Z) หรือดูประวัติของแถวได้', marks: [{ el: del, label: 'ลบรูปนี้', place: 'right' }, { el: p.getByRole('button', { name: 'ลบรูปทั้งหมด' }), label: 'ลบทุกรูป', place: 'above' }] });
          await p.getByRole('button', { name: 'เสร็จ' }).click(); await r.settle(400); // (demo: nothing removed)
          r.note({ title: 'ข้อมูลอื่นก็แก้ / ลบแบบเดียวกัน', text: '• ข้อความ ตัวเลข วันที่: ดับเบิลคลิกแล้วพิมพ์ใหม่ หรือลบให้ว่างแล้วกด Enter\n• ตัวเลือก: ดับเบิลคลิกแล้วเลือกใหม่ หรือเลือก “ว่าง”\n• ลบทั้งแถว: ดูเรื่อง “ลบแถว และกู้คืนแถวที่ลบ”' });
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
      {
        id: 'rollback-sheet', title: 'ย้อนข้อมูลทั้งชีตไปยังเวลาที่เลือก', summary: 'กู้ข้อมูลทั้งชีตกลับไปเหมือนเวลาก่อนแก้ผิด (ทำไมปุ่ม “ย้อนข้อมูล” กดไม่ได้)', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await openDemoFile(r);
          const fileId = new URL(p.url()).pathname.split('/')[2];
          const sheet = (await r.call('GET', `/files/${fileId}`)).sheets[0];
          const at = thaiNow();
          // the "mistake" to undo: a row deleted a few seconds after the chosen minute (the rollback brings it back)
          const row = (await r.call('POST', `/sheets/${sheet.id}/rows/query`, { limit: 1 })).rows[0];
          await p.waitForTimeout(1500);
          await r.call('DELETE', `/rows/${row.id}`);
          await r.settle(600);
          const btn = role(p, 'button', 'ย้อนข้อมูลทั้งชีต');
          await r.shot({ title: 'ปุ่ม “ย้อนข้อมูลทั้งชีต”', text: 'เปิดไฟล์และชีตที่ต้องการ แล้วกดปุ่มรูป**ลูกศรวนกลับ**ที่แถบเครื่องมือขวามือ (เห็นเฉพาะ Admin / Root)\nใช้เมื่อมีการแก้ไขผิดจำนวนมาก เช่น นำเข้าข้อมูลผิดไฟล์ หรือลบแถวผิด', marks: [{ el: btn, label: 'ย้อนข้อมูลทั้งชีต', place: 'left' }] });
          await btn.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await dlg.locator('input[type="datetime-local"]').fill(at);
          await r.shot({ title: '1. เลือกเวลาที่ต้องการย้อนกลับไป', text: 'เลือก**วันที่และเวลา**ก่อนที่ข้อมูลจะผิด ระบบจะทำให้ทั้งชีตเหมือนตอนเวลานั้น (คอลัมน์ไม่เปลี่ยน)', marks: [{ el: dlg.locator('input[type="datetime-local"]'), label: 'เวลาก่อนแก้ผิด', place: 'below' }] });
          await role(dlg, 'button', 'ดูผลกระทบ').click(); await r.settle(900);
          await r.shot({ title: '2. กด “ดูผลกระทบ”', text: 'ระบบนับให้ก่อนว่าจะ**เปลี่ยนกี่เซลล์ ลบกี่แถว กู้คืนกี่แถว** — ตรวจตัวเลขว่าตรงกับที่คาดไว้\nตอนนี้ปุ่ม **ย้อนข้อมูล** ยังเป็นสีจาง เพราะยังไม่ได้ใส่เหตุผล', marks: [{ el: dlg.getByText('แถวที่จะกู้คืน'), label: 'สิ่งที่จะเกิดขึ้น', place: 'below' }, { el: role(dlg, 'button', 'ย้อนข้อมูล', { exact: true }), label: 'ยังกดไม่ได้', place: 'above' }] });
          await dlg.locator('textarea').fill('.');
          await r.shot({ title: '3. ทำไมปุ่ม “ย้อนข้อมูล” กดไม่ได้', text: 'ช่อง**เหตุผล**ต้องมี**อย่างน้อย 5 ตัวอักษร** (เหตุผลถูกบันทึกในประวัติการแก้ไข) — พิมพ์แค่ “.” จะยังกดไม่ได้ ใต้ช่องบอกว่าต้องพิมพ์อีกกี่ตัว', marks: [{ el: dlg.getByText(/พิมพ์เหตุผลอีก/), label: 'บอกจำนวนที่ยังขาด', place: 'below' }] });
          await dlg.locator('textarea').fill('ลบแถวผิดเมื่อสักครู่ ขอกู้คืน');
          await r.shot({ title: '4. ใส่เหตุผลแล้วกด “ย้อนข้อมูล”', text: 'พิมพ์เหตุผลให้ครบ ปุ่ม **ย้อนข้อมูล** สีแดงจะกดได้ กดแล้วยืนยันอีกครั้ง', marks: [{ el: role(dlg, 'button', 'ย้อนข้อมูล', { exact: true }), label: 'กด ย้อนข้อมูล', place: 'above' }] });
          await role(dlg, 'button', 'ย้อนข้อมูล', { exact: true }).click(); await r.settle(500);
          const confirm = p.getByRole('dialog').last();
          await r.shot({ title: '5. ยืนยัน', text: 'อ่านข้อความแล้วกด **ย้อนข้อมูลทั้งชีต** — การย้อนจะถูกบันทึกเป็นการแก้ไขใหม่ จึงย้อนกลับได้อีกจากประวัติ', marks: [{ el: role(confirm, 'button', 'ย้อนข้อมูลทั้งชีต'), label: 'ยืนยัน', place: 'above' }] });
          await role(confirm, 'button', 'ย้อนข้อมูลทั้งชีต').click(); await r.settle(1200);
          r.note({ title: 'ย้อนเฉพาะบางแถว', text: 'ถ้าผิดแค่แถวเดียว ไม่ต้องย้อนทั้งชีต: เปิดแถวนั้นแล้วใช้ **ประวัติ** ของแถว (ดูเรื่อง “ดูประวัติการแก้ไข”) หรือกู้แถวที่ลบจาก **แถวที่ถูกลบ**' });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'doctype', title: 'ประเภทเอกสารและ Rev', icon: 'sheet', description: 'Master Data · แบบฟอร์มบันทึก · ทั่วไป — Rev ของข้อมูลและของรูปแบบฟอร์ม',
    guides: [
      {
        id: 'doctype-about', title: 'ประเภทเอกสารมีอะไรบ้าง', summary: 'เลือกประเภทตอนสร้างไฟล์ แล้ว Rev จะทำงานตามประเภท', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/files/new', 1200);
          const pick = p.getByRole('radiogroup', { name: 'ประเภทเอกสาร' });
          await pick.scrollIntoViewIfNeeded();
          await r.shot({ title: 'เลือกประเภทตอนสร้างไฟล์', text: 'ตอน **สร้างไฟล์** ขั้นแรกต้องเลือก **ประเภทเอกสาร**:\n• **Master Data (ข้อมูลหลัก)** — ข้อมูลอ้างอิงที่ต้องควบคุม เช่น Quality Highlight, ตาราง Program · แก้ข้อมูลแล้วระบบเตือนให้ออก Rev\n• **แบบฟอร์มบันทึก** — ฟอร์มที่ลงข้อมูลทุกวัน เช่น ใบตรวจ Metal Detector · ออก Rev เมื่อแก้**รูปแบบฟอร์ม** ข้อมูลที่ลงไม่ต้องออก Rev\n• **ทั่วไป** — ไม่ติดตาม Rev อัตโนมัติ (ไฟล์เดิมทั้งหมดเริ่มที่ประเภทนี้)', marks: [{ el: pick, label: 'เลือก 1 ประเภท', place: 'above' }] });
          r.note({ title: 'Rev เริ่มต้น', text: 'สร้างไฟล์ Master Data หรือแบบฟอร์มบันทึก (หรือเปลี่ยนไฟล์เดิมเป็นประเภทนี้) ระบบออก **Rev.1 (Rev เริ่มต้น)** ให้ทุกชีตอัตโนมัติ เป็นจุดเริ่มเทียบการเปลี่ยนแปลง · ชีตรวมข้อมูลไม่มี Rev' });
        },
      },
      {
        id: 'doctype-set', title: 'เปลี่ยนประเภทเอกสารของไฟล์ / ทั้งโฟลเดอร์', summary: 'ตั้งประเภทให้ไฟล์เดิมทีละไฟล์ หรือทั้งโฟลเดอร์ทีเดียว (Admin)', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/browse');
          await p.getByText('Production Reports', { exact: true }).first().click(); await r.settle();
          await p.getByText('QC Line', { exact: true }).first().click(); await r.settle(900);
          const card = p.locator('div.ds-card').filter({ hasText: FILE }).first();
          await card.getByRole('button', { name: 'ตัวเลือก' }).click(); await r.settle(300);
          const item = p.getByText(/^ประเภทเอกสาร:/).last();
          await r.shot({ title: 'ไฟล์: ⋯ → ประเภทเอกสาร', text: 'กด **⋯** ที่ไฟล์ (หรือ ⋯ มุมขวาบนในหน้าไฟล์) → **ประเภทเอกสาร: …** (Master ขึ้นไปที่จัดการไฟล์ได้) · การ์ดไฟล์ที่ตั้งประเภทแล้วมีป้ายสีบอกประเภท', marks: [{ el: item, label: 'ประเภทเอกสาร', place: 'left' }] });
          await item.click(); await r.settle(500);
          const dlg = p.getByRole('dialog');
          await r.shot({ title: 'เลือกประเภทแล้วกด “บันทึก”', text: 'เลือกประเภทใหม่แล้วกด **บันทึก** — ชีตที่ยังไม่เคยออก Rev จะได้ Rev เริ่มต้นอัตโนมัติ ไม่แก้ข้อมูลในไฟล์', marks: [{ el: dlg.getByRole('radiogroup'), label: 'ประเภท', place: 'below' }] });
          await role(dlg, 'button', 'ยกเลิก').click(); await r.settle(300);
          await r.go('/browse', 900);
          const fcard = p.locator('div.ds-card').filter({ hasText: 'Production Reports' }).first();
          await fcard.getByRole('button', { name: 'ตัวเลือก' }).click(); await r.settle(300);
          const fitem = p.getByText('ตั้งประเภทเอกสารทั้งโฟลเดอร์').last();
          await r.shot({ title: 'ทั้งโฟลเดอร์: ⋯ → ตั้งประเภทเอกสารทั้งโฟลเดอร์', text: 'Admin กด **⋯** ที่โฟลเดอร์ → **ตั้งประเภทเอกสารทั้งโฟลเดอร์** → เลือกประเภท เลือกว่ารวมโฟลเดอร์ย่อย และ “เฉพาะไฟล์ที่ยังเป็นทั่วไป” หรือไม่ แล้วกด **ตั้งประเภท**\nหน้าโฟลเดอร์มีตัวกรอง **ทุกประเภทเอกสาร** ไว้ดูเฉพาะประเภทที่ต้องการ', marks: [{ el: fitem, label: 'ตั้งทั้งโฟลเดอร์', place: 'left' }] });
          await p.keyboard.press('Escape');
        },
      },
      {
        id: 'doctype-rev', title: 'ดู Rev ของชีต ว่าแต่ละ Rev แก้อะไร', summary: 'แท็บชีต ⋯ → Rev ของชีตนี้ · Rev ของแบบฟอร์มบอกการเปลี่ยนรูปแบบ', as: 'admin',
        run: async (r) => {
          const p = r.page;
          await mdMembers(r);
          // a format change on the form, issued as a Rev (the example to look at)
          const form = (await r.call('GET', '/files/accessible')).find?.((f) => f.name === MD_FILE) ?? (await r.call('GET', '/files/accessible')).items?.find((f) => f.name === MD_FILE);
          const fd = await r.call('GET', `/files/${form.id}`);
          const sid = fd.sheets[0].id;
          const col = (await r.call('GET', `/sheets/${sid}`)).columns.find((c) => c.dataType === 'select');
          await r.call('PUT', `/columns/${col.id}`, { description: `ตรวจตามรอบเวลาที่กำหนด (แก้ ${new Date().toLocaleDateString('th-TH')})` });
          await r.call('POST', `/sheets/${sid}/revisions`, { note: 'ปรับคำอธิบายช่องตามคู่มือ QC' });
          await openMd(r, MD_FILE);
          const badge = p.getByRole('button', { name: /แบบฟอร์ม Rev\./ });
          await r.shot({ title: 'ป้าย Rev บนแถบเครื่องมือ', text: 'ไฟล์ที่มี Rev จะมีปุ่ม **Rev.N** (แบบฟอร์มบันทึกเขียนว่า **แบบฟอร์ม Rev.N**) · ถ้ามีตัวเลขสีส้ม = มีการเปลี่ยนแปลงที่ยังไม่ออก Rev — กดเพื่อดูและออก Rev', marks: [{ el: badge, label: 'Rev ปัจจุบัน', place: 'below' }] });
          await p.locator('[aria-label^="ตัวเลือกชีต"]').click(); await r.settle(300);
          await r.shot({ title: 'แท็บชีต ⋯ → “Rev ของชีตนี้”', text: 'กดลูกศรเล็กที่แท็บชีตที่เปิดอยู่ แล้วเลือก **Rev ของชีตนี้** (ทุกคนที่เปิดไฟล์ได้ดูได้)', marks: [{ el: p.getByText('Rev ของชีตนี้'), label: 'Rev ของชีตนี้', place: 'right' }] });
          await p.getByText('Rev ของชีตนี้').click(); await r.settle(1200);
          const dlg = p.getByRole('dialog');
          const latest = dlg.locator('nav button').nth(1);
          await latest.click(); await r.settle(1000);
          await r.shot({ title: 'เลือก Rev เพื่อดูว่าแก้อะไร', text: 'ทางซ้ายคือรายการ Rev (ล่าสุดอยู่บน) กดที่ Rev เพื่อดูรายละเอียด:\n• **การเปลี่ยนรูปแบบ** — เพิ่ม/ลบ/เปลี่ยนชื่อคอลัมน์ ตัวเลือก เงื่อนไข/สูตร Form layout และแม่แบบ PDF\n• Master Data แสดง**แถวที่เพิ่ม / แก้ / ลบ** ด้วย\n**ยังไม่ออก Rev** (บนสุด) = สิ่งที่จะอยู่ใน Rev ถัดไป ใส่หมายเหตุแล้วกด **ออก Rev.N**', marks: [{ el: latest, label: 'Rev ล่าสุด', place: 'right' }, { el: dlg.getByText(/การเปลี่ยนรูปแบบ/).first(), label: 'รูปแบบที่เปลี่ยน', place: 'below' }] });
          await role(dlg, 'button', 'ปิด').first().click().catch(() => undefined);
          r.note({ title: 'ใบเก่าใช้แบบฟอร์ม Rev ไหน', text: '• เปิดแถวในฟอร์ม (คลิกขวา → เปิดแถวในฟอร์ม) หัวหน้าต่างบอก **ลงด้วยแบบฟอร์ม Rev.N**\n• แก้แม่แบบ PDF แล้วออก Rev — เมนู **ส่งออก** จะมี **PDF — … (รูปแบบ Rev.N)** ไว้พิมพ์ใบเก่าด้วยหน้าตาแบบเดิม\n• แบบฟอร์มบันทึก: ลงข้อมูลไม่ต้องออก Rev · Master Data: แก้ข้อมูลแล้วออก Rev (ดูเรื่อง “แก้ Master และออก Rev ใหม่”)' });
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
          // a re-run starts clean: "user" has no access to the file and no request waiting
          const me = (await r.call('GET', '/users?pageSize=100')).items.find((u) => u.username === 'user');
          await r.call('DELETE', `/files/${QH_FILE}/access/${me.id}`);
          for (const q of await r.callAs('user', 'GET', '/access-requests?box=mine&status=pending')) await r.callAs('user', 'POST', `/access-requests/${q.id}/cancel`, {});
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
          await r.shot({ title: 'รอการอนุมัติ', text: 'หน้าไฟล์จะแสดง **คำขอของคุณกำลังรอการอนุมัติ** เมื่อได้รับอนุมัติจะมีการแจ้งเตือน แล้วเปิดไฟล์ได้เลย · ดูคำขอทั้งหมดได้ที่เมนู **คำขออนุมัติ → คำขอสิทธิ์ไฟล์**', marks: [{ el: p.getByText('คำขอของคุณกำลังรอการอนุมัติ'), label: 'รออนุมัติ' }, { el: sidebar(p, 'คำขออนุมัติ'), label: 'ติดตามคำขอ', place: 'right' }] });
        },
      },
      {
        id: 'approve-access', title: 'อนุมัติคำขอสิทธิ์', summary: 'ผู้ดูแลไฟล์อนุมัติหรือปฏิเสธคำขอสิทธิ์', as: 'admin',
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “คำขออนุมัติ”', text: 'เมื่อมีคำขอใหม่ จะมีการแจ้งเตือนและตัวเลขที่เมนู **คำขออนุมัติ** กดเมนูนี้', marks: [{ el: sidebar(p, 'คำขออนุมัติ'), label: 'กด คำขออนุมัติ', place: 'right' }] });
          await sidebar(p, 'คำขออนุมัติ').click(); await r.settle(1000);
          const tab = p.getByRole('button', { name: /คำขอสิทธิ์ไฟล์/ });
          await r.shot({ title: 'แท็บ “คำขอสิทธิ์ไฟล์”', text: 'หน้า **คำขออนุมัติ** รวมคำขอทุกแบบไว้ที่เดียว: **อนุมัติเอกสาร** (PDF ที่รอลงนาม) · **คำขอสิทธิ์ไฟล์** · **คำขอสร้างบัญชี** (Admin) · **คำขอ Tag** (Master ขึ้นไป) — ตัวเลขบนแท็บคือจำนวนที่รอคุณ\nกดแท็บ **คำขอสิทธิ์ไฟล์**', marks: [{ el: tab, label: 'กด คำขอสิทธิ์ไฟล์', place: 'below' }] });
          await tab.click(); await r.settle(900);
          const mine = role(p, 'button', 'รอฉันอนุมัติ');
          await r.shot({ title: 'เลือก “รอฉันอนุมัติ”', text: 'เลือก **รอฉันอนุมัติ** (คำขอที่ส่งถึงคุณ) · **คำขอของฉัน** คือคำขอที่คุณส่งไปเอง', marks: [{ el: mine, label: 'กด รอฉันอนุมัติ', place: 'below' }] });
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
    id: 'news', title: 'ข่าวสาร', icon: 'news', description: 'อ่านข่าว โพสต์ประกาศ และส่งถึงคนที่เกี่ยวข้องด้วย Tag',
    guides: [
      {
        id: 'news-read', title: 'อ่านข่าวสาร', summary: 'ดูประกาศที่ส่งถึงคุณ ข่าวปักหมุด ข่าวใหม่ และค้นหาข่าว', as: 'user',
        run: async (r) => {
          const p = r.page;
          await newsStage(r);
          await r.go('/', 1200);
          await r.shot({ title: 'เมนู “ข่าวสาร”', text: 'เมนู **ข่าวสาร** อยู่ทางซ้าย ตัวเลขสีส้ม = **ข่าวใหม่ที่ยังไม่ได้อ่าน** (นับเฉพาะข่าวที่ส่งถึง Tag ของคุณ)', marks: [{ el: sidebar(p, 'ข่าวสาร'), label: 'กด ข่าวสาร', place: 'right' }] });
          await sidebar(p, 'ข่าวสาร').click(); await r.settle(1300);
          const pinned = p.locator('article').filter({ hasText: NEWS_ALL });
          const qc = p.locator('article').filter({ hasText: NEWS_QC });
          await r.shot({
            title: 'หน้าข่าวสาร',
            text: '• ข่าว**ปักหมุด**อยู่บนสุดเสมอ\n• ป้าย **ใหม่** = ข่าวที่ยังไม่เคยเห็น (เปิดหน้านี้แล้วตัวเลขที่เมนูจะหายไป)\n• **ถึง** บอกว่าข่าวส่งถึง Tag ไหน — **All** = ทุกคน',
            marks: [{ el: pinned.getByText('ปักหมุด', { exact: true }), label: 'ข่าวปักหมุด', place: 'left' }, { el: pinned.locator('header').getByText('All', { exact: true }), label: 'ส่งถึงทุกคน', place: 'right' }],
          });
          await qc.scrollIntoViewIfNeeded();
          await r.shot({ title: 'ข่าวที่ส่งถึงเฉพาะกลุ่ม', text: 'ข่าวนี้ส่งถึง Tag **QC** จึงเห็นเฉพาะคนที่มี Tag QC (และผู้ดูแลระบบ) — ลิงก์ที่ขึ้นต้นด้วย https:// ในข้อความกดเปิดได้\nถ้าข่าวส่งถึง Tag ของคุณ (ที่ไม่ใช่ All) จะมี**แจ้งเตือน**ที่รูปกระดิ่งด้วย กดแจ้งเตือนเพื่อเปิดข่าวนั้น', marks: [{ el: qc.locator('header').getByText('QC', { exact: true }), label: 'ส่งถึง Tag QC', place: 'right' }] });
          await pinned.locator('img').first().click(); await r.settle(600);
          await r.shot({ title: 'ดูรูปขนาดใหญ่', text: 'กดรูปในข่าวเพื่อดูเต็มจอ (มีหลายรูปกดลูกศรซ้าย/ขวา) · กด **✕** มุมขวาบนเพื่อปิด', marks: [{ el: p.getByRole('dialog', { name: 'ดูรูปภาพ' }).getByRole('button', { name: 'ปิด' }), label: 'ปิดรูป', place: 'left' }] });
          await p.getByRole('dialog', { name: 'ดูรูปภาพ' }).getByRole('button', { name: 'ปิด' }).click(); await r.settle(400);
          await p.locator('#page-scroll').evaluate((el) => el.scrollTo(0, 0));
          await r.shot({ title: 'ค้นหาและกรองข่าว', text: 'พิมพ์คำค้นในช่อง**ค้นหา** (หาจากหัวข้อและข้อความ) · เลือก **Tag** เพื่อดูเฉพาะข่าวของกลุ่มนั้น · เปิด **ข่าวที่ฉันโพสต์** เพื่อดูเฉพาะของตัวเอง', marks: [{ el: box(p.getByPlaceholder('ค้นหาหัวข้อ / ข้อความ…')), label: 'ค้นหา', place: 'below' }, { el: p.getByLabel('กรองตาม Tag'), label: 'กรองตาม Tag', place: 'below' }] });
        },
      },
      {
        id: 'news-post', title: 'โพสต์ข่าว / ประกาศ', summary: 'เขียนข่าว แนบรูป เลือก Tag ของคนที่ควรเห็น (All = ทุกคน)', as: 'user',
        run: async (r) => {
          const p = r.page;
          const { qc } = await newsStage(r);
          await r.go('/news', 1200);
          await r.shot({ title: 'กด “โพสต์ข่าว”', text: 'ที่หน้า **ข่าวสาร** กดปุ่ม **โพสต์ข่าว** มุมขวาบน (Viewer อ่านได้อย่างเดียว ไม่มีปุ่มนี้)', marks: [{ el: role(p, 'button', 'โพสต์ข่าว').first(), label: 'กด โพสต์ข่าว', place: 'left' }] });
          await role(p, 'button', 'โพสต์ข่าว').first().click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await dlg.getByPlaceholder(/แจ้งหยุดไลน์/).fill(NEWS_MINE);
          await dlg.getByPlaceholder(/พิมพ์ข้อความ/).fill('สัปดาห์หน้า (16–20 พ.ย.) ไลน์ PF1 สลับเป็นกะเช้า 06:00–14:00\nตรวจรายชื่อได้ที่บอร์ดหน้าไลน์');
          await r.shot({ title: 'ใส่หัวข้อและรายละเอียด', text: 'พิมพ์**หัวข้อ**ให้สั้นและชัด แล้วพิมพ์**รายละเอียด** (ขึ้นบรรทัดใหม่ได้ ลิงก์ https:// จะกดได้)', marks: [{ el: dlg.getByPlaceholder(/แจ้งหยุดไลน์/), label: 'หัวข้อ', place: 'below' }, { el: dlg.getByPlaceholder(/พิมพ์ข้อความ/), label: 'รายละเอียด', place: 'below' }] });
          const group = dlg.getByRole('group').filter({ hasText: 'ส่งถึง (Tag)' });
          await group.getByRole('button', { name: 'QC', exact: true }).click(); await r.settle(300);
          await r.shot({ title: 'เลือกว่าใครควรเห็น (Tag)', text: 'แตะ **Tag** ของคนที่เกี่ยวข้อง (เลือกได้หลาย Tag) ใต้ช่องจะบอกว่าใครเห็นได้\n• กด **ส่งถึงทุกคน (เลือก All)** = ทุกคนในระบบเห็น\n• ต้องเลือกอย่างน้อย 1 Tag', marks: [{ el: group.getByRole('button', { name: 'QC', exact: true }), label: 'ส่งถึง Tag QC', place: 'right' }, { el: group.getByRole('button', { name: 'ส่งถึงทุกคน (เลือก All)' }), label: 'หรือส่งถึงทุกคน', place: 'right' }] });
          await dlg.locator('input[type="file"]').setInputFiles({ name: 'shift.png', mimeType: 'image/png', buffer: await r.picture(POSTER.replace('หยุดซ่อมบำรุง<br>ไลน์ PF1', 'เปลี่ยนกะ<br>ไลน์ PF1').replace('เสาร์ 14 พ.ย. 2026 · 08:00–17:00', '16–20 พ.ย. 2026 · กะเช้า 06:00–14:00')) });
          await dlg.locator('img').first().waitFor(); await r.settle(500);
          await r.shot({ title: 'แนบรูป (ไม่บังคับ)', text: 'กด **เพิ่มรูป** แล้วเลือกรูปจากเครื่อง/กล้องมือถือ (ได้ถึง 10 รูป รูปใหญ่ถูกย่อให้อัตโนมัติ) · กด **✕** บนรูปเพื่อเอาออก\nช่อง **ลิงก์** ใส่ลิงก์ไฟล์ใน DocHUB (ปุ่มแชร์ → คัดลอกลิงก์) หรือเว็บไซต์ได้', marks: [{ el: dlg.locator('img').first(), label: 'รูปที่แนบ', place: 'right' }] });
          await r.shot({ title: 'กด “โพสต์”', text: 'ตรวจแล้วกด **โพสต์** — คนที่มี Tag ที่เลือกจะเห็นข่าวทันที และได้รับแจ้งเตือน', marks: [{ el: role(dlg, 'button', 'โพสต์', { exact: true }), label: 'กด โพสต์', place: 'above' }] });
          await role(dlg, 'button', 'โพสต์', { exact: true }).click(); await r.settle(1300);
          const mine = p.locator('article').filter({ hasText: NEWS_MINE });
          await mine.getByRole('button', { name: 'ตัวเลือกข่าว' }).click(); await r.settle(300);
          await r.shot({ title: 'แก้ไขหรือลบข่าวของตัวเอง', text: 'ข่าวที่โพสต์แล้วอยู่ในรายการ (ข่าวปักหมุดยังอยู่บนสุด) · กด **⋯** ที่ข่าวของคุณเพื่อ **แก้ไข** หรือ **ลบ** — Admin แก้/ลบข่าวของทุกคนได้', marks: [{ el: p.locator('[role="menu"]').last(), label: 'แก้ไข / ลบ', place: 'left' }] });
          await p.keyboard.press('Escape'); await r.settle(200);
        },
      },
      {
        id: 'news-pin', title: 'ปักหมุดข่าวสำคัญ', summary: 'ให้ข่าวสำคัญอยู่บนสุดของหน้าข่าวสาร', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await newsStage(r);
          await r.go('/news', 1200);
          const qc = p.locator('article').filter({ hasText: NEWS_QC });
          await qc.getByRole('button', { name: 'ตัวเลือกข่าว' }).click(); await r.settle(300);
          await r.shot({ title: 'กด ⋯ แล้ว “ปักหมุดไว้บนสุด”', text: 'Master / Admin ปักหมุดข่าวได้ (ของใครก็ได้): กด **⋯** ที่ข่าว แล้วเลือก **ปักหมุดไว้บนสุด** · ข่าวที่ปักหมุดอยู่แล้วจะเป็น **เลิกปักหมุด**', marks: [{ el: p.getByRole('menuitem', { name: 'ปักหมุดไว้บนสุด' }).or(p.getByText('ปักหมุดไว้บนสุด')).last(), label: 'ปักหมุด', place: 'left' }] });
          await p.getByText('ปักหมุดไว้บนสุด').last().click(); await r.settle(1000);
          await r.shot({ title: 'ข่าวขึ้นไปอยู่บนสุด', text: 'ข่าวที่ปักหมุดมีป้าย **ปักหมุด** และกรอบสีน้ำเงิน เรียงอยู่บนสุดเสมอ (ปักหลายข่าวได้ ข่าวใหม่กว่าอยู่บน)\nตอนโพสต์ข่าว Master / Admin เปิดสวิตช์ **ปักหมุดไว้บนสุด** ได้เลย', marks: [{ el: p.locator('article').filter({ hasText: NEWS_QC }).getByText('ปักหมุด', { exact: true }), label: 'ปักหมุดแล้ว', place: 'left' }] });
          await r.call('POST', `/news/${(await r.call('GET', '/news?pageSize=50')).items.find((x) => x.title === NEWS_QC).id}/pin`, { pinned: false });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'tags', title: 'Tag (กลุ่มผู้ใช้)', icon: 'tags', description: 'ดู Tag ของตัวเอง ขอ Tag อนุมัติคำขอ และกำหนด Tag ให้ผู้ใช้',
    guides: [
      {
        id: 'tag-request', title: 'ขอ Tag (ขอเข้ากลุ่ม)', summary: 'ดู Tag ของตัวเอง แล้วส่งคำขอถึง Admin / Master ที่เลือก', as: 'user',
        run: async (r) => {
          const p = r.page;
          await tagRequestReset(r);
          await r.go('/settings?tab=profile', 1200);
          const mine = p.locator('div.ds-card').filter({ hasText: 'Tag ของฉัน' }).first();
          await mine.scrollIntoViewIfNeeded();
          await r.shot({ title: 'ดู Tag ของฉัน', text: 'กดชื่อของคุณมุมขวาบน → **โปรไฟล์ของฉัน** ด้านล่างมี **Tag ของฉัน** = กลุ่มที่คุณอยู่ · ทุกคนมี Tag **All** · ได้ Tag แล้วจะเห็นไฟล์ โฟลเดอร์ และข่าวที่แชร์ให้ Tag นั้น\nต้องการเข้ากลุ่มอื่น กด **ขอ Tag** (หรือเมนู **คำขออนุมัติ → คำขอ Tag**)', marks: [{ el: mine, label: 'Tag ที่คุณมี', place: 'above' }, { el: mine.getByRole('link', { name: 'ขอ Tag', exact: true }), label: 'กด ขอ Tag', place: 'left' }] });
          await mine.getByRole('link', { name: 'ขอ Tag', exact: true }).click(); await r.settle(1200);
          const dlg = p.getByRole('dialog');
          const sel = dlg.locator('select');
          await sel.nth(0).selectOption({ label: (await sel.nth(0).locator('option').allInnerTexts()).find((t) => t.startsWith(REQ_TAG)) });
          await sel.nth(1).selectOption({ label: (await sel.nth(1).locator('option').allInnerTexts()).find((t) => t.startsWith('สมชาย ใจดี')) });
          await dlg.locator('textarea').fill('ย้ายมาประจำไลน์ PF1 ตั้งแต่ 16 พ.ย.');
          await r.shot({ title: 'เลือก Tag และผู้อนุมัติ', text: '1. **Tag ที่ต้องการ** — เลือกกลุ่มที่จะขอเข้า\n2. **ส่งคำขอถึง** — เลือก Admin หรือ Master ที่จะอนุมัติ (เช่น หัวหน้าแผนก) คนนั้นจะได้รับแจ้งเตือน\n3. ใส่**เหตุผล** (ไม่บังคับ) แล้วกด **ส่งคำขอ**', marks: [{ el: sel.nth(0), label: 'Tag ที่ต้องการ', place: 'left' }, { el: sel.nth(1), label: 'ผู้อนุมัติ', place: 'left' }, { el: role(dlg, 'button', 'ส่งคำขอ'), label: 'กด ส่งคำขอ', place: 'above' }] });
          await role(dlg, 'button', 'ส่งคำขอ').click(); await r.settle(1000);
          const row = p.locator('div.ds-card').filter({ hasText: 'คำขอของฉัน' }).getByText('รออนุมัติ').first();
          await r.shot({ title: 'ติดตามสถานะคำขอ', text: 'คำขออยู่ที่เมนู **คำขออนุมัติ → คำขอ Tag** ใน **คำขอของฉัน** สถานะ **รออนุมัติ** · เมื่อผู้อนุมัติกดอนุมัติ คุณจะได้แจ้งเตือนและ Tag ขึ้นใน **Tag ของฉัน** ทันที · กด **ยกเลิก** ถ้าไม่ต้องการแล้ว', marks: [{ el: row, label: 'สถานะคำขอ', place: 'left' }] });
        },
      },
      {
        id: 'tag-approve', title: 'อนุมัติคำขอ Tag', summary: 'ตรวจคำขอที่ส่งถึงคุณ แล้วอนุมัติหรือไม่อนุมัติ', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          const { t, users } = await tagRequestReset(r);
          const master = users.find((u) => u.username === 'master');
          await r.callAs('user', 'POST', '/tag-requests', { tagId: t.id, approverId: master.id, note: 'ย้ายมาประจำไลน์ PF1 ตั้งแต่ 16 พ.ย.' });
          await r.go('/', 1200);
          await r.shot({ title: 'มีคำขอส่งถึงคุณ', text: 'เมื่อมีคนขอ Tag และเลือกส่งถึงคุณ จะมี**แจ้งเตือน**ที่กระดิ่ง และตัวเลขที่เมนู **คำขออนุมัติ** — กดเมนูนี้', marks: [{ el: sidebar(p, 'คำขออนุมัติ'), label: 'คำขอที่รอคุณ', place: 'right' }] });
          await sidebar(p, 'คำขออนุมัติ').click(); await r.settle(800);
          await p.getByRole('button', { name: /คำขอ Tag/ }).click(); await r.settle(900);
          const item = p.locator('div.ds-card div.divide-y > div').filter({ hasText: REQ_TAG }).first();
          await r.shot({ title: 'แท็บ “คำขอ Tag” → รอฉันอนุมัติ', text: 'แต่ละรายการบอก**ใคร**ขอ Tag **อะไร** และเหตุผล\n• **อนุมัติ** = ใส่ Tag ให้ผู้ใช้ทันที\n• **ไม่อนุมัติ** = ใส่เหตุผลให้ผู้ขอเห็น', marks: [{ el: role(item, 'button', 'อนุมัติ', { exact: true }), label: 'อนุมัติ', place: 'left' }, { el: role(item, 'button', 'ไม่อนุมัติ'), label: 'ไม่อนุมัติ', place: 'below' }] });
          await role(item, 'button', 'อนุมัติ', { exact: true }).click(); await r.settle(1000);
          await p.getByRole('button', { name: 'ทุกสถานะ' }).click(); await r.settle(800);
          await r.shot({ title: 'อนุมัติแล้ว', text: 'ผู้ขอได้รับแจ้งเตือน และ Tag ขึ้นที่ **Tag ของฉัน** ของเขาทันที · เลือก **ทุกสถานะ** เพื่อดูคำขอที่พิจารณาแล้ว\nAdmin เลือก **ทั้งหมด (Admin)** เพื่อพิจารณาคำขอที่ส่งถึงคนอื่นแทนได้ (เช่น ผู้อนุมัติลา)', marks: [{ el: p.getByText('อนุมัติแล้ว', { exact: true }).first(), label: 'สถานะ', place: 'left' }] });
        },
      },
      {
        id: 'tag-manage', title: 'สร้าง Tag และกำหนด Tag ให้ผู้ใช้ (Master)', summary: 'Master / Admin สร้าง Tag ใส่หรือเอาผู้ใช้ออกจาก Tag', as: 'master', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await tagWith(r, 'QC', '#E11D48', ['user', 'master'], 'ฝ่ายควบคุมคุณภาพ');
          await r.go('/requests?tab=tags&box=manage', 1200);
          const allCard = p.locator('div.ds-card').filter({ hasText: 'Tag ของระบบ' }).first();
          await r.shot({ title: 'แท็บ “จัดการ Tag”', text: 'เมนู **คำขออนุมัติ → คำขอ Tag → จัดการ Tag** (Master และ Admin; Admin ใช้ จัดการผู้ใช้ → Tag ได้ด้วย) · กด **สร้าง Tag** เพื่อสร้างกลุ่มใหม่ เช่น แผนก ไลน์ผลิต กะ\nTag **All** เป็น Tag ของระบบ = ทุกคน (เปลี่ยนชื่อ ลบ หรือใส่สมาชิกไม่ได้)', marks: [{ el: role(p, 'button', 'สร้าง Tag').first(), label: 'สร้าง Tag', place: 'left' }, { el: allCard, label: 'Tag All = ทุกคน', place: 'below' }] });
          const card = p.locator('div.ds-card').filter({ has: p.getByText('QC', { exact: true }) }).filter({ has: p.getByRole('button', { name: 'สมาชิก', exact: true }) }).first();
          await card.getByRole('button', { name: 'สมาชิก', exact: true }).click(); await r.settle(900);
          const m = p.getByRole('dialog');
          await r.shot({ title: 'กำหนดสมาชิกของ Tag', text: 'กด **สมาชิก** ที่การ์ด Tag → ค้นหาชื่อแล้วกดเลือกเพื่อ**เพิ่ม** · กดรูปคนมีขีดเพื่อ**เอาออก** มีผลกับสิทธิ์ไฟล์และข่าวที่แชร์ให้ Tag นี้ทันที', marks: [{ el: m.getByText('ค้นหาผู้ใช้เพื่อเพิ่มเข้า Tag…'), label: 'ค้นหาเพื่อเพิ่ม', place: 'below' }] });
          await role(m, 'button', 'ปิด').last().click(); await r.settle(300);
          r.note({ title: 'ใครทำอะไรได้', text: '• **Master / Admin**: สร้าง แก้ไข Tag และกำหนดสมาชิก · อนุมัติคำขอ Tag\n• **Admin**: ลบ Tag ได้ด้วย (ลบแล้วสิทธิ์ที่แชร์ให้ Tag นั้นหายทั้งหมด)\n• **User / Viewer**: ขอ Tag ได้ที่ โปรไฟล์ของฉัน หรือ คำขออนุมัติ → คำขอ Tag → ขอ Tag' });
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
      {
        id: 'qh-incoming', title: 'Quality Highlight Incoming: ค้นหาจาก Material', summary: 'เก็บ Description และรูปของวัตถุดิบรับเข้า แล้วค้นจากแดชบอร์ดด้วย Material', as: 'admin',
        run: async (r) => {
          const p = r.page;
          const f = await r.call('GET', `/files/${QI_FILE}`);
          const sheet = f.sheets[0].id;
          const sh = await r.call('GET', `/sheets/${sheet}`);
          const col = (n) => (sh.columns ?? []).find((c) => c.name === n);
          // demo rows (demo database only) so there is something to find
          const have = await r.call('POST', `/sheets/${sheet}/rows/query`, { page: 1, pageSize: 5 });
          if (!(have.rows ?? []).length) {
            for (const [m, d] of [['MAT-10021', 'ปลาทูน่าแช่แข็ง — ตรวจอุณหภูมิแกนกลาง ≤ -18°C ก่อนรับ · ตรวจกลิ่น/สี ตามคู่มือรับวัตถุดิบ'], ['MAT-20540', 'ถุงบรรจุ PET — ตรวจรอยซีลและพิมพ์ Lot ทุกพาเลท']])
              await r.call('POST', `/sheets/${sheet}/rows`, { values: { [col('Material').id]: m, [col('Description').id]: d } });
          }
          await r.go(`/files/${QI_FILE}`, 1500);
          await r.shot({
            title: 'ไฟล์ Quality Highlight - Incoming',
            text: 'อยู่ที่ **ไฟล์ทั้งหมด → Quality Highlight Report → Data** · คอลัมน์ **Material · Description · รูปภาพ · วันที่ Update ข้อมูล · Update By** (2 ช่องหลังระบบเติมให้เองเมื่อเพิ่ม/แก้แถว)\nเพิ่มข้อมูลด้วย **+ เพิ่มแถว** หรือพิมพ์ในแถว * ล่างสุด (จอคอม) · ใส่รูปได้หลายรูปต่อแถว',
            marks: [{ el: p.locator('thead th').filter({ hasText: 'Material' }).first(), label: 'Material', place: 'below' }, { el: p.locator('thead th').filter({ hasText: 'Description' }).first(), label: 'Description', place: 'below' }],
          });
          await r.go(`/files/${QI_FILE}/dashboards/${QI_DASH}`, 1800);
          const search = p.getByPlaceholder(/Material/).first();
          await search.fill('10021'); await r.settle(1500);
          await r.shot({ title: 'แดชบอร์ด: พิมพ์ Material', text: 'เปิดแดชบอร์ด **Quality Highlight Incoming** (เมนู แดชบอร์ด) แล้วพิมพ์ **Material** (บางส่วนก็ได้) → แสดง Description, รูป และผู้แก้ล่าสุด', marks: [{ el: box(search), label: 'พิมพ์ Material', place: 'below' }] });
          await r.note({ title: 'เพิ่มคอลัมน์ได้ แดชบอร์ดแสดงเอง', text: 'ถ้าเพิ่มคอลัมน์ใหม่ในชีต (เช่น Supplier, เกณฑ์รับ) ช่องนั้นจะขึ้นในการ์ดของแดชบอร์ดเองโดยไม่ต้องแก้แดชบอร์ด\n(ตั้งไว้ที่วิดเจ็ต: “แสดงทุกคอลัมน์ที่เหลือ”) · แก้ข้อมูลแล้วออก Rev ได้เหมือน Quality Highlight - Master' });
        },
      },
    ],
  },

  /* ================================================================ */
  {
    id: 'md', title: 'ใบตรวจ Metal Detector (F3QCPF06)', icon: 'shield', description: 'DAILY METAL DETECTOR SENSITIVITY TEST REPORT และตาราง Program / ค่า Sensitivity',
    guides: [
      {
        id: 'md-form', title: 'บันทึกใบตรวจ DAILY METAL DETECTOR', summary: 'สร้างหัวเอกสาร แล้วบันทึกการตรวจแต่ละรอบ (เลือกโปรแกรมได้เฉพาะของเครื่องนั้น)', as: 'user',
        run: async (r) => {
          const p = r.page;
          await mdMembers(r);
          await openMd(r, MD_FILE);
          await r.shot({
            title: 'เปิดไฟล์ใบตรวจ',
            text: 'ไปที่ **ไฟล์ทั้งหมด → DAILY METAL DETECTOR SENSITIVITY TEST REPORT → Data → DAILY METAL DETECTOR SENSITIVITY TEST REPORT (F3QCPF06)** (คนใน Tag MD กรอกได้ทุกคน)\nชีต **หัวเอกสาร** = 1 แถวต่อใบ (วันที่ กะ เครื่อง …) · ชีต **รายการตรวจ** = การตรวจแต่ละรอบของทุกใบ',
            marks: [{ el: role(p, 'button', 'หัวเอกสาร'), label: '1 แถว = 1 ใบตรวจ', place: 'below' }, { el: role(p, 'button', 'รายการตรวจ'), label: 'รายการตรวจของทุกใบ', place: 'below' }],
          });
          await r.shot({ title: 'กด “+ เพิ่มแถว” เพื่อเริ่มใบใหม่', text: 'อยู่ที่ชีต **หัวเอกสาร** แล้วกด **+ เพิ่มแถว**', marks: [{ el: role(p, 'button', 'เพิ่มแถว'), label: 'กด + เพิ่มแถว', place: 'below' }] });
          await role(p, 'button', 'เพิ่มแถว').click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await ctl(fld(dlg, 'วันที่ (Date)')).fill(new Date().toISOString().slice(0, 10));
          await choose(r, ctl(fld(dlg, 'กะ (Shift)')), 'N/S (กะดึก)');
          await ctl(fld(dlg, 'หมายเลขเครื่อง')).click(); await r.settle(500);
          const m = p.getByText('3GMD2019', { exact: true }).last();
          await r.shot({ title: 'กรอกวันที่ กะ และเลือกหมายเลขเครื่อง', text: 'หัวข้อเหมือนหัวกระดาษ: **วันที่ · กะ · หมายเลขเครื่อง** (รายชื่อเครื่องมาจากตาราง Program) แล้วกรอก ฝาล็อคหน้าจอ · Speed สายพาน · ขนาด/หมายเลข Test piece (Fe / Non Fe / SUS) · Belt stop · Alarm', marks: [{ el: m, label: 'เลือกเครื่อง', place: 'right' }] });
          await m.click(); await r.settle(300);
          await choose(r, ctl(fld(dlg, 'ฝาล็อคหน้าจอ')), 'มีล็อค');
          await ctl(fld(dlg, 'Speed สายพาน (m/min)')).fill('27');
          await ctl(fld(dlg, 'Fe (mm)')).fill('1.5'); await ctl(fld(dlg, 'Fe หมายเลข')).fill('54043');
          await ctl(fld(dlg, 'Non Fe (mm)')).fill('2.5'); await ctl(fld(dlg, 'Non Fe หมายเลข')).fill('12621A');
          await ctl(fld(dlg, 'SUS (mm)')).fill('3.0'); await ctl(fld(dlg, 'SUS หมายเลข')).fill('92841B');
          await choose(r, ctl(fld(dlg, 'Belt stop')), 'OK');
          await choose(r, ctl(fld(dlg, 'Alarm')), 'OK');
          await ctl(fld(dlg, 'พนักงานคุมเครื่อง')).scrollIntoViewIfNeeded();
          await ctl(fld(dlg, 'พนักงานคุมเครื่อง')).click(); await r.settle(500);
          const who = p.getByText('สมหญิง ขยันงาน', { exact: true }).last();
          await r.shot({ title: 'เลือกชื่อพนักงานคุมเครื่อง / ผู้ตรวจ', text: 'ช่อง **พนักงานคุมเครื่อง** และ **Checked By (QC staff)** เลือกได้เฉพาะคนที่มี **Tag MD** (Admin กำหนดที่ จัดการผู้ใช้ → Tag) · พิมพ์ชื่อเพื่อค้นหาได้', marks: [{ el: who, label: 'เลือกชื่อจากรายการ', place: 'right' }] });
          await who.click(); await r.settle(300);
          const save = role(dlg, 'button', 'เพิ่มแถว');
          await r.shot({ title: 'กด “เพิ่มแถว” เพื่อบันทึกหัวเอกสาร', text: 'ระบบออก **เลขที่ใบตรวจ** ให้เอง (เช่น MD-260923-001) แล้วเปิดหน้าต่าง **รายการ** ของใบนี้ให้ต่อทันที', marks: [{ el: save, label: 'กด เพิ่มแถว', place: 'above' }] });
          await save.click(); await r.settle(1500);
          const ld = p.getByRole('dialog');
          await r.shot({ title: 'หน้าต่างรายการตรวจของใบนี้', text: 'กด **+ เพิ่มรายการ** ทุกครั้งที่ตรวจ (เริ่มงาน / ทุกชั่วโมง / เปลี่ยนโปรแกรม / เลิกงาน)', marks: [{ el: role(ld, 'button', 'เพิ่มรายการ'), label: 'กด + เพิ่มรายการ', place: 'below' }] });
          await role(ld, 'button', 'เพิ่มรายการ').click(); await r.settle();
          const f = p.getByRole('dialog');
          await r.shot({ title: 'วันที่ กะ และเครื่อง เติมให้เอง', text: 'ช่องที่ชื่อเหมือนหัวเอกสาร (**วันที่ · กะ · หมายเลขเครื่อง**) ระบบเติมจากหัวเอกสารให้ ไม่ต้องกรอกซ้ำ', marks: [{ el: ctl(fld(f, 'หมายเลขเครื่อง')), label: 'เติมจากหัวเอกสาร', place: 'right' }] });
          await ctl(fld(f, 'เวลา')).fill('19.50');
          for (const n of ['Fe', 'Non Fe', 'SUS']) { await ctl(fld(f, n)).click(); await r.settle(250); await p.getByRole('button', { name: '✓', exact: true }).last().click(); await r.settle(150); }
          await r.shot({
            title: 'บันทึกเวลาและผลทดสอบ',
            text: 'พิมพ์**เวลา** (เช่น 19.50) แล้วเลือกผลของวัตถุมาตรฐาน Fe / Non Fe / SUS / Large test piece:\n**✓** = ผลผ่าน · **x** = ผลไม่ผ่าน · **-** = ไม่พบปัญหา · **∙** = ไม่ตรงกับรอบการตรวจ',
            marks: [{ el: ctl(fld(f, 'เวลา')), label: 'เวลา', place: 'right' }, { el: ctl(fld(f, 'Fe')), label: 'เลือก ✓ x - ∙', place: 'right' }],
          });
          const fq = fld(f, 'ความถี่ (F)');
          await fq.scrollIntoViewIfNeeded();
          await fq.getByText('F0 Sensitivity test', { exact: true }).click().catch(() => undefined);
          await fq.getByText('F2 เริ่มงาน', { exact: true }).click().catch(() => undefined);
          await r.shot({ title: 'เลือกความถี่ (F) — เลือกได้หลายข้อ', text: 'แตะเลือกได้หลายข้อในช่องเดียว เช่น F0 + F2\nF0 Sensitivity test · F1 Memory test · F2 เริ่มงาน · F3 ทดสอบทุกชั่วโมง · F4 หยุดเครื่องชั่วคราว · F5 เปลี่ยนโปรแกรม · F6 เครื่องเสีย · F7 เลิกงาน', marks: [{ el: fq, label: 'แตะเลือกได้หลายข้อ', place: 'above' }] });
          await ctl(fld(f, 'โปรแกรม / Sensitivity')).click(); await r.settle(800);
          const prog = p.getByText('038 Chunk PET-01 (Fe 3.5 / SUS 6.0)', { exact: true }).last();
          await r.shot({ title: 'เลือกโปรแกรม / Sensitivity', text: 'รายการแสดง**เฉพาะโปรแกรมของเครื่องที่เลือก** พร้อมค่าที่ควบคุม (Fe / SUS หรือ ML1-ML4) มาจากตาราง Program และค่า Sensitivity', marks: [{ el: prog, label: 'โปรแกรม + ค่า Fe / SUS', place: 'right' }] });
          await prog.click(); await r.settle(300);
          await ctl(fld(f, 'Code / วัตถุดิบ / Batch no.')).fill('Chunk C11201G9JN');
          await ctl(fld(f, 'Checked By')).scrollIntoViewIfNeeded();
          await choose(r, ctl(fld(f, 'Checked By')), 'สมหญิง ขยันงาน');
          const saveLine = role(f, 'button', 'เพิ่มแถว');
          await r.shot({ title: 'ช่องผลการตรวจจับวัตถุดิบ แล้วบันทึก', text: 'Result / รอบ A / Object / รอบ B / สรุปผล ตั้งต้นเป็น **-** (ไม่พบปัญหา) เปลี่ยนเมื่อเครื่องตรวจจับโลหะ · กรอก Code / Batch, MD Detect (NG), Checked By แล้วกด **เพิ่มแถว**', tip: 'ติ๊ก **เพิ่มต่ออีกแถว** ถ้าจะบันทึกหลายรายการติดกัน', marks: [{ el: saveLine, label: 'กด เพิ่มแถว', place: 'above' }] });
          await saveLine.click(); await r.settle(1500);
          await r.shot({ title: 'รายการอยู่ในใบตรวจแล้ว', text: 'รายการแสดงในหน้าต่างของใบนี้ · แตะที่รายการเพื่อแก้ไข · รูปถังขยะเพื่อลบ\nเปิดใบเดิมภายหลัง: ชีต **หัวเอกสาร** → กดรูป**ตา**หน้าแถว → **รายการในแถว**', marks: [{ el: p.getByRole('dialog').locator('tbody tr').first(), label: 'รายการที่บันทึก', place: 'below' }] });
          await p.getByRole('dialog').getByRole('button', { name: 'ปิด' }).first().click(); await r.settle(800);
          const docRow = p.locator('tbody tr').filter({ hasText: /\d+ รายการ/ }).last();
          await r.shot({ title: 'คอลัมน์ “รายการตรวจ” หน้าเลขแถว', text: 'ชีต **หัวเอกสาร** มีคอลัมน์ **รายการตรวจ** บอกว่าใบนี้มีกี่รายการ กดเพื่อเปิดรายการของใบนั้น (ใบที่ยังไม่มีรายการขึ้น **เพิ่มรายการ**)', marks: [{ el: docRow.getByRole('button', { name: /รายการ/ }).first(), label: 'จำนวนรายการของใบนี้', place: 'right' }] });
          await docRow.locator('td').nth(2).click(); await r.settle(300);
          await role(p, 'button', 'ส่งออก').click(); await r.settle(400);
          const pdfItem = p.getByRole('menuitem', { name: /PDF — ใบตรวจ F3QCPF06/ }).first();
          await r.shot({ title: 'พิมพ์ใบตรวจเป็น PDF', text: 'คลิกแถวของใบที่ต้องการ (เลือกหลายใบได้ ใบละหน้า) แล้วกด **ส่งออก → PDF — ใบตรวจ F3QCPF06 (แบบฟอร์ม Excel A4 แนวตั้ง)** · หน้าตาเหมือนแบบฟอร์ม Excel: หัวกระดาษ · ตาราง 33 บรรทัด (มีเฉพาะ**รายการของใบนั้น**) · หมายเหตุ · ผู้ลงชื่อ', marks: [{ el: pdfItem, label: 'PDF ใบตรวจ', place: 'left' }] });
          await p.keyboard.press('Escape'); await r.settle(300);
          await role(p, 'button', 'รายการตรวจ').click(); await r.settle(1200);
          await r.shot({ title: 'ชีตรายการตรวจบอกว่าเป็นของใบไหน', text: 'ชีต **รายการตรวจ** มีคอลัมน์ **หัวเอกสาร** บอกเลขที่ใบตรวจของแต่ละรายการ กดเพื่อไปที่ใบนั้น', marks: [{ el: p.locator('tbody tr').first().getByRole('button').filter({ hasText: /MD-/ }).first(), label: 'ใบตรวจของรายการนี้', place: 'right' }] });
        },
      },
      {
        id: 'md-problem', title: 'บันทึกปัญหาเครื่อง MD และดูสรุป (MD Record Problem)', summary: 'บันทึกการแก้ไขเครื่อง (F3QCPP28) เลือกจาก Dropdown · แดชบอร์ด Pareto / Pie / รายวัน กรองได้ทุกอย่าง', as: 'admin',
        run: async (r) => {
          const p = r.page;
          await r.go(`/files/${MDP_FILE}`, 1500);
          await r.shot({
            title: 'ไฟล์บันทึกการแก้ไขเครื่อง Metal Detector',
            text: 'อยู่ที่ **ไฟล์ทั้งหมด → DAILY METAL DETECTOR SENSITIVITY TEST REPORT → MD Record Problem** · 1 แถว = 1 ปัญหา\n**กะ · MD Type · MD No. · กลุ่มปัญหา** เลือกจาก Dropdown (เพิ่มตัวเลือกได้ที่ ตั้งค่าคอลัมน์) · เพิ่มด้วย **+ เพิ่มแถว** หรือพิมพ์ในแถว * ล่างสุด',
            marks: [{ el: p.locator('thead th').filter({ hasText: 'กลุ่มปัญหา' }).first(), label: 'เลือกจาก Dropdown', place: 'below' }],
          });
          await r.go(`/files/${MDP_FILE}/dashboards/${MDP_DASH}`, 3000);
          await r.shot({
            title: 'แดชบอร์ด MD Record Problem',
            text: 'แถวบนคือ**ตัวกรอง**: ช่วงวันที่ · กะ · MD Type · MD No. · กลุ่มปัญหา · ผู้บันทึก · ผู้ตรวจสอบ — ทุกกราฟด้านล่างเปลี่ยนตามทันที\nPareto บอกว่า**เครื่องไหน / กลุ่มปัญหาไหน / กะไหน** เกิดปัญหามากที่สุด (เส้นแดง = % สะสม, เส้นประ 80%) · Pie = สัดส่วน',
            marks: [{ el: p.getByRole('button', { name: 'DS', exact: true }).first(), label: 'แตะเพื่อกรอง', place: 'below' }],
          });
          const tbl = p.locator('table').filter({ hasText: 'MD No.' }).first();
          await tbl.scrollIntoViewIfNeeded();
          await tbl.locator('th', { hasText: 'MD ดักตัวเอง' }).click(); await r.settle(300);
          await r.shot({
            title: 'กราฟรายเดือน / รายปี / รายวัน และตารางที่เรียงได้',
            text: 'มีกราฟจำนวนปัญหา**รายเดือน** (แยกสีตามกลุ่มปัญหา) **รายปี** และ**ต่อวัน** · ตารางสรุป**คลิกหัวคอลัมน์เพื่อเรียง** (คลิกซ้ำ = กลับด้าน) มีแถวรวมท้ายตาราง\nล่างสุดคือ**รายละเอียดทุกปัญหา** ค้นหาได้ทุกช่อง (เครื่อง ชื่อ Code …)',
            marks: [{ el: tbl.locator('th', { hasText: 'MD ดักตัวเอง' }), label: 'คลิกเพื่อเรียง', place: 'below' }],
          });
        },
      },
      {
        id: 'md-program', title: 'แก้ไขตาราง Program และค่า Sensitivity', summary: 'ค่าที่แก้จะขึ้นในตัวเลือกของใบตรวจให้เอง', as: 'admin', roles: ['master', 'admin'],
        run: async (r) => {
          const p = r.page;
          await openMd(r, MD_PROG);
          await r.shot({
            title: 'ไฟล์ Program และค่า Sensitivity',
            text: 'มี 3 ชีต: **โรงผลิต Petfood** และ **โรงผลิต Petfood 2** (1 แถว = 1 โปรแกรมของ 1 เครื่อง) และ **รวมทุกโรงผลิต** (รวม 2 ชีตแรกให้เอง ใช้เป็นตัวเลือกของใบตรวจ แก้ที่ชีตนี้ไม่ได้)',
            marks: [{ el: p.getByRole('button', { name: /โรงผลิต Petfood$/ }).first(), label: 'Petfood', place: 'below' }, { el: p.getByRole('button', { name: /รวมทุกโรงผลิต/ }).first(), label: 'รวมให้เอง (อ่านอย่างเดียว)', place: 'below' }],
          });
          const cell = p.locator('tbody tr').first().locator('td').nth(7);
          await r.shot({ title: 'แก้ค่า Fe / SUS / ML ในชีตของโรงผลิต', text: 'ดับเบิลคลิกช่องที่จะแก้ พิมพ์ค่าใหม่แล้วกด Enter · เพิ่มโปรแกรมใหม่ด้วย **+ เพิ่มแถว** (กรอกหมายเลขเครื่อง Program No. ชื่อ และค่า)', marks: [{ el: cell, label: 'ดับเบิลคลิกเพื่อแก้' }] });
          await r.shot({ title: 'คอลัมน์ “โปรแกรม / Sensitivity” สร้างเอง', text: 'คอลัมน์สุดท้ายรวม **Program No. + Name + ค่า** ให้เอง (เช่น 001 Chunk (Fe 5.2 / SUS 5.6)) ข้อความนี้คือสิ่งที่ขึ้นในตัวเลือกของใบตรวจ · ชีตรวมอัปเดตตามภายใน 1 นาที', marks: [{ el: p.locator('th').filter({ hasText: 'โปรแกรม / Sensitivity' }).first(), label: 'สร้างจากสูตร (แก้เองไม่ได้)', place: 'below' }] });
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
    id: 'admin', title: 'ผู้ดูแลระบบ (Admin)', icon: 'shield', description: 'จัดการผู้ใช้ อนุมัติบัญชีใหม่ Tag และจัดการสิทธิ์ (Root)', roles: ['admin'],
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
          await r.shot({ title: 'กรอกข้อมูลบัญชี', text: 'กรอก**ชื่อที่แสดง ชื่อผู้ใช้** และ**รหัสผ่านเริ่มต้น** (แจ้งพนักงานให้เปลี่ยนเองภายหลัง) · **อีเมลไม่บังคับ** ไม่มีเว้นว่างได้', marks: [{ el: ins.nth(1), label: 'ชื่อผู้ใช้สำหรับเข้าสู่ระบบ', place: 'left' }, { el: ins.nth(3), label: 'รหัสผ่านเริ่มต้น', place: 'left' }] });
          await r.shot({ title: 'เลือกบทบาทและ Tag แล้วกด “สร้างผู้ใช้”', text: 'เลือก**บทบาท** (คำอธิบายใต้ช่องบอกว่าทำอะไรได้) และแตะ **Tag** ที่ต้องการ (เลือกได้หลาย Tag) แล้วกด **สร้างผู้ใช้**', marks: [{ el: dlg.locator('select').first(), label: 'บทบาท', place: 'left' }, { el: role(dlg, 'button', 'สร้างผู้ใช้'), label: 'กด สร้างผู้ใช้', place: 'above' }] });
          // (a re-run: the example account is already there — close the form and use it)
          const exists = (await r.call('GET', '/users?pageSize=100&search=prasert')).items.some((u) => u.username === 'prasert');
          if (exists) { await role(dlg, 'button', 'ยกเลิก').click(); await r.settle(300); await p.getByPlaceholder('ค้นหาชื่อ ชื่อผู้ใช้ หรืออีเมล').fill('prasert'); await r.settle(900); }
          else { await role(dlg, 'button', 'สร้างผู้ใช้').click(); await r.settle(1000); }
          const row = p.locator('tr').filter({ hasText: '@prasert' });
          await row.getByRole('button', { name: 'ตัวเลือก' }).click(); await r.settle(300);
          await r.shot({ title: 'แก้ไข / รีเซ็ตรหัสผ่าน / ปิดการใช้งาน', text: 'กดปุ่ม **⋯** ท้ายแถวผู้ใช้:\n• **แก้ไข** ชื่อ ชื่อผู้ใช้ อีเมล บทบาท Tag\n• **รีเซ็ตรหัสผ่าน** เมื่อพนักงานลืมรหัสผ่าน\n• **ปิดการใช้งาน** เมื่อพนักงานลาออก (เข้าสู่ระบบไม่ได้ทันที)', marks: [{ el: p.locator('[role="menu"]').last(), label: 'คำสั่งของผู้ใช้', place: 'left' }] });
        },
      },
      {
        id: 'admin-user-tags', title: 'ใส่ Tag ให้ผู้ใช้แต่ละคน', summary: 'กด + Tag ที่แถวผู้ใช้ แล้วแตะ Tag เพื่อใส่หรือเอาออก', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await tagWith(r, 'QC', '#E11D48', ['user', 'master'], 'ฝ่ายควบคุมคุณภาพ');
          await r.go('/users', 1200);
          const row = p.locator('tr').filter({ hasText: '@master' }).first();
          const plus = row.getByRole('button', { name: /^Tag ของ/ });
          await r.shot({ title: 'กด “+ Tag” ที่แถวผู้ใช้', text: 'หน้า **จัดการผู้ใช้** ใต้ชื่อแต่ละคนมี Tag ที่มีอยู่ และปุ่ม **+ Tag** กดปุ่มนี้ที่คนที่ต้องการ', marks: [{ el: plus, label: 'กด + Tag', place: 'right' }] });
          await plus.click(); await r.settle(400);
          const pop = p.locator('div').filter({ hasText: /^Tag ของ/ }).last();
          await r.shot({ title: 'แตะ Tag เพื่อใส่ / เอาออก', text: 'Tag ที่มีเครื่องหมาย ✓ = ผู้ใช้อยู่ใน Tag นั้น · แตะเพื่อใส่หรือเอาออก **บันทึกทันที** ไม่ต้องกดปุ่มบันทึก\nทำได้อีก 2 ทาง: ปุ่ม ⋯ → **แก้ไข** ผู้ใช้ หรือ **คำขออนุมัติ → คำขอ Tag → จัดการ Tag → สมาชิก**', marks: [{ el: pop, label: 'แตะเพื่อเปิด / ปิด', place: 'right' }] });
          await p.keyboard.press('Escape');
        },
      },
      {
        id: 'admin-requests', title: 'อนุมัติคำขอสร้างบัญชี', summary: 'ตรวจคำขอบัญชีใหม่ กำหนดระดับจริง และใส่ Tag', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          // the example request (the same one as in "ขอสร้างบัญชี"); this guide stops before creating the account so it can run again
          if (!(await r.call('GET', '/account-requests?status=pending')).some((q) => q.username === 'manop'))
            await r.signup({ displayName: 'มานพ ตั้งใจ', username: 'manop', password: 'Manop2026!', requestedRole: 'user', note: 'QC ไลน์ PF1 บันทึกผลตรวจประจำวัน' });
          await r.go('/', 900);
          await r.shot({ title: 'เมนู “คำขออนุมัติ”', text: 'เมื่อมีคนขอบัญชี Admin ได้รับการแจ้งเตือน และมีตัวเลขที่เมนู **คำขออนุมัติ** · กดเมนูนี้', marks: [{ el: sidebar(p, 'คำขออนุมัติ'), label: 'กด คำขออนุมัติ', place: 'right' }] });
          await sidebar(p, 'คำขออนุมัติ').click(); await r.settle(900);
          await r.shot({ title: 'แท็บ “คำขอสร้างบัญชี”', text: 'กดแท็บ **คำขอสร้างบัญชี** (ยังเปิดจาก จัดการผู้ใช้ → คำขอสร้างบัญชี ได้เหมือนเดิม)', marks: [{ el: p.getByRole('button', { name: /คำขอสร้างบัญชี/ }), label: 'กดแท็บ คำขอสร้างบัญชี', place: 'below' }] });
          await p.getByRole('button', { name: /คำขอสร้างบัญชี/ }).click(); await r.settle(900);
          const approve = role(p, 'button', 'อนุมัติ', { exact: true }).first();
          await r.shot({ title: 'ดูรายละเอียดคำขอ', text: 'เห็นชื่อ อีเมล (ถ้ามี) ชื่อผู้ใช้ (หรือป้าย Microsoft) **ระดับที่ขอ** และแผนก/เหตุผล · กด **อนุมัติ** หรือ **ปฏิเสธ**', marks: [{ el: p.getByText('ขอระดับ').first(), label: 'ระดับที่ผู้ใช้ขอ' }, { el: approve, label: 'กด อนุมัติ', place: 'left' }] });
          await approve.click(); await r.settle();
          const dlg = p.getByRole('dialog');
          await r.shot({ title: 'กำหนดระดับจริงและ Tag', text: 'ช่อง **ระดับที่ให้** ตั้งต้นตามที่ขอ เปลี่ยนได้ตามความเหมาะสม · แตะ Tag เพื่อใส่ผู้ใช้เข้ากลุ่มทันที · กด **อนุมัติและสร้างบัญชี**', marks: [{ el: dlg.locator('select').first(), label: 'ระดับที่ให้จริง', place: 'left' }, { el: role(dlg, 'button', 'อนุมัติและสร้างบัญชี'), label: 'กด อนุมัติและสร้างบัญชี', place: 'above' }] });
          await role(dlg, 'button', 'ยกเลิก').click(); await r.settle(300); // (demo: the request stays for the next run)
          await r.note({ title: 'ผู้ขอเข้าใช้งานได้ทันที', text: 'บัญชีถูกสร้างแล้ว ผู้ขอเข้าสู่ระบบด้วยชื่อผู้ใช้/รหัสผ่านที่ตั้งตอนขอ (หรือปุ่ม Microsoft) · คำขอที่อนุมัติ/ปฏิเสธแล้วดูได้ในตัวเลือก **ทั้งหมด**' });
        },
      },
      {
        id: 'admin-tags', title: 'จัดการ Tag', summary: 'สร้าง Tag แล้วใส่ผู้ใช้เข้ากลุ่ม เพื่อแชร์ไฟล์ให้ทั้งกลุ่ม', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          for (const t of await r.call('GET', '/tags')) if (t.name === 'กะดึก') await r.call('DELETE', `/tags/${t.id}`); // a re-run starts clean
          await r.go('/users/tags', 900);
          await r.shot({ title: 'แท็บ “Tag” แล้วกด “สร้าง Tag”', text: 'ไปที่ **จัดการผู้ใช้ → Tag** (หรือ **คำขออนุมัติ → คำขอ Tag → จัดการ Tag** ซึ่ง Master ใช้ได้ด้วย) แล้วกด **สร้าง Tag**', marks: [{ el: role(p, 'button', 'สร้าง Tag').first(), label: 'กด สร้าง Tag', place: 'left' }] });
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
        id: 'admin-app-name', title: 'เปลี่ยนชื่อระบบ (ชื่อบนเมนูและไอคอนมือถือ)', summary: 'ตั้งชื่อที่แสดงที่เมนูด้านซ้าย หน้าเข้าสู่ระบบ และใต้ไอคอนบนมือถือ', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/settings?tab=system', 1000);
          const input = p.getByPlaceholder('Quality');
          await r.shot({ title: 'ตั้งค่า → ชื่อระบบ', text: 'เมนู **ตั้งค่า** → แท็บ **ชื่อระบบ** (เห็นเฉพาะ Admin / Root) พิมพ์ชื่อที่ต้องการ แล้วกด **บันทึกชื่อระบบ**\nชื่อนี้แสดงที่ **มุมบนของเมนูด้านซ้าย**, หน้าเข้าสู่ระบบ, แท็บของ browser และ**ชื่อใต้ไอคอน**ตอนเพิ่มไว้บนหน้าจอมือถือ', marks: [{ el: box(input), label: 'ชื่อระบบ', place: 'right' }, { el: sidebar(p, 'หน้าแรก').locator('xpath=ancestor::aside//a[1]').first(), label: 'แสดงตรงนี้', place: 'right' }] });
          r.note({ title: 'ไอคอนที่ติดตั้งไว้แล้ว', text: 'มือถือที่เพิ่มไอคอนไว้ก่อนเปลี่ยนชื่อ จะยังแสดงชื่อเดิมใต้ไอคอน — ลบไอคอนแล้วเพิ่มใหม่ (ดูเรื่อง “เพิ่มไอคอน Quality บนหน้าจอมือถือ”) จึงจะได้ชื่อใหม่' });
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
      {
        id: 'root-permissions', title: 'จัดการสิทธิ์ว่าบทบาทไหนเห็นหน้าไหน (Root)', summary: 'บัญชี Root กำหนดเมนูด้านซ้ายและปุ่ม AI ของแต่ละบทบาท', as: 'root', roles: ['root'],
        run: async (r) => {
          const p = r.page;
          r.note({ title: 'เข้าสู่ระบบด้วยบัญชี Root (ครั้งแรก)', text: 'ระบบสร้างบัญชี **root** ให้เองครั้งแรกที่ server เปิดด้วยเวอร์ชันนี้\n• ชื่อผู้ใช้: **root**\n• รหัสผ่าน: **Root@** ตามด้วยวันที่วันนั้นตามเวลาไทยแบบ **วันเดือนปี ค.ศ. 8 หลัก** เช่น ติดตั้งวันที่ 11 พ.ย. 2026 → **Root@11112026**\nเข้าแล้ว**เปลี่ยนรหัสผ่านทันที** ที่ ตั้งค่า → เปลี่ยนรหัสผ่าน (ดูเรื่อง “เปลี่ยนรหัสผ่าน”)', tip: 'Root ทำได้ทุกอย่างเหมือน Admin · Admin แก้ไข/ปิด/รีเซ็ตรหัสผ่านบัญชี Root ไม่ได้ และให้บทบาท Root ได้เฉพาะ Root' });
          await r.shot({ title: 'กดเมนู “จัดการสิทธิ์”', text: 'เมนู **จัดการสิทธิ์** เห็นเฉพาะบัญชี **Root**', marks: [{ el: sidebar(p, 'จัดการสิทธิ์'), label: 'กด จัดการสิทธิ์', place: 'right' }] });
          await sidebar(p, 'จัดการสิทธิ์').click(); await r.settle(1300);
          await r.shot({ title: 'ตารางสิทธิ์', text: 'แถว = หน้าในเมนูด้านซ้าย · คอลัมน์ = บทบาท · **ช่องติ๊ก** = บทบาทนั้นเห็นเมนูและเปิดหน้านั้นได้\nช่องที่มี**รูปกุญแจ**เปลี่ยนไม่ได้ เช่น **จัดการผู้ใช้** ต้องเป็น Admin ขึ้นไป · **หน้าแรก** และ **ตั้งค่า** ทุกคนต้องเห็น · Root เห็นทุกหน้าเสมอ', marks: [{ el: p.getByRole('checkbox', { name: 'จัดการผู้ใช้ — Master' }), label: 'กุญแจ = เปลี่ยนไม่ได้', place: 'left' }, { el: p.locator('thead').getByText('Root', { exact: true }), label: 'Root เห็นทุกหน้า', place: 'below' }] });
          await p.getByRole('checkbox', { name: 'Monitor — Master' }).click(); await r.settle(300);
          await r.shot({ title: 'ติ๊กเปิด / ปิด แล้วกด “บันทึก”', text: 'ตัวอย่าง: ให้ **Master** เห็นหน้า **Monitor** → ติ๊กช่อง Monitor ในคอลัมน์ Master · ด้านล่างขึ้นแถบ **มีการเปลี่ยนแปลงที่ยังไม่บันทึก** → กด **บันทึก**\nเมนูของผู้ใช้ที่เปิดเว็บอยู่จะเปลี่ยนตามทันทีโดยไม่ต้องออกจากระบบ', marks: [{ el: p.getByRole('checkbox', { name: 'Monitor — Master' }), label: 'ติ๊กเพื่อให้เห็น', place: 'left' }, { el: role(p, 'button', 'บันทึก').first(), label: 'กด บันทึก', place: 'left' }] });
          await p.getByRole('checkbox', { name: 'Monitor — Master' }).click(); await r.settle(300); // (the demo keeps the defaults)
          const ai = p.getByRole('checkbox', { name: /ผู้ช่วย AI.*— User/ });
          await ai.scrollIntoViewIfNeeded();
          await r.shot({ title: 'ปุ่ม AI บนแถบด้านบน', text: 'แถว **ผู้ช่วย AI** กำหนดว่าใครเห็นปุ่ม **AI** ที่แถบด้านบน · ค่าเริ่มต้น: เฉพาะ **Admin** และ **Root** · ติ๊กให้บทบาทอื่นได้ถ้าต้องการ', marks: [{ el: p.getByText('ผู้ช่วย AI (ไอคอน AI บนแถบด้านบน)'), label: 'ปุ่ม AI', place: 'right' }] });
          r.note({ title: 'คืนค่าเริ่มต้น และข้อควรรู้', text: '• **คืนค่าเริ่มต้น** = ตั้งทุกบทบาทกลับเป็นค่าของระบบ (ต้องกดบันทึก)\n• การซ่อนเมนู**ไม่ได้ลบสิทธิ์ไฟล์** — ไฟล์ที่ถูกแชร์ยังเปิดจากลิงก์ได้\n• หน้าที่ถูกปิด ถ้าพิมพ์ที่อยู่เข้าไปตรงๆ ระบบจะพากลับหน้าแรก' });
        },
      },
      {
        id: 'monitor', title: 'ดูการใช้งานระบบ (Monitor)', summary: 'จำนวนการใช้งานผ่าน Cloudflare และในโรงงาน ต่อนาที/ชั่วโมง/วัน/เดือน', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await r.shot({ title: 'กดเมนู “Monitor”', text: 'กดเมนู **Monitor** ทางซ้าย (ค่าเริ่มต้นเห็นเฉพาะ Admin / Root — Root เปิดให้บทบาทอื่นได้ที่ **จัดการสิทธิ์**)', marks: [{ el: sidebar(p, 'Monitor'), label: 'กด Monitor', place: 'right' }] });
          await sidebar(p, 'Monitor').click(); await r.settle(2500);
          await r.shot({
            title: 'ตัวเลขวันนี้',
            text: '• **ผ่าน Cloudflare** = คนที่เปิดจากอินเทอร์เน็ต (ลิงก์ dochub.qcqrxdigital.dpdns.org)\n• **ในโรงงาน (LAN)** = เปิดผ่านเครือข่ายบริษัท\n• **สูงสุดต่อนาที** และ **ผิดพลาด (5xx)** ใช้ดูว่าระบบรับไหวไหม · หน้านี้อัปเดตเองทุก 30 วินาที',
            marks: [{ el: p.getByText('ผ่าน Cloudflare วันนี้'), label: 'ผ่านอินเทอร์เน็ต', place: 'below' }, { el: p.getByText('ผิดพลาด (5xx) วันนี้'), label: 'ข้อผิดพลาด', place: 'below' }],
          });
          const lim = p.getByText('ข้อจำกัดของ Cloudflare ที่ใช้กับระบบนี้');
          await lim.scrollIntoViewIfNeeded();
          await r.shot({ title: 'ข้อจำกัดของ Cloudflare', text: 'ระบบใช้ **Cloudflare Tunnel** (ฟรี) ซึ่ง**ไม่มีโควตาจำนวนครั้งต่อวัน/เดือน** · ตัวเลข 100,000 ครั้ง/วัน เป็นของ Cloudflare Workers ที่ไม่ได้ใช้ (แถบด้านขวาแสดงเทียบให้เห็นภาพเท่านั้น) · ข้อจำกัดจริง: อัปโหลด ≤ 100 MB ต่อครั้ง และต้องตอบภายใน 100 วินาที', marks: [{ el: lim, label: 'อ่านข้อจำกัด', place: 'below' }] });
          r.note({ title: 'ตัวเลขจากฝั่ง Cloudflare (ไม่บังคับ)', text: 'ถ้าต้องการตัวเลขที่ Cloudflare นับเอง: Cloudflare → My Profile → API Tokens → Create Token สิทธิ์ **Zone · Analytics · Read** แล้วใส่ **CF_API_TOKEN** และ **CF_ZONE_ID** (Zone ID อยู่หน้า Overview ของโดเมน) ใน server\\.env แล้ว pm2 restart dochub' });
        },
      },
      {
        id: 'md-tag', title: 'กำหนดคนที่ลงชื่อในใบตรวจ Metal Detector (Tag MD)', summary: 'ใส่ผู้ใช้เข้า Tag MD แล้วชื่อขึ้นในช่อง พนักงานคุมเครื่อง / Checked By', as: 'admin', roles: ['admin'],
        run: async (r) => {
          const p = r.page;
          await r.go('/users/tags', 1000);
          const card = p.locator('div.ds-card').filter({ has: p.getByText('MD', { exact: true }) }).first();
          await r.shot({ title: 'จัดการผู้ใช้ → Tag → การ์ด MD', text: 'Tag **MD** สร้างไว้ให้แล้ว กดปุ่ม **สมาชิก** ที่การ์ด MD', marks: [{ el: card.getByRole('button', { name: 'สมาชิก', exact: true }), label: 'กด สมาชิก', place: 'left' }] });
          await card.getByRole('button', { name: 'สมาชิก', exact: true }).click(); await r.settle();
          await r.shot({ title: 'เพิ่ม / เอาออก', text: 'ค้นหาชื่อแล้วกดเลือกเพื่อเพิ่ม · กดรูปคนมีขีดเพื่อเอาออก — ช่อง **พนักงานคุมเครื่อง**, **Checked By (QC staff)** ในหัวเอกสาร และ **Checked By** ในรายการตรวจ แสดงเฉพาะคนใน Tag นี้ทันที', marks: [{ el: p.getByRole('dialog').getByText('ค้นหาผู้ใช้เพื่อเพิ่มเข้า Tag…'), label: 'ค้นหาเพื่อเพิ่มคน', place: 'below' }] });
          r.note({ title: 'ใช้กับคอลัมน์อื่นได้', text: 'ทำช่องเลือกชื่อผู้ใช้ในไฟล์อื่นได้: ตั้งค่าคอลัมน์ ชนิด **ตัวเลือกเดียว** → **รายชื่อผู้ใช้ในระบบ** → เลือก Tag (หรือผู้ใช้ทุกคน)' });
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
          r.note({ title: 'iPhone (Safari)', text: 'เปิด **https://dochub.qcqrxdigital.dpdns.org** ใน **Safari** → กดปุ่ม**แชร์** (สี่เหลี่ยมมีลูกศรชี้ขึ้น ด้านล่างจอ) → เลื่อนหา **เพิ่มไปยังหน้าจอโฮม** → กด **เพิ่ม**\nจะได้ไอคอนบนหน้าจอ ชื่อตามที่ Admin ตั้งใน **ตั้งค่า → ชื่อระบบ** (ค่าเริ่มต้น **Quality**)' });
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
