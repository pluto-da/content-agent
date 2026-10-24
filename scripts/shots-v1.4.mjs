#!/usr/bin/env node
/* global document, getComputedStyle, innerWidth, innerHeight, scrollTo */
/**
 * 1.4.0 截图矩阵（PROMPT-v1.4-listed-governance 第十五、十七部分 / G19）：“治理”9 个子页（含经营收入） + 首页（指挥页）董事长简报卡片，三布局（手机 360×800 / 平板 834×1194 / 桌面 1440×900）× 浅深 × 中英。
 * 演示数据经界面真实点出：a11y-seed → 启用集团 → 启用上市公司模式（3 屏引导）→ 召开董事会 → 拍板 → 模拟一个月（演示开关）→ 经营分析 → 内审 → 内控测试 → 季报 → 发布会 → 影子上岗 → 入职培训 → 简报。
 * 每页自动量：横向溢出、可点元素重叠、截断无全文、触控区（手机 / 平板 ≥44px，桌面 ≥24px；行内术语按 WCAG 2.2 2.5.8 “行内例外”不计）、控制台错误、页面报错、axe（WCAG 2.1 A/AA）严重 / 重要。
 * 用法：PW_DIR=… CHROME=… node scripts/shots-v1.4.mjs [--out ../shots-v1.4/matrix] [--only phone-light-zh,…] [--part p1] [--merge]
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
const OUT = path.resolve(ROOT, arg('out', '../shots-v1.4/matrix'));
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;

const VPS = { phone: [360, 800], tablet: [834, 1194], desktop: [1440, 900] };
export const PAGES = ['command?tab=team', ...['board', 'oversight', 'ops', 'disclosure', 'strategy', 'talent', 'university', 'academy', 'revenue'].map((x) => `group?tab=gov&sec=${x}`)];
const pages = arg('pages', '') ? arg('pages', '').split(',') : PAGES;
const COMBOS = Object.keys(VPS).flatMap((vp) => ['light', 'dark'].flatMap((th) => ['zh', 'en'].map((lang) => `${vp}-${th}-${lang}`)));
const only = arg('only', '') ? arg('only', '').split(',') : COMBOS;

/** 在页面里量布局问题（只看当前视口内可见元素）。 */
function measure([minTarget, lang]) {
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
  const clickables = [...document.querySelectorAll('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"], select, summary, [role="tab"], [role="switch"]')].filter(vis).filter((el) => !el.classList.contains('gov-term'));
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
  // 1.1.0 自审补充：文字溢出自身盒子却没被裁（如分段标签挤在一起）、被挤成一字一行的标签
  const spill = [], squeezed = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('pre,textarea,code,.v9-editor,svg')) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join('');
    if (!own) continue;
    const s = getComputedStyle(el); const r = el.getBoundingClientRect(); const fs = parseFloat(s.fontSize) || 14;
    if (s.overflowX === 'visible' && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) spill.push(name(el));
    if (own.length >= 4 && r.width < fs * 2.6 && r.height > fs * 3.2) squeezed.push(name(el));
  }
  // 英文界面里的中文（只报告，演示数据 / 用户内容 / BOUNDARIES.md 原文也会出现）
  const cjk = [];
  if (lang === 'en') {
    const w = document.createTreeWalker(document.body, 4);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent.trim(); if (/[\u4e00-\u9fff]/.test(t) && n.parentElement && vis(n.parentElement)) cjk.push(t.slice(0, 30)); }
  }
  return { spill: [...new Set(spill)].slice(0, 12), squeezed: [...new Set(squeezed)].slice(0, 12), cjk: [...new Set(cjk)].slice(0, 40), overflow, truncated: [...new Set(truncated)].slice(0, 12), small: [...new Set(small)].slice(0, 20), overlap: overlap.slice(0, 12) };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const RP = path.join(ROOT, 'docs/shots/shots-v1.4.json');
