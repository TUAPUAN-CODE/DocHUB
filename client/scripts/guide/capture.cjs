#!/usr/bin/env node
/**
 * คู่มือ (หน้า /guide): drives the real app with Playwright, takes a screenshot at every step and records where the
 * buttons to press are, then writes client/public/guide/manifest.json + *.webp. The page draws the boxes, arrows and
 * explanations over the pictures (src/modules/guide/Annotated.tsx). The steps and texts are in guides.cjs.
 *
 *   1. a DocHUB server on an EMPTY database with demo data only — the repository is public, never capture company data:
 *        cd server && set DB_NAME=DocHubGuide && npm run db:reset && npm run db:seed
 *        (start it with SERVE_CLIENT_DIR=../client/dist after `cd client && npm run build`)
 *   2. node scripts/guide/capture.cjs --base http://localhost:4000 [--only login,add-row]
 *      (every guide signs in once; the server allows 30 sign-ins per 15 minutes per address — restart it between full runs)
 *   3. npm run build again (public/guide → dist/guide) and commit
 *
 * Playwright is not a dependency of the app: use a machine where `require('playwright')` works.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium, devices } = require('playwright');
const TOPICS = require('./guides.cjs');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'http://localhost:4000').replace(/\/+$/, '');
const OUT = path.resolve(arg('--out', path.join(__dirname, '../../public/guide')));
const ONLY = (arg('--only', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
let apiToken = null; // one API sign-in for the whole run (the server allows 30 sign-ins per 15 minutes)
const ACCOUNTS = { admin: ['admin', 'Admin@123'], master: ['master', 'Master@123'], user: ['user', 'User@1234'] };

class Run {
  constructor(browser, conv, guide) { this.browser = browser; this.conv = conv; this.guide = guide; this.steps = []; this.api = null; }

  async open(as, device = this.guide.device) {
    if (this.ctx) await this.ctx.close();
    this.ctx = await this.browser.newContext(device === 'phone'
      ? { ...devices['iPhone 13'], deviceScaleFactor: 2, locale: 'th-TH', timezoneId: 'Asia/Bangkok' }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, locale: 'th-TH', timezoneId: 'Asia/Bangkok' });
    this.page = await this.ctx.newPage();
    this.page.setDefaultTimeout(15000);
    if (as) await this.login(as);
    return this.page;
  }

  async login(as) {
    const [u, p] = ACCOUNTS[as];
    await this.page.goto(`${BASE}/login`);
    await this.page.fill('input[autocomplete="username"]', u);
    await this.page.fill('input[autocomplete="current-password"]', p);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL((x) => !x.pathname.startsWith('/login'));
    await this.settle(900);
  }

  async go(p, ms) { await this.page.goto(`${BASE}${p}`); await this.settle(ms); }
  async settle(ms = 700) { await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined); await this.page.waitForTimeout(ms); }

  /** REST call as admin (setting the stage: tags, requests …) */
  async call(method, p, body) {
    if (!apiToken) {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'Admin@123' }) });
      apiToken = (await r.json()).data.accessToken;
    }
    const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${apiToken}` }, body: body && JSON.stringify(body) });
    return (await r.json()).data;
  }

  /** public sign-up request (no account) */
  async signup(b) {
    await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  }

  /** a step without a picture */
  note(s) { this.steps.push({ title: s.title, text: s.text, tip: s.tip }); }

  /** a step with a screenshot; marks: [{ el: Locator, label, place? }] */
  async shot(s) {
    const page = this.page;
    await this.settle(s.wait ?? 450);
    const marks = [];
    for (const m of s.marks ?? []) {
      const el = m.el.first();
      await el.waitFor({ state: 'visible' });
      const vp = page.viewportSize();
      let b = await el.boundingBox();
      if (!b || b.y < 0 || b.y + b.height > vp.height) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(250); b = await el.boundingBox(); }
      if (!b) throw new Error(`mark not found: ${m.label}`);
      marks.push({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), label: m.label, ...(m.place ? { place: m.place } : {}) });
    }
    const vp = page.viewportSize();
    const png = await page.screenshot();
    const webp = await this.conv.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return c.toDataURL('image/webp', 0.8).split(',')[1];
    }, png.toString('base64'));
    const buf = Buffer.from(webp, 'base64');
    const name = `${this.guide.id}-${this.steps.length + 1}-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)}.webp`;
    fs.writeFileSync(path.join(OUT, name), buf);
    this.steps.push({ title: s.title, text: s.text, tip: s.tip, image: name, w: vp.width, h: vp.height, marks });
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const old = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { topics: [] };
  const oldGuides = new Map(old.topics.flatMap((t) => t.guides).map((g) => [g.id, g]));
  // Thai browser: date inputs show dd/mm/yyyy as on the users' machines (needs both --lang and LANG)
  const browser = await chromium.launch({ args: ['--lang=th'], env: { ...process.env, LANG: 'th_TH.UTF-8', LANGUAGE: 'th', LC_ALL: 'th_TH.UTF-8' } });
  const conv = await (await browser.newContext()).newPage();
  const failed = [];
  const topics = [];
  for (const t of TOPICS) {
    const guides = [];
    for (const g of t.guides) {
      if (ONLY.length && !ONLY.includes(g.id)) { if (oldGuides.has(g.id)) guides.push(oldGuides.get(g.id)); continue; }
      const run = new Run(browser, conv, { device: 'desktop', ...g });
      const t0 = Date.now();
      try {
        await run.open('as' in g ? g.as : 'admin');
        await g.run(run);
        guides.push({ id: g.id, title: g.title, summary: g.summary, device: g.device ?? 'desktop', ...(g.roles ? { roles: g.roles } : {}), steps: run.steps });
        console.log(`✓ ${g.id} (${run.steps.length} ขั้นตอน, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      } catch (e) {
        failed.push(g.id);
        console.log(`✗ ${g.id} ที่ขั้นตอน ${run.steps.length + 1}: ${String(e.message).split('\n')[0]}`);
        if (run.page) await run.page.screenshot({ path: path.join(OUT, `_failed-${g.id}.png`) }).catch(() => undefined);
        if (oldGuides.has(g.id)) guides.push(oldGuides.get(g.id));
      } finally {
        if (run.ctx) await run.ctx.close();
      }
    }
    topics.push({ id: t.id, title: t.title, description: t.description, icon: t.icon, ...(t.roles ? { roles: t.roles } : {}), guides });
  }
  await browser.close();
  fs.writeFileSync(manifestPath, JSON.stringify({ generatedAt: new Date().toISOString(), topics }, null, 1));
  // pictures nobody points to any more
  const used = new Set(topics.flatMap((t) => t.guides.flatMap((g) => g.steps.map((s) => s.image).filter(Boolean))));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp') && !used.has(f)) fs.unlinkSync(path.join(OUT, f));
  const size = [...used].reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`\n${used.size} ภาพ · ${(size / 1024 / 1024).toFixed(1)} MB → ${OUT}${failed.length ? `\nไม่สำเร็จ: ${failed.join(', ')} (ภาพหน้าจอตอนผิดพลาด: _failed-*.png)` : ''}`);
  process.exit(failed.length ? 1 : 0);
})();
