#!/usr/bin/env node
/* global indexedDB */
/**
 * 1.1.0 冒烟走查（PROMPT-v1.1 第十部分 1、2）：用 Playwright 像用户一样点完两条路径，每步截图。
 * - fresh：新用户。首次打开 → 首启引导里接入第一个模型（本地模拟服务商，与“我的 → 模型”同一个三步向导）→ 自由创作一篇 → 适配到两个平台
 *          → 复制去发布 → 录入数据 → 看成长 → 改一条技能 → 回滚 → 备份 → 恢复。
 * - legacy：1.0 老用户。用 1.0 的真实备份格式（zip v3：manifest + vfs/ + kv/models_v3(schemaVersion 3) + kv/assistants + kv/profile + data/）恢复，
 *          确认迁移（主模型、写作助手覆盖 → 技能修订、画像 → user/profile.md）与“我的”无重复入口，再走同样的流程。
 * 无服务端：托管 web/dist，/api 一律 404（与手机 App 本机模式一致）；模拟服务商不联网、不需要 Key，全程不含任何真实密钥。
 * 输出：<out>/{fresh,legacy}/NN-步骤.png；docs/walkthrough/walkthrough-v1.1.json。
 * 用法：PW_DIR=… CHROME=… node scripts/walkthrough-v1.1.mjs [--out ../shots-v1.1/walkthrough]
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
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, oi > 0 ? process.argv[oi + 1] : '../shots-v1.1/walkthrough');
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const TMP = fs.mkdtempSync('/tmp/wt11-');

/* ---------- 1.0 真实格式备份（与 web/src/v11/v11.test.tsx D12 同构；主对话模型用模拟服务商，迁移后能直接用） ---------- */
function legacyBackup() {
  const mockAcc = { id: 'mk', vendor: 'mock', label: '模拟（不联网）', baseURL: 'mock://local', region: 'test', hasKey: false, secretRef: 'secret:mk', models: [
    { id: 'm1', accountId: 'mk', model: 'mock-omni', roles: ['chat', 'reason', 'vision'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 },
  ] };
  const ds = { id: 'ds', vendor: 'dashscope', label: '百炼', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', region: 'cn', hasKey: true, keyTail: 'ABCD', secretRef: 'secret:ds', models: [
    { id: 'e2', accountId: 'ds', model: 'qwen-image', roles: ['image'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 },
  ] };
  const t = (a, e, m) => ({ accountId: a, modelEntryId: e, model: m });
  const roles = Object.fromEntries(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'].map((r) => [r, { role: r, enabled: true }]));
  roles.chat.primary = t('mk', 'm1', 'mock-omni'); roles.reason.primary = t('mk', 'm1', 'mock-omni'); roles.vision.primary = t('mk', 'm1', 'mock-omni'); roles.image.primary = t('ds', 'e2', 'qwen-image');
  roles.image.tasks = { cover: t('ds', 'e2', 'qwen-image') };
  const models = { schemaVersion: 3, accounts: [mockAcc, ds], roles, prices: {}, budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
  const extra = {
    'kv/models_v3.json': JSON.stringify(models),
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu', 'wechat'], onboarded: true, backupHinted: true, hotSources: ['baidu', 'sspai'], schemaVersion: 2, flags: {} }),
    'kv/profile.json': JSON.stringify({ positioning: '1.0.0 的定位：通勤效率', audience: '上班族', style: '口语', bannedWords: [], redlines: ['不碰医疗'] }),
    'kv/assistants.json': JSON.stringify({ wechat_article: { body: '## 步骤\n1. 1.0.0 时我改过的公众号写法：开头先讲一个通勤场景' } }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: '1.0 的旧草稿', body: '旧正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: shared.DEFAULT_FILES['SOUL.md'] }];
  return shared.buildExport(files, { appVersion: '1.0.0', extra }).zip;
}

/* ---------- 走查工具 ---------- */
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = { at: new Date().toISOString(), viewport: '360×800', server: 'none（/api 404，本机模式）', provider: '本地模拟服务商（mock://local，不联网、无 Key）', paths: {} };

async function runPath(name, steps) {
  const dir = path.join(OUT, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2, locale: 'zh-CN', timezoneId: 'Asia/Shanghai', serviceWorkers: 'block', acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { try { localStorage.setItem('ca.lang', 'zh'); localStorage.setItem('ca.theme', 'light'); } catch { /* */ } });
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
async function say(W, text, waitMs = 6000) {
  await go(W, 'agent');
  await tid(W, 'agent-input').fill(text);
  await tid(W, 'send').click();
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await W.page.waitForTimeout(400);
    const allow = W.page.locator('[data-testid="confirm-allow"]');
    if (await allow.count()) { await allow.first().click(); W.memo.confirmed = (W.memo.confirmed ?? 0) + 1; }
    if (!(await W.page.locator('[data-testid="send"]').first().isDisabled().catch(() => false)) && Date.now() - t0 > 1500) break;
  }
  await W.page.waitForTimeout(600);
}

/* ---------- 共用的创作 → 发布 → 数据 → 成长 → 技能 → 备份 ---------- */
const COMMON = [
  ['free-write', '自由创作一篇（不指定平台）', async (W) => {
    const before = (await drafts(W)).length;
    await say(W, '写一篇关于通勤时间怎么利用的短文');
    const ds = await drafts(W); const d = ds.at(-1);
    must(ds.length === before + 1, `草稿数 ${before} → ${ds.length}`);
    must(d.platform === 'free', `平台 ${d.platform}（应为 free）`);
    W.memo.mother = d;
    return `草稿 #${d.id}「${d.title}」平台 free`;
  }],
  ['adapt-two', '适配到小红书与公众号（母稿保留）', async (W) => {
    const m = W.memo.mother;
    await say(W, `把草稿 #${m.id} 适配到小红书和公众号`, 9000);
    const ds = await drafts(W);
    const kids = ds.filter((d) => d.parent_id === m.id);
    must(kids.length === 2, `适配稿 ${kids.length} 篇`);
    must(kids.map((k) => k.platform).sort().join(',') === 'wechat_article,xiaohongshu', `平台 ${kids.map((k) => k.platform)}`);
    const mm = ds.find((d) => d.id === m.id);
    must(mm.title === m.title && mm.body === m.body && mm.platform === 'free', '母稿被改动');
    W.memo.child = kids.find((k) => k.platform === 'xiaohongshu');
    return `适配稿 #${kids.map((k) => k.id).join('、#')}，parent_id 均为 #${m.id}，母稿未变`;
  }],
  ['copy-publish', '审核通过 → 去发布：复制文案、打开发布页，由用户点“我已发布”', async (W) => {
    const c = W.memo.child;
    await go(W, `agent/drafts/${c.id}`);
    await tid(W, 'approve').click(); await W.page.waitForTimeout(800);
    await tid(W, 'editor-go-publish').click(); await W.page.waitForTimeout(900);
    const pre = await tid(W, 'agent-input').inputValue();
    must(pre.includes(`#${c.id}`), `输入框预填 “${pre}”`);
    const popup = W.ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await tid(W, 'send').click();
    await W.page.waitForTimeout(3500);
    const p = await popup; if (p) await p.close().catch(() => {});
    if (!W.page.url().includes('#agent')) await go(W, 'agent');
    const clip = await W.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    must(clip.includes(c.title), '剪贴板里没有标题');
    must((await drafts(W)).find((d) => d.id === c.id).status === 'approved', 'App 自己改了发布状态');
    await tid(W, 'published').click(); await W.page.waitForTimeout(800);
    const st = (await drafts(W)).find((d) => d.id === c.id).status;
    must(st === 'handed_off', `点“我已发布”后状态 ${st}`);
    return `发布前检查 → 准备发布：复制 ${[...clip].length} 字，发布页已打开；用户点“我已发布”后状态 ${st}`;
  }],
  ['metrics', '录入数据（只填用户说出的数字）', async (W) => {
    const c = W.memo.child;
    await say(W, `录入草稿 #${c.id} 的数据：阅读 1200 点赞 85 收藏 40`);
    const ms = await idb(W, 'metrics');
    const m = ms.find((x) => x.draft_id === c.id);
    must(m && m.views === 1200 && m.likes === 85 && m.collects === 40, `数据 ${JSON.stringify(m ?? null)}`);
    must(m.comments === undefined && m.shares === undefined, '填了用户没说的数字');
    return `metrics：阅读 ${m.views} / 点赞 ${m.likes} / 收藏 ${m.collects}${W.memo.confirmed ? `（确认 ${W.memo.confirmed} 次）` : ''}`;
  }],
  ['growth', '看成长', async (W) => {
    await go(W, 'me/growth');
    must(await W.page.locator('[data-testid="growth-page"], [data-testid="growth-all"]').count() > 0, '成长页没打开');
    return '成长页（修订建议 / 自动采纳 / 打法看板 / 收益标签）';
  }],
  ['edit-skill', '改一条技能（自由创作）', async (W) => {
    await go(W, 'me/memory?tab=skills');
    const row = W.page.locator('li', { hasText: '自由创作' }).first();
    await row.getByRole('button', { name: '查看' }).click(); await W.page.waitForTimeout(700);
    const ta = tid(W, 'file-text'); const cur = await ta.inputValue();
    W.memo.skillBefore = cur;
    await ta.fill(`${cur.replace(/\s*$/, '')}\n- 走查加的一条：开头先给一个具体场景。\n`);
    await tid(W, 'file-save').click(); await tid(W, 'confirm-save').click(); await W.page.waitForTimeout(800);
    const txt = await tid(W, 'file-text').inputValue();
    must(txt.includes('走查加的一条'), '保存后正文没有新加的一条');
    const ver = await W.page.locator('[data-testid="file-editor"] .note, [data-testid="file-editor"] p').first().innerText().catch(() => '');
    return `已保存（${ver.split('·')[0].trim()}），保存前看过 diff`;
  }],
  ['rollback', '回滚这条技能', async (W) => {
    const before = (await tid(W, 'file-editor').innerText()).match(/v(\d+)/)?.[1];
    const prev = Number(before) - 1;
    await W.page.locator('[data-testid="file-editor"] li', { hasText: `v${prev} ·` }).first().click(); await W.page.waitForTimeout(500);
    await W.page.getByRole('button', { name: '回滚到这个版本' }).click(); await tid(W, 'confirm-save').click(); await W.page.waitForTimeout(800);
    const txt = await tid(W, 'file-text').inputValue();
    must(!txt.includes('走查加的一条'), '回滚后仍有新加的一条');
    const norm = (x) => x.split('\n').filter((l) => !/^\s*(version|updated):/.test(l)).join('\n').trim();
    must(norm(txt) === norm(W.memo.skillBefore), '回滚后正文与修改前不一致（front matter 的 version / updated 除外）');
    return `v${before} → 回滚到 v${prev} 的内容（生成新版本，历史保留）`;
  }],
  ['backup', '备份（导出 zip，不含 Key）', async (W) => {
    await go(W, 'me/data');
    const dl = W.page.waitForEvent('download', { timeout: 15000 });
    await tid(W, 'export-zip').click();
    const d = await dl; const f = path.join(TMP, `${W.dir.split('/').pop()}-backup.zip`); await d.saveAs(f);
    const bytes = fs.statSync(f).size; const raw = fs.readFileSync(f).toString('latin1');
    must(bytes > 1000, `备份 ${bytes} 字节`);
    must(!/\bsk-[A-Za-z0-9_-]{16,}/.test(raw), '备份里有疑似 Key');
    W.memo.backup = f; W.memo.draftCount = (await drafts(W)).length;
    return `${path.basename(f)} ${bytes} 字节`;
  }],
  ['restore', '从备份恢复', async (W) => {
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(W.memo.backup);
    await W.page.waitForTimeout(2500);
    const n = (await drafts(W)).length;
    must(n === W.memo.draftCount, `恢复后草稿 ${n}（备份时 ${W.memo.draftCount}）`);
    return `恢复完成，草稿 ${n} 篇与备份时一致`;
  }],
];

const ONLY = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1] : null;
if (!ONLY || ONLY === 'fresh') await runPath('fresh', [
  ['first-open', '首次打开 → 首启引导', async (W) => { must(W.page.url().includes('#onboarding'), `落在 ${W.page.url()}`); must(await tid(W, 'connect-wizard').count() === 1, '首启引导里没有三步接入向导'); return '引导第 1 步就是“我的 → 模型”同一个三步向导'; }],
  ['connect-first', '接入第一个模型（本地模拟服务商）', async (W) => {
    await tid(W, 'vendor-mock').click(); await tid(W, 'connect-next').click(); await W.page.waitForTimeout(900);
    await tid(W, 'connect-finish').click(); await W.page.waitForTimeout(900);
    await tid(W, 'onb-next-2').click(); await W.page.waitForTimeout(500);
    await tid(W, 'onb-finish').click(); await W.page.waitForTimeout(1200);
    must(W.page.url().includes('#agent'), `完成引导后在 ${W.page.url()}`);
    return '选服务商 → 填 Key（模拟不需要）→ 选模型（推荐 mock-omni）';
  }],
  ['models-lit', '模型页：主模型 + 能力覆盖自动点亮', async (W) => {
    await go(W, 'me/models');
    const main = await tid(W, 'main-name').innerText(); const cov = await tid(W, 'coverage').innerText();
    must(/mock-omni/.test(main), `主模型 ${main}`);
    must((cov.match(/mock-omni/g) ?? []).length >= 3, '覆盖一览没有点亮对话 / 思考 / 看图');
    must(await W.page.locator('[data-testid="connect-first"]').count() === 0, '已接入仍显示“接入第一个模型”');
    return `主模型 ${main}；点亮：${(cov.match(/mock-omni/g) ?? []).length} 项`;
  }],
  ...COMMON,
]);

if (!ONLY || ONLY === 'legacy') await runPath('legacy', [
  ['open-skip', '打开 → 跳过引导', async (W) => { await tid(W, 'onb-skip-all').click(); await W.page.waitForTimeout(900); return W.page.url().split('#')[1]; }],
  ['restore-1.0', '用 1.0 备份恢复', async (W) => {
    const f = path.join(TMP, 'content-agent-1.0.0-backup.zip'); fs.writeFileSync(f, legacyBackup());
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(f);
    await W.page.waitForTimeout(2500);
    const ds = await drafts(W); must(ds.some((d) => d.title === '1.0 的旧草稿'), '旧草稿没有恢复');
    return `恢复 ${fs.statSync(f).size} 字节的 1.0 备份；旧草稿 ${ds.length} 篇`;
  }],
  ['me-no-dup', '“我的”≤12 项、无重复入口', async (W) => {
    await go(W, 'me');
    const labels = await W.page.locator('main .row-label, [data-testid="me-index"] .row-label').allInnerTexts();
    const uniq = new Set(labels.map((x) => x.trim()));
    W.out.duplicateEntries = labels.length - uniq.size; W.out.meEntries = labels.length;
    must(labels.length > 0 && labels.length <= 12, `入口 ${labels.length} 个`);
    must(W.out.duplicateEntries === 0, `重复 ${W.out.duplicateEntries}`);
    return `入口 ${labels.length} 个：${[...uniq].join('、')}`;
  }],
  ['migrated-model', '迁移：主模型 = 出现最多的对话模型', async (W) => {
    await go(W, 'me/models');
    const main = await tid(W, 'main-name').innerText(); must(/mock-omni/.test(main), `主模型 ${main}`);
    return `主模型 ${main}（原 roles.chat / reason / vision）`;
  }],
  ['migrated-skill', '迁移：1.0 写作助手覆盖 → 公众号技能用户修订', async (W) => {
    await go(W, 'me/memory?tab=skills');
    const row = W.page.locator('li', { hasText: '公众号' }).first();
    await row.getByRole('button', { name: '查看' }).click(); await W.page.waitForTimeout(700);
    const txt = await tid(W, 'file-text').inputValue();
    must(txt.includes('1.0.0 时我改过的公众号写法'), '技能正文里没有 1.0 的覆盖');
    return '公众号技能正文 = 1.0 的覆盖（进版本历史，可回滚）';
  }],
  ['migrated-profile', '迁移：画像 → user/profile.md', async (W) => {
    await go(W, 'me/profile');
    const v = await W.page.locator('[data-testid="profile-page"]').first().evaluate((el) => [...el.querySelectorAll('input,textarea')].map((i) => i.value).join(' | ') + ' ' + el.innerText);
    must(v.includes('1.0.0 的定位'), '画像没有 1.0 的定位');
    return '账号画像显示 1.0 的定位与红线';
  }],
  ...COMMON,
]);

await browser.close(); srv.close();
fs.mkdirSync(path.join(ROOT, 'docs/walkthrough'), { recursive: true });
const RP = path.join(ROOT, 'docs/walkthrough/walkthrough-v1.1.json');
if (ONLY) { const prev = JSON.parse(fs.existsSync(RP) ? fs.readFileSync(RP, 'utf8') : '{"paths":{}}'); report.paths = { ...prev.paths, ...report.paths }; }
fs.writeFileSync(RP, JSON.stringify(report, null, 1));
const sum = Object.entries(report.paths).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}${v.consoleErrors || v.pageErrors ? ` 控制台错误 ${v.consoleErrors + v.pageErrors}` : ''}`).join('；');
console.log(`\nwalkthrough：${sum} → ${OUT}`);
process.exit(Object.values(report.paths).every((p) => p.ok) ? 0 : 1);
