#!/usr/bin/env node
/* global document, innerWidth */
/**
 * 1.0 截图矩阵：手机 375×812 / 平板 834×1194 / 桌面 1440×900 × 浅 / 深 × 1.0 相关页面（中文），外加英文桌面若干页。
 * 无服务端：托管 web/dist，屏蔽 /api；种子数据同 a11y-seed.js（模拟服务商，不含真实 Key）。同时量页面横向溢出与报错。
 * 用法：PW_DIR=… CHROME=… node scripts/shots-v1.mjs [--out ../shots-v1]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import SEED from './a11y-seed.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PW_DIR ? path.join(process.env.PW_DIR, 'x.js') : import.meta.url);
const { chromium } = req('playwright-core');
const i = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, i > 0 ? process.argv[i + 1] : '../shots-v1');
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const VPS = [['phone', 375, 812, 2], ['tablet', 834, 1194, 2], ['desktop', 1440, 900, 1]];
const PAGES = ['agent', 'me', 'me/settings', 'me/storage', 'me/growth', 'me/backup', 'me/status', 'me/prefs', 'me/models/accounts'];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = { at: new Date().toISOString(), shots: [], overflow: [], pageErrors: [] };
const runs = [...VPS.flatMap((v) => [[...v, 'light', 'zh'], [...v, 'dark', 'zh']]), [...VPS[2], 'light', 'en']];
for (const [vp, w, h, dpr, theme, lang] of runs) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, locale: lang === 'en' ? 'en-US' : 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript(([l, th]) => { try { localStorage.setItem('ca.lang', l); localStorage.setItem('ca.theme', th); } catch { /* */ } }, [lang, theme]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.pageErrors.push(`${vp}/${theme}/${lang}: ${e.message}`));
  await page.goto(URL0 + '#me'); await page.waitForTimeout(1200);
  await page.evaluate(`(${SEED})()`);
  const dir = path.join(OUT, vp); fs.mkdirSync(dir, { recursive: true });
  for (const p of (lang === 'en' ? ['agent', 'me/settings', 'me/storage'] : PAGES)) {
    await page.goto(URL0 + '#' + p); await page.waitForTimeout(900);
    const f = path.join(dir, `${theme}-${lang}-${p.replace(/\//g, '_')}.png`);
    await page.screenshot({ path: f });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) report.overflow.push(`${vp}/${theme}/${lang}/${p}`);
    report.shots.push(path.relative(OUT, f));
  }
  await ctx.close();
}
await browser.close(); srv.close();
fs.writeFileSync(path.join(OUT, 'report-v1.json'), JSON.stringify(report, null, 2));
console.log(`截图 ${report.shots.length} 张 → ${OUT}；横向溢出 ${report.overflow.length}；页面报错 ${report.pageErrors.length}`);