// 分批并行：--part 写 /tmp/shots-v1.1-<part>.json，最后 --merge 合并成 docs/shots/shots-v1.2.json
const PART = arg('part', '');
if (process.argv.includes('--merge')) { const runs = {}; for (const f of fs.readdirSync('/tmp').filter((n) => /^shots-v1\.4-.+\.json$/.test(n))) Object.assign(runs, JSON.parse(fs.readFileSync(path.join('/tmp', f), 'utf8')).runs); only.length = 0; Object.assign(globalThis, { MERGED: runs }); }
const prior = globalThis.MERGED ? { runs: globalThis.MERGED } : fs.existsSync(RP) && arg('only', '') && !PART ? JSON.parse(fs.readFileSync(RP, 'utf8')) : { runs: {} };
const report = { at: new Date().toISOString(), viewports: Object.entries(VPS).map(([k, [w, h]]) => `${k} ${w}×${h}`), pages: PAGES, runs: prior.runs ?? {} };
for (const combo of only) {
  const [vp, theme, lang] = combo.split('-'); const [w, h] = VPS[vp];
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: vp === 'desktop' ? 1 : 2, locale: lang === 'en' ? 'en-US' : 'zh-CN', timezoneId: 'Asia/Shanghai', colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await ctx.addInitScript(([l, th]) => { try { localStorage.setItem('ca.lang', l); localStorage.setItem('ca.theme', th); localStorage.setItem('ca.govDemo', '1'); } catch { /* */ } }, [lang, theme]);
  const page = await ctx.newPage();
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(404|net::)/.test(m.text())) consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
  await page.goto(URL0 + '#me'); await page.waitForTimeout(1200);
  await page.evaluate(`(${SEED})()`);
  // 1.2.0 演示数据：经界面真实点出（不直接写库）
  const T = (id) => page.locator(`[data-testid="${id}"]`).first();
  const C = async (id, ms = 700) => { await T(id).scrollIntoViewIfNeeded().catch(() => {}); await T(id).click(); await page.waitForTimeout(ms); };
  await page.goto(URL0 + '#group'); await page.waitForTimeout(900);
  await C('group-enable', 1500);
  const G = async (sec) => { await page.goto(URL0 + `#group?tab=gov&sec=${sec}`); await page.waitForTimeout(800); };
  await G('board'); await C('gov-enable', 1200); await C('gov-onb-next', 300); await C('gov-onb-next', 300); await C('gov-onb-done', 1000);
  await C('gov-convene', 2500);
  for (let k = 0; k < 2; k++) { const b = page.locator('[data-testid^="gov-approve-"]').first(); if (await b.count()) { await b.click(); await page.waitForTimeout(1200); } }
  await G('ops'); await C('gov-sim-month', 1000); await C('gov-review-run', 1200);
  await G('oversight'); await C('gov-audit-run', 1200); await C('gov-risks-review', 600); await C('gov-controls-run', 900);
  await G('revenue'); await T('gov-rev-platform').fill('B站'); await T('gov-rev-amount').fill('36.5'); await C('gov-rev-add', 1000); await C('gov-radar-scan', 1000);
  { const id = (await page.locator('[data-testid^="gov-opp-review-"]:not([disabled])').first().getAttribute('data-testid'))?.replace('gov-opp-review-', ''); if (id) { await C(`gov-opp-review-${id}`); await C(`gov-opp-propose-${id}`); await C(`gov-opp-approve-${id}`, 1000); } }
  await G('disclosure'); await C('gov-report-quarter', 1800); await C('gov-call-run', 1800); await C('gov-brief-run', 800);
  await G('talent'); await C('gov-shadow-run', 2200); await C('gov-assess', 600);
  await G('university'); await C('gov-train-run', 1500); await C('gov-best-run', 800);
  await G('strategy');
  const dir = path.join(OUT, combo); fs.mkdirSync(dir, { recursive: true });
  const run = { pages: {} };
  for (const p of pages) {
    const ce0 = consoleErrors.length, pe0 = pageErrors.length;
    await page.goto(URL0 + '#' + p); await page.waitForTimeout(800);
    const file = path.join(dir, `${p.replace(/[/?=]/g, '_')}.png`);
    await page.screenshot({ path: file });
    const m = await page.evaluate(measure, [vp === 'desktop' ? 24 : 44, lang]); // 触控（手机 / 平板）≥44px；桌面鼠标按 WCAG 2.2 2.5.8 ≥24px（deviations V11-09）
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    const cnt = (k) => ax.violations.filter((v) => v.impact === k).reduce((s, v) => s + v.nodes.length, 0);
    run.pages[p] = { shot: path.relative(path.resolve(OUT, '..'), file), ...m, axeCritical: cnt('critical'), axeSerious: cnt('serious'), axe: ax.violations.filter((v) => ['critical', 'serious'].includes(v.impact)).map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`), consoleErrors: consoleErrors.slice(ce0), pageErrors: pageErrors.slice(pe0) };
    // 量完再截披露页关键数字卡（复核标签溢出修复），避免滚动影响上面的测量
    if (p.endsWith('disclosure')) { const k = page.locator('.gov-keys').first(); if (await k.count()) { await k.scrollIntoViewIfNeeded(); await page.waitForTimeout(200); await k.screenshot({ path: file.replace('.png', '_keys.png') }); await page.evaluate(() => { for (const el of document.querySelectorAll('*')) if (el.scrollTop) el.scrollTop = 0; scrollTo(0, 0); }); } }
  }
  report.runs[combo] = run;
  const sum = (f) => Object.values(run.pages).reduce((s, x) => s + f(x), 0);
  console.log(`${combo}: 溢字 ${sum((x) => x.spill.length)} 挤压 ${sum((x) => x.squeezed.length)} 中文残留(报告) ${sum((x) => x.cjk.length)} 溢出 ${sum((x) => +x.overflow)} 重叠 ${sum((x) => x.overlap.length)} 截断 ${sum((x) => x.truncated.length)} 小触控 ${sum((x) => x.small.length)} 控制台 ${sum((x) => x.consoleErrors.length)} 报错 ${sum((x) => x.pageErrors.length)} axe ${sum((x) => x.axeCritical)}/${sum((x) => x.axeSerious)}`);
  await ctx.close();
}
await browser.close(); srv.close();
const all = Object.values(report.runs).flatMap((r) => Object.values(r.pages));
report.summary = { combos: Object.keys(report.runs).length, shots: all.length, spill: all.reduce((s, x) => s + (x.spill?.length ?? 0), 0), squeezed: all.reduce((s, x) => s + (x.squeezed?.length ?? 0), 0), cjkInEnReportOnly: all.reduce((s, x) => s + (x.cjk?.length ?? 0), 0), overflow: all.filter((x) => x.overflow).length, overlap: all.reduce((s, x) => s + x.overlap.length, 0), truncated: all.reduce((s, x) => s + x.truncated.length, 0), smallTargets: all.reduce((s, x) => s + x.small.length, 0), consoleErrors: all.reduce((s, x) => s + x.consoleErrors.length, 0), pageErrors: all.reduce((s, x) => s + x.pageErrors.length, 0), axeCritical: all.reduce((s, x) => s + x.axeCritical, 0), axeSerious: all.reduce((s, x) => s + x.axeSerious, 0) };
if (PART) fs.writeFileSync(`/tmp/shots-v1.4-${PART}.json`, JSON.stringify(report)); else { fs.mkdirSync(path.dirname(RP), { recursive: true }); fs.writeFileSync(RP, JSON.stringify(report, null, 1)); }
console.log('合计', JSON.stringify(report.summary));
