#!/usr/bin/env node
/* global document, getComputedStyle, innerWidth, innerHeight */
/**
 * 1.1.0 截图矩阵（PROMPT-v1.1 第八部分）：手机 360×800 / 平板 834×1194 / 桌面 1440×900 × 浅 / 深 × 中文 / 英文，覆盖 Agent、草稿与“我的”12 个入口。
 * 每页自动量：横向溢出、可点元素互相重叠、文字被截断且没有 title / 读屏全文、触控区 < 44px（桌面鼠标 < 24px）、控制台错误、页面报错、axe（WCAG 2.1 A/AA）严重 / 重要。
 * 无服务端：托管 web/dist，/api 一律 404；演示数据 = scripts/a11y-seed.js（模拟服务商，不含 Key）。
 * 输出：<out>/<vp>-<theme>-<lang>/<页>.png；<out>/sheets/*.png（拼图，供逐张人工查看）；docs/shots/shots-v1.1.json。
 * 用法：PW_DIR=… CHROME=… node scripts/shots-v1.1.mjs [--out ../shots-v1.1/matrix] [--only phone-light-zh,…] [--pages agent,me]
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
const OUT = path.resolve(ROOT, arg('out', '../shots-v1.1/matrix'));
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;

const VPS = { phone: [360, 800], tablet: [834, 1194], desktop: [1440, 900] };
export const PAGES = ['agent', 'agent/drafts', 'me', 'me/models', 'me/platforms', 'me/profile', 'me/files', 'me/memory', 'me/growth', 'me/reminders', 'me/spend', 'me/records', 'me/data', 'me/prefs', 'me/server'];
const pages = arg('pages', '') ? arg('pages', '').split(',') : PAGES;
const COMBOS = Object.keys(VPS).flatMap((vp) => ['light', 'dark'].flatMap((th) => ['zh', 'en'].map((lang) => `${vp}-${th}-${lang}`)));
const only = arg('only', '') ? arg('only', '').split(',') : COMBOS;

/** 在页面里量布局问题（只看当前视口内可见元素）。 */
function measure(minTarget) {
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity !== 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && !el.closest('[aria-hidden="true"],[inert],.sr-only'); };
  const name = (el) => `${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ''}「${(el.innerText || el.getAttribute('aria-label') || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 24)}」`;
  const overflow = document.documentElement.scrollWidth > innerWidth + 1;
  // 截断：文字溢出自身且被裁（overflow 非 visible / 省略号 / line-clamp），而自身和最近两层祖先都没有 title / aria-label 给出全文
  const truncated = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'svg', 'PRE', 'CODE', 'IMG', 'CANVAS'].includes(el.tagName) || el.closest('pre,textarea,code,.v9-editor')) continue;
    const s = getComputedStyle(el);
    const clips = s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' || ((s.overflowX === 'hidden' || s.overflow === 'hidden') && s.whiteSpace === 'nowrap');
    if (!clips || !(el.innerText || '').trim()) continue;
    if (el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) continue;
    const full = (el.innerText || '').trim();
    const hasFull = [el, el.parentElement, el.parentElement?.parentElement].some((x) => x && ((x.getAttribute('title') || '').includes(full.slice(0, 12)) || (x.getAttribute('aria-label') || '').includes(full.slice(0, 12))));
    if (!hasFull) truncated.push(name(el));
  }
  // 可点元素：重叠与触控区
  const clickables = [...document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select, summary, [role="tab"], [role="switch"]')].filter(vis);
  const small = [];
  for (const el of clickables) {
    const r = el.getBoundingClientRect();
    const target = el.matches('input[type="checkbox"],input[type="radio"]') ? (el.closest('label') ?? el).getBoundingClientRect() : r;
    if (target.height < minTarget - 0.5 || target.width < minTarget - 0.5) small.push(`${name(el)} ${Math.round(target.width)}×${Math.round(target.height)}`);
  }
  const overlap = [];
  for (let i = 0; i < clickables.length; i++) for (let j = i + 1; j < clickables.length; j++) {
    const a = clickables[i], b = clickables[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 4 && h > 4) overlap.push(`${name(a)} × ${name(b)}`);
  }
  return { overflow, truncated: [...new Set(truncated)].slice(0, 12), small: [...new Set(small)].slice(0, 20), overlap: overlap.slice(0, 12) };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const RP = path.join(ROOT, 'docs/shots/shots-v1.1.json');
// 分批并行：--part 写 /tmp/shots-v1.1-<part>.json，最后 --merge 合并成 docs/shots/shots-v1.1.json
const PART = arg('part', '');
if (process.argv.includes('--merge')) { const runs = {}; for (const f of fs.readdirSync('/tmp').filter((n) => /^shots-v1\.1-.+\.json$/.test(n))) Object.assign(runs, JSON.parse(fs.readFileSync(path.join('/tmp', f), 'utf8')).runs); only.length = 0; Object.assign(globalThis, { MERGED: runs }); }
const prior = globalThis.MERGED ? { runs: globalThis.MERGED } : fs.existsSync(RP) && arg('only', '') && !PART ? JSON.parse(fs.readFileSync(RP, 'utf8')) : { runs: {} };
const report = { at: new Date().toISOString(), viewports: Object.entries(VPS).map(([k, [w, h]]) => `${k} ${w}×${h}`), pages: PAGES, runs: prior.runs ?? {} };
for (const combo of only) {
  const [vp, theme, lang] = combo.split('-'); const [w, h] = VPS[vp];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: vp === 'desktop' ? 1 : 2, locale: lang === 'en' ? 'en-US' : 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript(([l, th]) => { try { localStorage.setItem('ca.lang', l); localStorage.setItem('ca.theme', th); } catch { /* */ } }, [lang, theme]);
  const page = await ctx.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(404|net::)/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  await page.goto(URL0 + '#me'); await page.waitForTimeout(1200);
  await page.evaluate(`(${SEED})()`);
  const dir = path.join(OUT, combo); fs.mkdirSync(dir, { recursive: true });
  const run = { pages: {} };
  for (const p of pages) {
    const ce0 = consoleErrors.length, pe0 = pageErrors.length;
    await page.goto(URL0 + '#' + p); await page.waitForTimeout(800);
    const file = path.join(dir, `${p.replace(/\//g, '_')}.png`);
    await page.screenshot({ path: file });
    const m = await page.evaluate(measure, vp === 'desktop' ? 24 : 44); // 触控（手机 / 平板）≥44px；桌面鼠标按 WCAG 2.2 2.5.8 ≥24px（deviations V11-09）
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const cnt = (k) => ax.violations.filter((v) => v.impact === k).reduce((s, v) => s + v.nodes.length, 0);
    run.pages[p] = { shot: path.relative(path.resolve(OUT, '..'), file), ...m, axeCritical: cnt('critical'), axeSerious: cnt('serious'), axe: ax.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), consoleErrors: consoleErrors.slice(ce0), pageErrors: pageErrors.slice(pe0) };
  }
  report.runs[combo] = run;
  const sum = (f) => Object.values(run.pages).reduce((s, x) => s + f(x), 0);
  console.log(`${combo}: 溢出 ${sum((x) => +x.overflow)} 重叠 ${sum((x) => x.overlap.length)} 截断 ${sum((x) => x.truncated.length)} 小触控 ${sum((x) => x.small.length)} 控制台 ${sum((x) => x.consoleErrors.length)} 报错 ${sum((x) => x.pageErrors.length)} axe ${sum((x) => x.axeCritical)}/${sum((x) => x.axeSerious)}`);
  await ctx.close();
}
await browser.close(); srv.close();
const all = Object.values(report.runs).flatMap((r) => Object.values(r.pages));
report.summary = { combos: Object.keys(report.runs).length, shots: all.length, overflow: all.filter((x) => x.overflow).length, overlap: all.reduce((s, x) => s + x.overlap.length, 0), truncated: all.reduce((s, x) => s + x.truncated.length, 0), smallTargets: all.reduce((s, x) => s + x.small.length, 0), consoleErrors: all.reduce((s, x) => s + x.consoleErrors.length, 0), pageErrors: all.reduce((s, x) => s + x.pageErrors.length, 0), axeCritical: all.reduce((s, x) => s + x.axeCritical, 0), axeSerious: all.reduce((s, x) => s + x.axeSerious, 0) };
if (PART) fs.writeFileSync(`/tmp/shots-v1.1-${PART}.json`, JSON.stringify(report)); else { fs.mkdirSync(path.dirname(RP), { recursive: true }); fs.writeFileSync(RP, JSON.stringify(report, null, 1)); }
console.log('合计', JSON.stringify(report.summary));
