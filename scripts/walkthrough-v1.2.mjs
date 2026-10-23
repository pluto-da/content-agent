#!/usr/bin/env node
/* global indexedDB */
/**
 * 1.2.0 冒烟走查（PROMPT-v1.2 第十三部分 1、2）：新用户与 1.1 老用户两条路径，每步截图到 shots-v1.2/walkthrough/。
 * 新用户：接入模型 → 设目标 → 从模板启用 3 个子 Agent → 一句话添加自定义平台（B 站）并让超级 Agent 起草写法 → 批准写法 → 运行“一稿多发”工作流 → 审批
 *        → 自由创作 + @子Agent 适配 → 复制去发布（用户点“我已发布”）→ 导入数据（对话录入 + 目标数据）→ 周复盘 → 一键暂停 → 恢复 → 回滚一次子 Agent 修订 → 备份 → 恢复。
 * 老用户：1.1 备份恢复后（迁移：控制平面、指挥职责、内置平台只读模板、AGENTS.md 修订建议进收件箱）走同样的流程。
 * 以下为 1.1.0 的说明（沿用同一套托管与工具）：
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
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, oi > 0 ? process.argv[oi + 1] : '../shots-v1.2/walkthrough');
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const TMP = fs.mkdtempSync('/tmp/wt12-');


/* ---------- 1.1 真实格式备份（models v4、画像 user/profile.md、技能为 VFS 文件；主对话模型用模拟服务商） ---------- */
function backup11() {
  const mockAcc = { id: 'mk', vendor: 'mock', label: '模拟（不联网）', baseURL: 'mock://local', region: 'test', hasKey: false, secretRef: 'secret:mk', models: [
    { id: 'm1', accountId: 'mk', model: 'mock-omni', roles: ['chat', 'reason', 'vision'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 },
  ] };
  const t = (a, e, m) => ({ accountId: a, modelEntryId: e, model: m });
  const roles = Object.fromEntries(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'].map((r) => [r, { role: r, enabled: true }]));
  roles.chat.primary = t('mk', 'm1', 'mock-omni'); roles.reason.primary = t('mk', 'm1', 'mock-omni'); roles.vision.primary = t('mk', 'm1', 'mock-omni');
  const v3 = { schemaVersion: 3, accounts: [mockAcc], roles, prices: {}, budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
  const v4 = shared.ModelsMigrator.migrate(v3, 4).doc;
  const extra = {
    'kv/models_v3.json': JSON.stringify(v4),
    'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu', 'wechat'], onboarded: true, backupHinted: true, hotSources: ['baidu', 'sspai'], schemaVersion: 2, flags: {} }),
    'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: '1.1 的旧草稿', body: '旧正文', status: 'pending' }]),
  };
  const files = [{ path: 'vfs/SOUL.md', content: shared.DEFAULT_FILES['SOUL.md'] }, { path: 'vfs/AGENTS.md', content: shared.DEFAULT_FILES['AGENTS.md'] }, { path: 'vfs/user/profile.md', content: '---\nid: profile\ntype: user\n---\n# 账号画像\n- 定位：1.1.0 的定位：通勤效率\n' }];
  return shared.buildExport(files, { appVersion: '1.1.0', extra }).zip;
}
/* ---------- 走查工具 ---------- */
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = { version: '1.2.0', at: new Date().toISOString(), viewport: '360×800', server: 'none（/api 404，本机模式）', provider: '本地模拟服务商（mock://local，不联网、无 Key）', paths: {} };

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


const vfsFiles = async (W) => (await idb(W, 'vfs_files')).filter((f) => !f.deleted);
const vfsText = async (W, p) => (await vfsFiles(W)).find((f) => f.path === p)?.content;
const superState = async (W) => JSON.parse((await vfsText(W, 'config/super.json')) ?? '{}');
const agentsIn = async (W) => (await vfsFiles(W)).filter((f) => /^agents\/[a-z0-9-]+\/AGENT\.md$/.test(f.path));
async function cmd(W, tab) { await go(W, `command?tab=${tab}`); await W.page.waitForTimeout(500); }
async function clickTid(W, id, wait = 700) { await tid(W, id).scrollIntoViewIfNeeded().catch(() => {}); await tid(W, id).click(); await W.page.waitForTimeout(wait); }
async function approveFirst(W, pred, label) {
  const st = await superState(W);
  const a = (st.approvals ?? []).filter((x) => x.status === 'pending').reverse().find(pred);
  must(a, `收件箱里没有：${label}`);
  await cmd(W, 'inbox');
  await clickTid(W, `ap-approve-${a.id}`, 1500);
  const after = (await superState(W)).approvals.find((x) => x.id === a.id);
  must(after?.status === 'approved', `${label} 状态 ${after?.status}`);
  return a;
}

