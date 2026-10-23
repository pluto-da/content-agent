#!/usr/bin/env node
/* global window */
/**
 * 1.0 可访问性与多语言扫描：Playwright + @axe-core/playwright（WCAG 2.0/2.1 A/AA 规则），中文 / 英文 × 手机浅 / 手机深 / 电脑浅，逐页扫描；
 * 同时收集英文界面下的运行时漏翻（window.__caI18nMiss）。无服务端：托管 web/dist、屏蔽 /api；演示数据见 scripts/a11y-seed.js（不含 Key）。
 * 用法：PW_DIR=<含 playwright-core 与 @axe-core/playwright 的 node_modules> CHROME=<chrome 路径> node scripts/a11y-scan.mjs [--vps phone-light,phone-dark,desktop-light] [--langs zh,en] [--out out/a11y.json] [--shots ../shots-v1/a11y]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import SEED from './a11y-seed.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const req = createRequire(process.env.PW_DIR ? path.join(process.env.PW_DIR, 'x.js') : import.meta.url);
const { chromium } = req('playwright-core');
const AxeBuilder = req('@axe-core/playwright').default ?? req('@axe-core/playwright').AxeBuilder;
const VPS = { 'phone-light': [375, 812, 'light'], 'phone-dark': [375, 812, 'dark'], 'desktop-light': [1440, 900, 'light'] };
const vps = arg('vps', 'phone-light,phone-dark,desktop-light').split(',');
const langs = arg('langs', 'zh,en').split(',');
const OUT = path.resolve(ROOT, arg('out', 'out/a11y.json'));
const SHOTS = arg('shots', '') ? path.resolve(ROOT, arg('shots', '')) : '';
const PAGES = ['agent', 'agent/drafts', 'agent/inbox', 'me', 'me/models', 'me/models/image', 'me/models/accounts', 'me/models/routing', 'me/platforms', 'me/sources', 'me/profile', 'me/agent', 'me/files', 'me/memory', 'me/skills', 'me/revenue', 'me/growth', 'me/reminders', 'me/prefs', 'me/settings', 'me/status', 'me/status/cards', 'me/audit', 'me/backup', 'me/storage', 'me/logs', 'me/server'];
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const prior = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { runs: {} };
const report = { at: new Date().toISOString(), axe: null, runs: prior.runs ?? {} };
for (const vp of vps) for (const lang of langs) {
  const [w, h, theme] = VPS[vp];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: lang === 'en' ? 'en-US' : 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript(([l, th]) => { try { localStorage.setItem('ca.lang', l); localStorage.setItem('ca.theme', th); } catch { /* */ } }, [lang, theme]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message ?? e)));
  await page.goto(URL0 + '#me'); await page.waitForTimeout(1200);
  await page.evaluate(`(${SEED})()`); 
  const key = `${vp}/${lang}`; const run = { pages: {}, misses: [], errors };
  for (const p of PAGES) {
    await page.goto(URL0 + '#' + p); await page.waitForTimeout(700);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, targets: x.nodes.slice(0, 4).map((n) => n.target.join(' ')) }));
    run.pages[p] = { violations: v, counts: { critical: v.filter((x) => x.impact === 'critical').reduce((s, x) => s + x.nodes, 0), serious: v.filter((x) => x.impact === 'serious').reduce((s, x) => s + x.nodes, 0), moderate: v.filter((x) => x.impact === 'moderate').reduce((s, x) => s + x.nodes, 0), minor: v.filter((x) => x.impact === 'minor').reduce((s, x) => s + x.nodes, 0) } };
    if (SHOTS && (p === 'agent' || p === 'me' || p === 'me/settings' || p === 'me/storage')) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${vp}-${lang}-${p.replace(/\//g, '_')}.png`) }); }
  }
  run.misses = lang === 'en' ? await page.evaluate(() => window.__caI18nMiss?.() ?? []) : [];
  const tot = (k) => Object.values(run.pages).reduce((s, x) => s + x.counts[k], 0);
  run.totals = { critical: tot('critical'), serious: tot('serious'), moderate: tot('moderate'), minor: tot('minor'), pages: PAGES.length, i18nMisses: run.misses.length, pageErrors: errors.length };
  report.runs[key] = run;
  console.log(key, JSON.stringify(run.totals));
  await ctx.close();
}
report.axe = req('axe-core/package.json').version;
const all = Object.values(report.runs);
report.summary = { runs: all.length, critical: all.reduce((s, r) => s + r.totals.critical, 0), serious: all.reduce((s, r) => s + r.totals.serious, 0), moderate: all.reduce((s, r) => s + r.totals.moderate, 0), minor: all.reduce((s, r) => s + r.totals.minor, 0), i18nMisses: [...new Set(all.flatMap((r) => r.misses))].length, pageErrors: all.reduce((s, r) => s + r.totals.pageErrors, 0) };
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log('summary', JSON.stringify(report.summary));
await browser.close(); srv.close();
