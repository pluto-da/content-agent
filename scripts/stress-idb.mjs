#!/usr/bin/env node
/* global indexedDB, document */
/**
 * 1.0 存储治理：IndexedDB 1 GB 媒体压测（沙盒 / 桌面 Chromium 尽力测；低端真机项另行标“待真机”）。
 * 做法：托管 web/dist（hash 路由、无服务端）→ 持久化用户目录 → 首次打开建库 → 写入 N MB 随机（不可压缩）base64 媒体（每条 2 MB）
 *      → 重开页面测首屏（导航开始 → 输入框可见并可输入）× 3 次取中位数；两种情况：有媒体索引（1.0 正常数据）/ 无索引（0.11 旧数据，首屏不得触发重建）
 *      → 再测“我的 → 存储”打开耗时（只读索引）；CPU 降速 4×（CDP 模拟低端机，不等于真机）。
 * 用法：PW_DIR=/path/to/node_modules CHROME=/path/to/chrome-headless-shell node scripts/stress-idb.mjs [--mb 1024] [--out out/stress-idb-1gb.json] [--shots ../shots-v1]
 * 依赖：playwright-core（不进 App 依赖；用 PW_DIR 指定）。不联网、不含任何 Key。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const MBS = Number(arg('mb', '1024'));
const OUT = path.resolve(ROOT, arg('out', 'out/stress-idb-1gb.json'));
const SHOTS = arg('shots', '') ? path.resolve(ROOT, arg('shots', '')) : '';
const CPU = Number(arg('cpu', '4'));
const req = createRequire(process.env.PW_DIR ? path.join(process.env.PW_DIR, 'x.js') : import.meta.url);
let chromium;
try { ({ chromium } = req('playwright-core')); } catch { try { ({ chromium } = req('playwright')); } catch { console.error('需要 playwright-core：PW_DIR=<含 playwright-core 的 node_modules>'); process.exit(2); } }

const DIST = path.join(ROOT, 'web/dist');
if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('先 npm run build -w web'); process.exit(2); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const srv = http.createServer((q, s) => {
  const u = decodeURIComponent((q.url ?? '/').split('?')[0]);
  if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); }
  let f = path.join(DIST, u === '/' ? 'index.html' : u);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html');
  s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-stress-'));
const ctx = await chromium.launchPersistentContext(userDir, { executablePath: process.env.CHROME || undefined, viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block' });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

async function firstScreen(hash = '', sel = '[data-testid="agent-input"]', cpu = CPU) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  const start = Date.now();
  await page.goto(URL0 + hash, { waitUntil: 'commit' });
  await page.locator(sel).first().waitFor({ state: 'visible', timeout: 60000 });
  const wall = Date.now() - start;
  const nav = await page.evaluate((s) => { const n = performance.getEntriesByType('navigation')[0]; const fcp = performance.getEntriesByName('first-contentful-paint')[0]; return { fcp: fcp ? Math.round(fcp.startTime) : null, domContentLoaded: n ? Math.round(n.domContentLoadedEventEnd) : null, now: Math.round(performance.now()), sel: !!document.querySelector(s) }; }, sel);
  return { page, cdp, wall, ...nav, errors };
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// 1) 首次打开：建库 + 写入演示设置（已走过引导，直接进对话首页）
{
  const { page } = await firstScreen('', 'body', 1);
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('content-agent'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const put = (v, k) => new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
    await put({ platforms: ['xiaohongshu'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {}, spend: { perCallConfirmYuan: 1, perDayConfirmYuan: 10 }, keyPolicy: 'account' }, 'prefs');
    db.close();
  });
  await page.close();
}
const baseline = [];
for (let i = 0; i < 3; i++) { const r = await firstScreen(); baseline.push(r.wall); await r.page.close(); }
log('空库首屏', baseline);

// 2) 写入 N MB 不可压缩媒体（每条 2 MB 原始字节 → base64 约 2.67 MB 字符串）
const PER = 2; const N = Math.ceil(MBS / PER);
const seedPage = await ctx.newPage();
await seedPage.goto(URL0 + '#me', { waitUntil: 'domcontentloaded' });
let written = 0; const seedStart = Date.now();
for (let b = 0; b < N; b += 16) {
  const n = Math.min(16, N - b);
  written += await seedPage.evaluate(async ({ n, per, base }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('content-agent'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rows = [];
    for (let i = 0; i < n; i++) {
      const bytes = new Uint8Array(per * 1024 * 1024);
      for (let o = 0; o < bytes.length; o += 65536) crypto.getRandomValues(bytes.subarray(o, Math.min(bytes.length, o + 65536)));
      let bin = ''; for (let o = 0; o < bytes.length; o += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(o, o + 0x8000));
      rows.push({ kind: (base + i) % 10 === 0 ? 'video' : (base + i) % 4 === 0 ? 'audio' : 'image', mime: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${btoa(bin)}`, model: 'stress', prompt: `压测 ${base + i}`, role: 'image', created_at: new Date(Date.now() - (base + i) * 3600e3).toISOString(), updated_at: new Date().toISOString() });
    }
    await new Promise((res, rej) => { const t = db.transaction('media', 'readwrite'); for (const r of rows) t.objectStore('media').put(r); t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    db.close();
    return n;
  }, { n, per: PER, base: b });
  if (b % 128 === 0) log(`已写入 ${written * PER} MB`);
}
const seedMs = Date.now() - seedStart;
const est = await seedPage.evaluate(async () => { const e = await navigator.storage.estimate(); return { usage: e.usage, quota: e.quota }; });
log('写入完成', written * PER, 'MB，用时', seedMs, 'ms，estimate', est);
await seedPage.close();

// 3) 无索引（模拟 0.11 旧数据）：首屏不得触发 1 GB 重建
const noIndex = [];
for (let i = 0; i < 3; i++) { const r = await firstScreen(); noIndex.push({ wall: r.wall, fcp: r.fcp, errors: r.errors.length }); await r.page.close(); }
log('1 GB · 无索引 首屏', noIndex.map((x) => x.wall));

// 4) 打开存储页（第一次会用游标重建索引）→ 之后的首屏与存储页
const s1 = await firstScreen('#me/storage', '[data-testid="storage-used"]');
const storageFirst = s1.wall; const usedText = await s1.page.locator('[data-testid="storage-used"]').textContent();
if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await s1.page.screenshot({ path: path.join(SHOTS, 'stress-storage-1gb.png'), fullPage: true }); }
await s1.page.close();
log('存储页（首次，含重建索引）', storageFirst, usedText);
const withIndex = []; const storageWarm = [];
for (let i = 0; i < 3; i++) { const r = await firstScreen(); withIndex.push({ wall: r.wall, fcp: r.fcp, errors: r.errors.length }); if (i === 0 && SHOTS) await r.page.screenshot({ path: path.join(SHOTS, 'stress-home-1gb.png') }); await r.page.close(); }
for (let i = 0; i < 3; i++) { const r = await firstScreen('#me/storage', '[data-testid="storage-used"]'); storageWarm.push(r.wall); await r.page.close(); }
log('1 GB · 有索引 首屏', withIndex.map((x) => x.wall), '存储页', storageWarm);

const report = {
  at: new Date().toISOString(), env: { chromium: ctx.browser()?.version?.() ?? 'persistent', cpuThrottle: CPU, viewport: '375x812@2x', note: '沙盒 Chromium headless + CDP CPU 降速模拟，不等于低端真机' },
  seeded: { mb: written * PER, rows: written, perRowMB: PER, incompressible: true, seedMs, estimate: est },
  firstScreenMs: { empty: { runs: baseline, median: median(baseline) }, gb1_noIndex: { runs: noIndex.map((x) => x.wall), median: median(noIndex.map((x) => x.wall)) }, gb1_withIndex: { runs: withIndex.map((x) => x.wall), median: median(withIndex.map((x) => x.wall)), fcp: withIndex.map((x) => x.fcp) } },
  storagePageMs: { firstWithRebuild: storageFirst, warm: storageWarm, median: median(storageWarm), shown: usedText },
  pageErrors: [...noIndex, ...withIndex].reduce((s, x) => s + x.errors, 0),
  target: { firstScreenMs: 2000 },
};
report.pass = report.firstScreenMs.gb1_withIndex.median < 2000 && report.firstScreenMs.gb1_noIndex.median < 2000;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
log('报告', OUT, report.pass ? '首屏 < 2 s：通过' : '首屏 ≥ 2 s：未通过');
await ctx.close(); srv.close();
fs.rmSync(userDir, { recursive: true, force: true });