const FLOW = [
  ['goal', '设目标（只显示有数据依据的数字）', async (W) => {
    await cmd(W, 'goals');
    await tid(W, 'goal-title').fill('本月小红书涨粉 500'); await tid(W, 'goal-target').fill('500'); await tid(W, 'goal-platform').fill('xiaohongshu');
    await clickTid(W, 'goal-add', 1000);
    const g = (await superState(W)).goals?.at(-1); must(g?.target === 500, `目标 ${JSON.stringify(g ?? null)}`);
    const txt = await tid(W, `goal-progress-${g.id}`).innerText(); must(txt.includes('待录入'), `进度显示 “${txt}”`);
    W.memo.goal = g; return `目标「${g.title}」，进度：${txt}`;
  }],
  ['agents-3', '从模板启用 3 个子 Agent', async (W) => {
    await cmd(W, 'team'); await clickTid(W, 'agent-new', 500);
    for (const id of ['topic-researcher', 'platform-adapter', 'compliance-reviewer']) await clickTid(W, `tpl-enable-${id}`, 900);
    const n = (await agentsIn(W)).length; must(n >= 3, `子 Agent ${n} 个`);
    return `启用：选题研究员、平台适配编辑、合规审核员（共 ${n} 个，权限都 ≤L2）`;
  }],
  ['platform-bili', '一句话添加自定义平台（B 站），超级 Agent 起草写法技能', async (W) => {
    await cmd(W, 'connect');
    await tid(W, 'plat-sentence').fill('加一个叫B站主号的视频平台 https://www.bilibili.com 主要做中长视频');
    await clickTid(W, 'plat-draft', 1500);
    const plats = (await vfsFiles(W)).filter((f) => /^platforms\/[^/]+\/PLATFORM\.md$/.test(f.path) && /source: user/.test(f.content));
    const p = plats.find((f) => /name: B站主号/.test(f.content)); must(p, '没有新平台清单');
    W.memo.platId = p.path.split('/')[1];
    must(!(await vfsText(W, `skills/${W.memo.platId}/SKILL.md`)), '写法技能没审批就写入了');
    return `${p.path}（规格全部“待核实”），写法技能草稿进审批收件箱`;
  }],
  ['approve-skill', '在审批收件箱批准写法技能（新平台技能 = L3）', async (W) => {
    await approveFirst(W, (x) => x.kind === 'platform_skill', '新平台写法技能');
    const sk = await vfsText(W, `skills/${W.memo.platId}/SKILL.md`); must(sk && /B站主号 写法/.test(sk), '批准后技能没写入');
    return `skills/${W.memo.platId}/SKILL.md 已写入（author=user_approved）`;
  }],
  ['workflow-run', '运行“一稿多发”工作流（写母稿 → 平台适配编辑 → 合规审核员 → 待你发布）', async (W) => {
    await cmd(W, 'workflows'); await clickTid(W, 'wf-add-one-to-many', 900);
    await clickTid(W, 'wf-run-one-to-many', 400);
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 15000) { st = (await superState(W)).wfRuns?.['one-to-many']; if (st && st.status !== 'running') break; await W.page.waitForTimeout(500); }
    must(st?.status === 'awaiting_user', `工作流状态 ${st?.status}`);
    const done = Object.entries(st.nodes).filter(([, n]) => n.status === 'done').map(([k]) => k);
    must(['mother', 'adapt', 'review'].every((k) => done.includes(k)), `完成的步骤 ${done}`);
    return `3 个 Agent 步骤完成（${done.join(' → ')}），停在审批节点；任务板 ${((await superState(W)).tasks ?? []).filter((x) => x.state === 'done').length} 个完成`;
  }],
  ['workflow-approve', '审批：批准工作流的“待你发布”节点', async (W) => {
    await approveFirst(W, (x) => x.payload?.action === 'workflow_node', '工作流审批节点');
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 8000) { st = (await superState(W)).wfRuns?.['one-to-many']; if (st?.status === 'done') break; await W.page.waitForTimeout(400); }
    must(st?.status === 'done', `批准后状态 ${st?.status}`);
    return '批准后工作流完成；发布仍由你本人在官方 App 内点';
  }],
  ['write-mention', '自由创作一篇 → @平台适配编辑 交办（回复写明交给了谁、花了多少、结果在哪）', async (W) => {
    const before = (await drafts(W)).length;
    await say(W, '写一篇关于通勤时间怎么利用的短文');
    const ds = await drafts(W); must(ds.length === before + 1, `草稿数 ${before} → ${ds.length}`);
    W.memo.child = ds.at(-1);
    await say(W, `@平台适配编辑 把草稿 #${W.memo.child.id} 改成 B 站动态的写法`);
    const last = await W.page.locator('[data-testid="agent-msg"], .msg, [data-role="assistant"]').last().innerText().catch(() => '');
    const msgs = (await idb(W, 'messages')).filter((m) => m.role === 'assistant'); const m = msgs.at(-1)?.content ?? last;
    must(/交给了「平台适配编辑」 · 花了 ¥[\d.]+ · 结果在“指挥 → 任务板”/.test(m), `回复 “${m.slice(0, 80)}”`);
    return `草稿 #${W.memo.child.id}；@ 回复：${m.split('\n')[0]}`;
  }],
  ['copy-publish', '复制去发布：通过 → 复制文案、打开发布页，由用户点“我已发布”', async (W) => {
    const c = W.memo.child;
    await go(W, `agent/drafts/${c.id}`);
    await tid(W, 'approve').click(); await W.page.waitForTimeout(800);
    await tid(W, 'editor-go-publish').click(); await W.page.waitForTimeout(900);
    const popup = W.ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await tid(W, 'send').click(); await W.page.waitForTimeout(3500);
    const p = await popup; if (p) await p.close().catch(() => {});
    if (!W.page.url().includes('#agent')) await go(W, 'agent');
    const clip = await W.page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    must(clip.includes(c.title), '剪贴板里没有标题');
    must((await drafts(W)).find((d) => d.id === c.id).status === 'approved', 'App 自己改了发布状态');
    await tid(W, 'published').click(); await W.page.waitForTimeout(800);
    const st = (await drafts(W)).find((d) => d.id === c.id).status; must(st === 'handed_off', `状态 ${st}`);
    return `复制 ${[...clip].length} 字、打开发布页；用户点“我已发布”后状态 ${st}`;
  }],
  ['import-data', '导入数据：对话录入草稿数据 + 目标数据点（只填用户给的数字）', async (W) => {
    const c = W.memo.child;
    await say(W, `录入草稿 #${c.id} 的数据：阅读 1200 点赞 85 收藏 40`);
    const m = (await idb(W, 'metrics')).find((x) => x.draft_id === c.id); must(m && m.views === 1200 && m.comments === undefined, `metrics ${JSON.stringify(m ?? null)}`);
    await cmd(W, 'goals');
    for (const [val, date] of [['1000', '2026-10-02'], ['1120', '2026-10-20']]) { await tid(W, 'dp-value').fill(val); await tid(W, 'dp-platform').fill('xiaohongshu'); await tid(W, 'dp-date').fill(date); await clickTid(W, 'dp-add', 900); }
    const txt = await tid(W, `goal-progress-${W.memo.goal.id}`).innerText();
    must(/^120/.test(txt.trim()), `目标进度 “${txt}”`);
    return `草稿数据 阅读 1200 / 点赞 85 / 收藏 40；目标进度 ${txt}`;
  }],
  ['weekly-review', '周复盘草稿（只陈述有数据的目标）', async (W) => {
    await cmd(W, 'goals'); await clickTid(W, 'weekly-review', 600);
    const txt = await tid(W, 'weekly-review-text').innerText(); must(/本周复盘/.test(txt) && /依据 2 条数据/.test(txt), `复盘 “${txt.slice(0, 80)}”`);
    return txt.split('\n').filter(Boolean).slice(0, 2).join(' / ');
  }],
  ['pause-all', '一键暂停（≤1 秒停止全部运行；暂停中不能发送）', async (W) => {
    await go(W, 'agent');
    const t0 = Date.now(); await tid(W, 'cmdbar-pause').click();
    await tid(W, 'cmdbar-resume').waitFor({ timeout: 3000 }); const ms = Date.now() - t0;
    const st = await superState(W); must(st.paused === true, '控制平面没有记 paused');
    await tid(W, 'agent-input').fill('写一篇短文'); await tid(W, 'send').click(); await W.page.waitForTimeout(800);
    const body = await W.page.locator('body').innerText(); must(/已全部暂停/.test(body), '暂停中发送没有被拦');
    W.out.pauseMs = ms; must(ms <= 1500, `从点击到界面切换 ${ms} ms`);
    return `点击 → 指挥条变“恢复” ${ms} ms（含界面刷新）；发送被拦`;
  }],
  ['resume', '恢复（只能手动）', async (W) => {
    await tid(W, 'cmdbar-resume').click(); await tid(W, 'cmdbar-pause').waitFor({ timeout: 3000 });
    must((await superState(W)).paused === false, '恢复后仍 paused');
    await W.page.waitForTimeout(300); must(!/已全部暂停：先在指挥条/.test(await W.page.locator('body').innerText()), '恢复后仍显示暂停提示');
    return '指挥条回到“全部暂停”，控制平面 paused=false';
  }],
  ['agent-rollback', '改一次子 Agent（改名，低风险）→ 回滚到上一版', async (W) => {
    await cmd(W, 'team');
    const id = 'platform-adapter';
    const before = (await vfsText(W, `agents/${id}/AGENT.md`));
    await clickTid(W, `agent-edit-${id}`, 500);
    await tid(W, 'agent-edit-name').fill('平台适配编辑（走查改名）'); await clickTid(W, 'agent-edit-save', 1000);
    must(/name: 平台适配编辑（走查改名）/.test(await vfsText(W, `agents/${id}/AGENT.md`)), '改名没保存');
    await clickTid(W, `agent-rollback-${id}`, 1000);
    const after = await vfsText(W, `agents/${id}/AGENT.md`);
    const norm = (x) => x.split('\n').filter((l) => !/^\s*(version|updated):/.test(l)).join('\n').trim();
    must(/name: 平台适配编辑\n/.test(after) && norm(after) === norm(before), `回滚后内容与修改前不一致：${after.split('\n').slice(0, 4).join(' | ')}`);
    return '改名保存为新版本 → 回滚到上一版（历史保留）';
  }],
  ['backup', '备份（导出 zip，不含 Key）', async (W) => {
    await go(W, 'me/data');
    const dl = W.page.waitForEvent('download', { timeout: 15000 });
    await tid(W, 'export-zip').click();
    const d = await dl; const f = path.join(TMP, `${W.dir.split('/').pop()}-backup.zip`); await d.saveAs(f);
    const bytes = fs.statSync(f).size; const raw = fs.readFileSync(f).toString('latin1');
    must(bytes > 1000, `备份 ${bytes} 字节`); must(!/\bsk-[A-Za-z0-9_-]{16,}/.test(raw), '备份里有疑似 Key');
    must(raw.includes('agents/platform-adapter/AGENT.md') && raw.includes('config/super.json'), '备份里没有子 Agent 或控制平面');
    W.memo.backup = f; W.memo.draftCount = (await drafts(W)).length; W.memo.agentCount = (await agentsIn(W)).length;
    return `${path.basename(f)} ${bytes} 字节（含子 Agent、平台、工作流、控制平面）`;
  }],
  ['restore', '从备份恢复', async (W) => {
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(W.memo.backup);
    await W.page.waitForTimeout(2500);
    const n = (await drafts(W)).length; const a = (await agentsIn(W)).length;
    must(n === W.memo.draftCount && a === W.memo.agentCount, `恢复后草稿 ${n}/${W.memo.draftCount}、子 Agent ${a}/${W.memo.agentCount}`);
    return `恢复完成：草稿 ${n} 篇、子 Agent ${a} 个与备份时一致`;
  }],
];

