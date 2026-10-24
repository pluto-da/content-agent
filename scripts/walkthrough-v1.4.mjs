#!/usr/bin/env node
/* global indexedDB */
/**
 * 1.4.0 冒烟走查（PROMPT-v1.4-listed-governance 第十七部分 1）：新用户与 1.3 老用户两条路径，mock 时钟 + 种子数据，每步截图到 shots-v1.4/walkthrough/。
 * 流程：启用上市公司模式（3 屏引导）→ 首次董事会批准战略与预算（独立董事对预算投反对票写明理由，董事长批准并留痕）→ 模拟一个月（mock 时钟 + 种子数据，只在演示开关下）
 *   → 月度经营分析会（预算偏差预警）→ 内审发现一次越权和一处无出处数据 → 整改 → 下期复查关闭 → 内控自动测试 → 季报（数字点开追溯）→ 导出 PDF / docx
 *   → 人为改一个数字 → 一致性检查阻止 → 按记录重新生成 → 业绩发布会（分析师追问，CEO 一个问题记入待办）→ 影子上岗 + 盲评 → 董事会批准交接 → 回滚
 *   → 新 Agent 入职培训测验上岗 → 最佳实践 → 每周一课 → 年度大会 → 年报导出 PDF → 首页董事长简报 → 退回集团模式。
 * 老用户：1.3 备份恢复（迁移：上市公司模式默认关闭；1.3 复盘转为案例卡；OKR 保留）后走同样流程。
 * 无服务端：托管 web/dist，/api 一律 404（与手机 App 本机模式一致）；本地模拟服务商不联网、无 Key。
 * 输出：<out>/{fresh,legacy}/NN-步骤.png；<out>/../report/*.pdf|docx；docs/walkthrough/walkthrough-v1.4.json。
 * 用法：PW_DIR=… CHROME=… node scripts/walkthrough-v1.4.mjs [--out ../shots-v1.4/walkthrough] [--path fresh|legacy]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(process.env.PW_DIR ? path.join(process.env.PW_DIR, 'x.js') : import.meta.url);
const { chromium } = req('playwright-core');
const shared = await import(pathToFileURL(path.join(ROOT, 'shared/dist/index.js')).href);
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, oi > 0 ? process.argv[oi + 1] : '../shots-v1.4/walkthrough');
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const TMP = fs.mkdtempSync('/tmp/wt14-');



/* ---------- 1.3 备份：在 1.2 格式上加集团状态（已启用、OKR、复盘） ---------- */
function backup13() {
  const mockAcc = { id: 'mk', vendor: 'mock', label: '模拟（不联网）', baseURL: 'mock://local', region: 'test', hasKey: false, secretRef: 'secret:mk', models: [{ id: 'm1', accountId: 'mk', model: 'mock-omni', roles: ['chat', 'reason', 'vision'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 }] };
  const t = (a, e, m) => ({ accountId: a, modelEntryId: e, model: m });
  const roles = Object.fromEntries(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'].map((r) => [r, { role: r, enabled: true }]));
  roles.chat.primary = t('mk', 'm1', 'mock-omni'); roles.reason.primary = t('mk', 'm1', 'mock-omni'); roles.vision.primary = t('mk', 'm1', 'mock-omni');
  const v3 = { schemaVersion: 3, accounts: [mockAcc], roles, prices: {}, budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
  const v4 = shared.ModelsMigrator.migrate(v3, 4).doc;
  const extra = { 'kv/models_v3.json': JSON.stringify(v4), 'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu', 'douyin'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {} }), 'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: '1.3 的旧草稿', body: '旧正文', status: 'pending' }]) };
  const org = shared.defaultOrg('长鱼集团');
  const group = { ...shared.emptyGroupState(), enabled: true, enabledAt: '2026-09-01T00:00:00.000Z', name: '长鱼集团', org, okrCycle: 'bimonth', yearGoal: { title: '账号年内到 10 万粉', metric: 'followers', target: 100000, unit: '粉' },
    okrs: [{ id: 'okr-year', level: 'year', owner: 'chairman', title: '账号年内到 10 万粉', krs: [], cycle: 'bimonth', period: '2026', public: true }],
    retros: [{ id: 'retro-1', subject: 'Q3 口播复盘', steps: { 目标回顾: '口播周更 3 条', 结果对比: '完成 2 条', 原因分析: '选题储备不足', 经验沉淀: '每周一储备 5 个选题' }, lessons: [{ text: '每周一先储备 5 个选题' }], at: '2026-09-30T00:00:00.000Z' }] };
  const files = [{ path: 'vfs/SOUL.md', content: shared.DEFAULT_FILES['SOUL.md'] }, { path: 'vfs/AGENTS.md', content: shared.DEFAULT_FILES['AGENTS.md'] }, { path: 'vfs/super/SUPER.md', content: shared.DEFAULT_FILES['super/SUPER.md'] },
    { path: 'vfs/config/group.json', content: shared.writeGroupState(group) }];
  for (const [p, c] of Object.entries(shared.REGULATION_FILES)) files.push({ path: `vfs/${p}`, content: c });
  return shared.buildExport(files, { appVersion: '1.3.0', extra }).zip;
}
/* ---------- 走查工具 ---------- */
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = { version: '1.4.0', at: new Date().toISOString(), viewport: '360×800', server: 'none（/api 404，本机模式）', provider: '本地模拟服务商（mock://local，不联网、无 Key）', paths: {} };

async function runPath(name, steps) {
  const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('ca.lang', 'zh'); localStorage.setItem('ca.theme', 'light'); localStorage.setItem('ca.govDemo', '1'); } catch { /* */ } });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000);
  const consoleErrors = []; const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource.*(404|net::)/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  const out = { ok: true, steps: [], consoleErrors: 0, pageErrors: 0 };
  const W = { page, ctx, dir, out, n: 0, memo: {} };
  await page.goto(URL0); await page.waitForTimeout(1500);
  for (const [id, label, fn] of steps) {
    const started = Date.now(); let ok = true; let note;
    try { note = (await fn(W)) ?? ''; } catch (e) { ok = false; note = String(e.message ?? e).split('\n')[0].slice(0, 240); }
    await page.waitForTimeout(400);
    const shot = path.join(dir, `${String(++W.n).padStart(2, '0')}-${id}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    out.steps.push({ id, label, ok, note, ms: Date.now() - started, shot: path.relative(path.resolve(OUT, '..'), shot) });
    console.log(`${name} ${ok ? '✓' : '✗'} ${id} ${label}${note ? ` — ${note}` : ''}`);
    if (!ok) out.ok = false;
  }
  out.consoleErrors = consoleErrors.length; out.pageErrors = pageErrors.length; out.consoleSamples = [...consoleErrors, ...pageErrors].slice(0, 5);
  if (consoleErrors.length || pageErrors.length) out.ok = false;
  await ctx.close();
  report.paths[name] = out;
}

const tid = (W, id) => W.page.locator(`[data-testid="${id}"]`).first();
const go = async (W, hash) => { await W.page.goto(URL0 + '#' + hash); await W.page.waitForTimeout(900); };
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const idb = (W, store) => W.page.evaluate((s) => new Promise((res) => { const r = indexedDB.open('content-agent'); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains(s)) return res([]); const q = db.transaction(s, 'readonly').objectStore(s).getAll(); q.onsuccess = () => res(q.result); }; r.onerror = () => res([]); }), store);
const drafts = async (W) => (await idb(W, 'drafts')).map((d) => ({ id: d.id, platform: d.platform, title: d.title, body: d.body, status: d.status, parent_id: d.parent_id }));


/** VFS 大文件在 IndexedDB 里分片存（单条 < 64 KB），这里按 db.ts 的 assembleAll 拼回。 */
function assemble(rows) {
  const parts = new Map();
  for (const r of rows) if (r && typeof r.__caChunkOf === 'string') { const a = parts.get(r.__caChunkOf) ?? []; a[r.i] = r.s; parts.set(r.__caChunkOf, a); }
  return rows.filter((r) => !(r && typeof r.__caChunkOf === 'string')).map((r) => (r && typeof r.__caChunks === 'number' ? { ...r, content: Array.from({ length: r.__caChunks }, (_, i) => parts.get(r.__caKey)?.[i] ?? '').join('') } : r));
}
const vfsFiles = async (W) => assemble(await idb(W, 'vfs_files')).filter((f) => !f.deleted);
const vfsText = async (W, p) => (await vfsFiles(W)).find((f) => f.path === p)?.content;
const groupState = async (W) => JSON.parse((await vfsText(W, 'config/group.json')) ?? '{}');
async function clickTid(W, id, wait = 700) { await tid(W, id).scrollIntoViewIfNeeded().catch(() => {}); await tid(W, id).click(); await W.page.waitForTimeout(wait); }


const listed = async (W) => JSON.parse((await vfsText(W, 'config/listed.json')) ?? '{}');
async function gov(W, sec) { await go(W, `group?tab=gov&sec=${sec}`); await W.page.waitForTimeout(900); }
const REPORT_DIR = path.resolve(OUT, '../report');
async function exportPdf(W, name) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const [pop] = await Promise.all([W.page.waitForEvent('popup', { timeout: 8000 }), clickTid(W, 'gov-export-pdf', 300)]);
  await pop.waitForLoadState('load'); await pop.waitForTimeout(600);
  const f = path.join(REPORT_DIR, `${W.out.pathName}-${name}.pdf`);
  await pop.pdf({ path: f, printBackground: true, preferCSSPageSize: true });
  const html = await pop.content(); await pop.close();
  must(html.includes('长鱼茶汤茗'), '封面没有笔名'); must(/不是法律实体/.test(html), '没有诚实声明');
  must(!/(生日|出生).{0,16}\d{4}-\d{2}-\d{2}/.test(html) && !/sk-[A-Za-z0-9]{16,}/.test(html), '报告含隐私或 Key');
  return { f, bytes: fs.statSync(f).size };
}
async function exportDocx(W, name) {
  const [dl] = await Promise.all([W.page.waitForEvent('download', { timeout: 8000 }), clickTid(W, 'gov-export-docx', 300)]);
  const f = path.join(REPORT_DIR, `${W.out.pathName}-${name}.docx`); await dl.saveAs(f);
  const entries = shared.unzip(new Uint8Array(fs.readFileSync(f))).map((e) => e.path);
  must(entries.includes('word/document.xml') && entries.includes('word/footer1.xml'), 'docx 结构不对');
  return { f, bytes: fs.statSync(f).size };
}

const FLOW = [
  ['enable-listed', '启用上市公司模式 → 3 屏引导（是什么 / 谁在帮你挑毛病 / 你平时要做什么）', async (W) => {
    await go(W, 'group?tab=gov'); await W.page.waitForTimeout(1200);
    must(await tid(W, 'gov-enable-card').count() === 1, '默认应关闭并显示启用卡');
    await clickTid(W, 'gov-enable', 1200);
    for (const n of [1, 2]) { must(await tid(W, `gov-onb-${n}`).count() === 1, `第 ${n} 屏`); await clickTid(W, 'gov-onb-next', 400); }
    must(await tid(W, 'gov-onb-3').count() === 1, '第 3 屏'); await clickTid(W, 'gov-onb-done', 1200);
    const s = await listed(W); must(s.enabled && s.onboarded, '没启用');
    must(await tid(W, 'gov-board').count() === 1, '没进董事会页');
    return `董事会：${s.board.directors.map((d) => d.name).join('、')}；独立董事 ${s.board.directors.filter((d) => d.kind === 'independent').length} 名`;
  }],
  ['board-first', '首次董事会：战略 + 预算；独立董事对预算投反对票写理由；董事长批准（留痕）', async (W) => {
    await clickTid(W, 'gov-convene', 2500);
    let s = await listed(W);
    const b = s.motions.find((m) => m.matter === 'budget'); const st = s.motions.find((m) => m.matter === 'strategy');
    must(b && st, '议案不全'); must(b.votes.some((v) => v.choice === 'oppose' && v.reason.length >= 8), '预算没有反对票或理由过短');
    await clickTid(W, `gov-approve-${b.id}`, 1500); await clickTid(W, `gov-approve-${st.id}`, 2000);
    s = await listed(W);
    const bb = s.motions.find((m) => m.id === b.id); must(bb.override?.against?.length, '否决独立董事意见没有留痕');
    must(s.strategies.at(-1).status === 'approved', '战略没批准');
    const g = await groupState(W); must(g.okrs.some((o) => o.id.startsWith('okr-s')), '战略没拆成 OKR');
    W.memo.oppose = b.votes.find((v) => v.choice === 'oppose').reason;
    return `反对理由：${W.memo.oppose.slice(0, 40)}…；战略拆成 OKR ${g.okrs.filter((o) => o.id.startsWith('okr-s')).length} 个`;
  }],
  ['sim-month', '模拟一个月（mock 时钟 + 种子数据，演示开关下）', async (W) => {
    await gov(W, 'ops'); must(await tid(W, 'gov-sim').count() === 1, '演示开关下应出现模拟卡');
    await clickTid(W, 'gov-sim-month', 1200);
    const s = await listed(W); must(s.sim && s.simData?.drafts.length === 15, '没有模拟数据');
    return `mock 时钟 → ${s.clock.slice(0, 10)}；模拟稿件 ${s.simData.drafts.length} 篇`;
  }],
  ['review', '月度经营分析会：平衡计分卡五列表 + 预算偏差预警', async (W) => {
    await clickTid(W, 'gov-review-run', 1500);
    const r = (await listed(W)).reviews.at(-1); must(r.budgetAlerts.length >= 1, '没有预算偏差预警'); must(r.rows.some((x) => x.actual === '无数据'), '应有“无数据”行');
    must(await tid(W, 'gov-gap-table').count() === 1, '五列表没显示');
    return `${r.rows.length} 项指标，落后 ${r.rows.filter((x) => x.behind).length}、无数据 ${r.rows.filter((x) => !x.verifiable).length}；预警：${r.budgetAlerts[0].slice(0, 30)}…`;
  }],
  ['audit-1', '内审抽查：发现一次越权 + 一处无出处数据；直送董事长与审计委员会，CEO 抄送', async (W) => {
    await gov(W, 'oversight'); await clickTid(W, 'gov-audit-run', 1500);
    const s = await listed(W); const a = s.audits.at(-1);
    must(a.findings.some((f) => f.check === 'doa_bypass') && a.findings.some((f) => f.check === 'data_source'), `发现：${a.findings.map((f) => f.check)}`);
    must(s.deliveries.filter((d) => d.ref === a.id).map((d) => `${d.to}:${d.kind}`).join() === 'chairman:to,audit_committee:to,ceo:cc', '投递不对');
    return `${a.no}：${a.findings.map((f) => f.title).join('；').slice(0, 80)}`;
  }],
  ['audit-2', '提交整改 → 下期内审复查关闭', async (W) => {
    await tid(W, 'gov-remed-input').fill('已补走请示；数据补了来源'); await clickTid(W, 'gov-remed', 1200);
    await clickTid(W, 'gov-audit-run', 1500);
    const a = (await listed(W)).audits.at(-1);
    const c = a.carried.filter((f) => f.check === 'doa_bypass' || f.check === 'data_source');
    must(c.length >= 2 && c.every((f) => f.status === 'closed'), `跟踪：${c.map((f) => f.status)}`);
    return `${a.no}：上期 ${c.length} 项全部关闭`;
  }],
  ['controls', '风险登记册本月复核 → 内控矩阵自动测试（COSO 五要素）', async (W) => {
    await clickTid(W, 'gov-risks-review', 800); await clickTid(W, 'gov-controls-run', 1200);
    const c = (await listed(W)).controls; must(c && c.results.length === 12, '没跑'); must(c.results.every((r) => r.ok), `未通过：${c.results.filter((r) => !r.ok).map((r) => r.id + r.note)}`);
    return c.text.slice(0, 80);
  }],
  ['report-q', '生成季报：11 章、数字可追溯（点开关键数字看出处）', async (W) => {
    await gov(W, 'disclosure'); await clickTid(W, 'gov-report-quarter', 2000);
    const r = (await listed(W)).reports.at(-1); must(r.status === 'final' && r.chapters.length === 11, `季报 ${r.status}`);
    await clickTid(W, 'gov-fig-outputs', 500); must(/drafts:/.test(await tid(W, 'gov-trace').innerText()), '追溯不到出处');
    return `${r.title}；数字 ${r.figures.length} 个，无数据 ${r.figures.filter((f) => f.value == null).length} 个`;
  }],
  ['export-q', '导出季报 PDF 与 docx（封面笔名、每页诚实声明）', async (W) => {
    const p = await exportPdf(W, 'quarterly'); const d = await exportDocx(W, 'quarterly');
    return `PDF ${p.bytes} 字节、docx ${d.bytes} 字节`;
  }],
  ['tamper', '人为改一个数字 → 一致性检查阻止并列出差异 → 按记录重新生成', async (W) => {
    await W.page.locator('[data-testid="gov-fig-editor"] summary').click();
    await tid(W, 'gov-fig-select').selectOption('outputs'); await tid(W, 'gov-fig-value').fill('999'); await clickTid(W, 'gov-fig-save', 1200);
    let r = (await listed(W)).reports.at(-1); must(r.status === 'blocked', '没有阻止'); must(await tid(W, 'gov-report-diffs').count() === 1, '差异没显示');
    const diff = r.diffs[0];
    await W.page.screenshot({ path: path.join(W.dir, `${String(W.n + 1).padStart(2, '0')}-tamper-blocked.png`) }).catch(() => {}); W.n++;
    await clickTid(W, 'gov-report-recheck', 1500);
    r = (await listed(W)).reports.at(-1); must(r.status === 'final', '重新生成后仍不一致');
    return diff;
  }],
  ['call', '业绩发布会：分析师 ×2 + 独立董事追问；答不上来记入待办', async (W) => {
    await clickTid(W, 'gov-call-run', 2000);
    const c = (await listed(W)).calls.at(-1); must(c.qa.length === 3 && c.todos.length >= 1, `问答 ${c.qa.length} 待办 ${c.todos.length}`);
    must(c.qa.every((q) => /^(figure|missing):/.test(q.basis)), '问题不基于报告');
    return `待办：${c.todos[0].title}`;
  }],
  ['succession', '影子上岗 10 个任务 → 独立董事盲评 → 董事会批准交接 → 回滚', async (W) => {
    await gov(W, 'talent'); await clickTid(W, 'gov-shadow-run', 2500);
    let s = await listed(W); const x = s.successions.at(-1); must(x.runs.length === 10 && x.status === 'reviewed', `影子上岗 ${x.status}`);
    const mo = s.motions.find((m) => m.matter === 'succession' && m.status === 'voting');
    await gov(W, 'board'); await clickTid(W, `gov-approve-${mo.id}`, 1500);
    await gov(W, 'talent'); must((await listed(W)).successions.at(-1).status === 'handed_over', '没交接');
    await clickTid(W, 'gov-rollback', 1200);
    s = await listed(W); must(s.successions.at(-1).status === 'rolled_back', '没回滚');
    return x.verdict.why;
  }],
  ['training', '新 Agent 入职培训（读制度与案例 Top-K → 5 题测验）→ 上岗；最佳实践', async (W) => {
    await gov(W, 'university'); await clickTid(W, 'gov-train-run', 1800);
    const t = (await listed(W)).trainings.at(-1); must(t.onDuty && t.score >= 4, `测验 ${t.score}`);
    await clickTid(W, 'gov-best-run', 1200);
    const s = await listed(W); must(s.bestPractices.length >= 1, '没评最佳实践');
    return `测验 ${t.score}/5 上岗；案例 ${s.cases.length} 张，引用 ${s.cases.filter((c) => c.cites.length).length} 张`;
  }],
  ['academy', '董事长学堂：每周一课（结合本周事件）→ 已读；徽章', async (W) => {
    await gov(W, 'academy'); const txt = await tid(W, 'gov-weekly-text').innerText();
    must(/本周/.test(txt), '每周一课没结合本周事件');
    await clickTid(W, 'gov-weekly-read', 800); await clickTid(W, 'gov-card-bsc', 600);
    const s = await listed(W); must(s.academy.read.length >= 2, '已读没记录');
    return txt.slice(0, 60);
  }],
  ['agm', '年度大会（审议年报 → 使命愿景目标 → 预算总额 → 章程修改）→ 年报导出 PDF', async (W) => {
    await gov(W, 'disclosure'); await clickTid(W, 'gov-report-annual', 2000);
    const r = (await listed(W)).reports.at(-1); must(r.kind === 'annual' && r.status === 'final', '年报没生成');
    const p = await exportPdf(W, 'annual');
    await gov(W, 'board'); await clickTid(W, 'gov-agm-start', 800);
    for (let i = 0; i < 4; i++) await clickTid(W, 'gov-agm-next', 600);
    must((await listed(W)).agms.at(-1).status === 'closed', '大会没闭会');
    return `年报 PDF ${p.bytes} 字节；年度大会四步完成`;
  }],
  ['brief', '首页“董事长简报”卡片 → 待你拍板 → 进披露页', async (W) => {
    await gov(W, 'disclosure'); await clickTid(W, 'gov-brief-run', 1000);
    await go(W, 'command'); must(await tid(W, 'open-brief').count() === 1, '首页没有简报卡片');
    await clickTid(W, 'open-brief', 900); must(W.page.url().includes('sec=disclosure'), W.page.url());
    return (await listed(W)).brief.text.split('\n').slice(0, 2).join(' ');
  }],
  ['revenue', '经营收入与全球商机：损益表（无数据）→ 录入收入 → 商机卡（≥3 渠道带来源）→ 经管会评审 → CEO 提案 → 董事长批准 → 工单；越界请求被拒', async (W) => {
    await gov(W, 'revenue');
    must(/集团不是法律实体，真实收入归属用户本人/.test(await tid(W, 'gov-rev-honesty').innerText()), '没有收入诚实声明');
    let s = await listed(W); must(!s.revenues?.length, '应从无收入开始');
    const g = await groupState(W); const bu = g.org.depts.find((d) => d.kind === 'bu').id;
    await tid(W, 'gov-rev-dept').selectOption(bu); await tid(W, 'gov-rev-platform').fill('B站'); await tid(W, 'gov-rev-amount').fill('36.5'); await clickTid(W, 'gov-rev-add', 1000);
    s = await listed(W); must(s.revenues.length === 1 && s.revenues[0].source === 'user_entry', '收入没记上');
    must(/¥36\.50/.test(await tid(W, 'gov-pnl-table').innerText()), '损益表没更新');
    await clickTid(W, 'gov-radar-scan', 1000);
    s = await listed(W); const sourced = s.opportunities.filter((c) => c.source); must(sourced.length >= 3, `有来源的商机卡 ${sourced.length}`);
    const c = sourced[0];
    await clickTid(W, `gov-opp-review-${c.id}`, 700); await clickTid(W, `gov-opp-propose-${c.id}`, 700); await clickTid(W, `gov-opp-approve-${c.id}`, 1000);
    const done = (await listed(W)).opportunities.find((x) => x.id === c.id); must(done.status === 'ticket', `商机 ${done.status}`);
    must(await tid(W, `gov-ticket-${c.id}`).count() === 1, '工单没显示');
    await gov(W, 'disclosure'); await clickTid(W, 'gov-report-quarter', 1800);
    const rep = (await listed(W)).reports.at(-1); must(rep.status === 'final' && rep.figures.find((f) => f.id === 'revenue').value === 36.5, '季报收入没更新');
    const chk = shared.checkRevenueAction('让 Agent 自动收款并帮我自动投稿'); must(!chk.ok, '越界请求没被拒');
    return `收入 ¥36.5 → 季报收入 ${rep.figures.find((f) => f.id === 'revenue').value}；商机卡 ${s.opportunities.length}（有来源 ${sourced.length}）；${done.title} → 工单 ${done.ticket.steps.length} 步（你本人 ${done.ticket.steps.filter((x) => x.actor === 'user').length} 步）；越界：${chk.rule}`;
  }],
  ['disable', '退回集团模式（数据保留）', async (W) => {
    await gov(W, 'board'); await clickTid(W, 'gov-disable', 1000);
    const s = await listed(W); must(!s.enabled && s.motions.length > 0, '退回失败或数据丢失');
    must(await tid(W, 'gov-enable-card').count() === 1, '没回到启用卡');
    return `议案 ${s.motions.length}、报告 ${s.reports.length}、案例 ${s.cases.length} 保留`;
  }],
];

const ONLY = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1] : null;
if (!ONLY || ONLY === 'fresh') await runPath('fresh', [
  ['first-open', '首次打开 → 首启引导', async (W) => { W.out.pathName = 'fresh'; must(W.page.url().includes('#onboarding'), `落在 ${W.page.url()}`); return '首启引导'; }],
  ['connect-first', '接入模型（本地模拟服务商）', async (W) => {
    await tid(W, 'vendor-mock').click(); await tid(W, 'connect-next').click(); await W.page.waitForTimeout(900);
    await tid(W, 'connect-finish').click(); await W.page.waitForTimeout(900);
    await tid(W, 'onb-next-2').click(); await W.page.waitForTimeout(500);
    await tid(W, 'onb-finish').click(); await W.page.waitForTimeout(1200);
    must(W.page.url().includes('#agent'), `完成引导后在 ${W.page.url()}`);
    return '选服务商 → 选模型 → 首页';
  }],
  ['enable-group', '启用集团模式（上市公司模式的前提）', async (W) => {
    await go(W, 'command'); await clickTid(W, 'open-group', 900);
    if (await tid(W, 'group-enable').count()) await clickTid(W, 'group-enable', 1500);
    must((await groupState(W)).enabled === true, '没有启用'); return (await groupState(W)).name;
  }],
  ...FLOW,
]);
if (!ONLY || ONLY === 'legacy') await runPath('legacy', [
  ['open-skip', '打开 → 跳过引导', async (W) => { W.out.pathName = 'legacy'; await tid(W, 'onb-skip-all').click(); await W.page.waitForTimeout(900); return W.page.url().split('#')[1]; }],
  ['restore-1.3', '用 1.3 备份恢复 → 自动迁移（上市公司模式默认关闭；1.3 复盘转为案例卡；OKR 保留）', async (W) => {
    const f = path.join(TMP, 'content-agent-1.3.0-backup.zip'); fs.writeFileSync(f, backup13());
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(f);
    await W.page.waitForTimeout(3500);
    const ds = await drafts(W); must(ds.some((d) => d.title === '1.3 的旧草稿'), '旧草稿没有恢复');
    const g = await groupState(W); must(g.enabled === true && g.okrs.some((o) => o.id === 'okr-year'), '集团或 OKR 没保留');
    const s = await listed(W); must(s.enabled === false, '上市公司模式应默认关闭'); must(s.cases?.some((c) => c.source === 'retro:retro-1'), '复盘没转为案例卡');
    return `恢复 ${fs.statSync(f).size} 字节；集团「${g.name}」保留；案例卡 ${s.cases.length}`;
  }],
  ...FLOW,
]);

await browser.close(); srv.close();
fs.mkdirSync(path.join(ROOT, 'docs/walkthrough'), { recursive: true });
const RP = path.join(ROOT, 'docs/walkthrough/walkthrough-v1.4.json');
if (ONLY) { const prev = JSON.parse(fs.existsSync(RP) ? fs.readFileSync(RP, 'utf8') : '{"paths":{}}'); report.paths = { ...prev.paths, ...report.paths }; }
fs.writeFileSync(RP, JSON.stringify(report, null, 1));
const sum = Object.entries(report.paths).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}${v.consoleErrors || v.pageErrors ? ` 控制台错误 ${v.consoleErrors + v.pageErrors}` : ''}`).join('；');
console.log(`\nwalkthrough：${sum} → ${OUT}`);
process.exit(Object.values(report.paths).every((p) => p.ok) ? 0 : 1);