const ONLY = process.argv.includes('--path') ? process.argv[process.argv.indexOf('--path') + 1] : null;
if (!ONLY || ONLY === 'fresh') await runPath('fresh', [
  ['first-open', '首次打开 → 首启引导', async (W) => { must(W.page.url().includes('#onboarding'), `落在 ${W.page.url()}`); return '首启引导'; }],
  ['connect-first', '接入模型（本地模拟服务商）', async (W) => {
    await tid(W, 'vendor-mock').click(); await tid(W, 'connect-next').click(); await W.page.waitForTimeout(900);
    await tid(W, 'connect-finish').click(); await W.page.waitForTimeout(900);
    await tid(W, 'onb-next-2').click(); await W.page.waitForTimeout(500);
    await tid(W, 'onb-finish').click(); await W.page.waitForTimeout(1200);
    must(W.page.url().includes('#agent'), `完成引导后在 ${W.page.url()}`);
    must(await tid(W, 'cmdbar').count() === 1, '首页没有指挥条');
    return '选服务商 → 选模型 → 首页出现指挥条';
  }],
  ...FLOW,
]);
if (!ONLY || ONLY === 'legacy') await runPath('legacy', [
  ['open-skip', '打开 → 跳过引导', async (W) => { await tid(W, 'onb-skip-all').click(); await W.page.waitForTimeout(900); return W.page.url().split('#')[1]; }],
  ['restore-1.1', '用 1.1 备份恢复 → 自动迁移为超级 Agent', async (W) => {
    const f = path.join(TMP, 'content-agent-1.1.0-backup.zip'); fs.writeFileSync(f, backup11());
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(f);
    await W.page.waitForTimeout(3000);
    const ds = await drafts(W); must(ds.some((d) => d.title === '1.1 的旧草稿'), '旧草稿没有恢复');
    must(/指挥职责/.test((await vfsText(W, 'super/SUPER.md')) ?? ''), '没有 super/SUPER.md');
    must(/readonly: true/.test((await vfsText(W, 'platforms/xiaohongshu/PLATFORM.md')) ?? ''), '内置平台没有只读模板');
    const st = await superState(W); must(st.approvals?.some((a) => a.kind === 'core_file' && a.status === 'pending'), 'AGENTS.md 修订建议没进收件箱');
    must(!((await vfsText(W, 'AGENTS.md')) ?? '').includes('super/SUPER.md'), 'AGENTS.md 被直接改了');
    return `恢复 ${fs.statSync(f).size} 字节；迁移：控制平面、指挥职责、内置平台只读模板；AGENTS.md 修订建议待批`;
  }],
  ['me-12', '“我的”仍 ≤12 项、无重复；指挥台是独立入口', async (W) => {
    await go(W, 'me');
    const labels = await W.page.locator('main .row-label, [data-testid="me-index"] .row-label').allInnerTexts();
    must(labels.length > 0 && labels.length <= 12 && new Set(labels).size === labels.length, `入口 ${labels.length}`);
    W.out.meEntries = labels.length;
    await go(W, 'command'); must(await tid(W, 'command-page').count() === 1, '指挥台打不开');
    return `“我的” ${labels.length} 项；#command 正常`;
  }],
  ['p1-approve', '审批收件箱：批准 AGENTS.md 修订建议（P1，用户确认后才写）', async (W) => {
    await approveFirst(W, (x) => x.kind === 'core_file', 'AGENTS.md 修订建议');
    must(((await vfsText(W, 'AGENTS.md')) ?? '').includes('super/SUPER.md'), '批准后 AGENTS.md 没更新');
    return 'AGENTS.md 增加指挥职责引用（author=user_approved）';
  }],
  ...FLOW,
]);

await browser.close(); srv.close();
fs.mkdirSync(path.join(ROOT, 'docs/walkthrough'), { recursive: true });
const RP = path.join(ROOT, 'docs/walkthrough/walkthrough-v1.2.json');
if (ONLY) { const prev = JSON.parse(fs.existsSync(RP) ? fs.readFileSync(RP, 'utf8') : '{"paths":{}}'); report.paths = { ...prev.paths, ...report.paths }; }
fs.writeFileSync(RP, JSON.stringify(report, null, 1));
const sum = Object.entries(report.paths).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}${v.consoleErrors || v.pageErrors ? ` 控制台错误 ${v.consoleErrors + v.pageErrors}` : ''}`).join('；');
console.log(`\nwalkthrough：${sum} → ${OUT}`);
process.exit(Object.values(report.paths).every((p) => p.ok) ? 0 : 1);
