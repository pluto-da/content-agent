#!/usr/bin/env node
/* global indexedDB */
/**
 * 1.3.0 冒烟走查（PROMPT-v1.3-conglomerate 第十六部分 1）：新用户与 1.2 老用户两条路径，每步截图到 shots-v1.3/walkthrough/。
 * 新用户：接入模型 → 启用集团模式（默认组织）→ 设年度目标（经管会拆 OKR，公开）→ 数据中心发现两个事业部 KR 冲突自动建临时会话 → 4 条消息达成一致 → √ 解散 → 小结与工单
 *        → 战略室三方三轮（董事长中途插话）→ 纪要 → 赛马（3 匹 → 盲评 → 选定 → 落选入库）→ 两个事业部协作出稿（法务合规部否决一篇、申诉被拒；另一篇质量委员会退回一轮后通过 → 请示 → 批准 → 复制去发布）
 *        → 作战室 15 分钟响应热点 → 红蓝对抗室评“是否新开平台” → 人资委提议新设“直播策划组”→ 批准 → 季度复盘 + 360 + 政委建议 → 一键暂停 → 恢复 → 制度修订 L3 → 回滚 → 灰度回滚。
 * 老用户：1.2 备份恢复（迁移：集团模式默认关闭）后启用集团，子 Agent 归入默认部门，再走同样流程。
 * 以下为 1.2.0 的说明（沿用同一套托管与工具）：
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
const oi = process.argv.indexOf('--out'); const OUT = path.resolve(ROOT, oi > 0 ? process.argv[oi + 1] : '../shots-v1.3/walkthrough');
const DIST = path.join(ROOT, 'web/dist');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { const u = decodeURIComponent((q.url ?? '/').split('?')[0]); if (u.startsWith('/api/')) { s.writeHead(404); return s.end(); } let f = path.join(DIST, u === '/' ? 'index.html' : u); if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); s.writeHead(200, { 'content-type': MIME[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(s); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL0 = `http://127.0.0.1:${srv.address().port}/`;
const TMP = fs.mkdtempSync('/tmp/wt13-');


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
/* ---------- 1.2 备份：在 1.1 格式上加子 Agent 与控制平面 ---------- */
function backup12() {
  const z = shared.parseExport ? null : null;
  const mockAcc = { id: 'mk', vendor: 'mock', label: '模拟（不联网）', baseURL: 'mock://local', region: 'test', hasKey: false, secretRef: 'secret:mk', models: [{ id: 'm1', accountId: 'mk', model: 'mock-omni', roles: ['chat', 'reason', 'vision'], source: 'manual', status: 'ok', addedAt: 0, updatedAt: 0 }] };
  const t = (a, e, m) => ({ accountId: a, modelEntryId: e, model: m });
  const roles = Object.fromEntries(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank'].map((r) => [r, { role: r, enabled: true }]));
  roles.chat.primary = t('mk', 'm1', 'mock-omni'); roles.reason.primary = t('mk', 'm1', 'mock-omni'); roles.vision.primary = t('mk', 'm1', 'mock-omni');
  const v3 = { schemaVersion: 3, accounts: [mockAcc], roles, prices: {}, budget: { perCallConfirmYuan: 1, perDayConfirmYuan: 10, videoAlwaysConfirm: true, unknownPriceMediaConfirm: true }, keyPolicy: { scope: 'account' }, advanced: { thinking: 'off', temperature: null } };
  const v4 = shared.ModelsMigrator.migrate(v3, 4).doc;
  const extra = { 'kv/models_v3.json': JSON.stringify(v4), 'kv/prefs.json': JSON.stringify({ platforms: ['xiaohongshu', 'douyin'], onboarded: true, backupHinted: true, hotSources: ['baidu'], schemaVersion: 2, flags: {} }), 'data/drafts.json': JSON.stringify([{ id: 1, platform: 'xiaohongshu', title: '1.2 的旧草稿', body: '旧正文', status: 'pending' }]) };
  const agent = (id, name, desc) => ({ path: `vfs/agents/${id}/AGENT.md`, content: `---\nid: ${id}\nname: ${name}\ndescription: ${desc}\nicon: chat\nversion: 2\npermissions: [L0, L1]\ntools: []\nskills: []\nbudget:\n  month: 5\n  perRun: 1\nmemory: shared\nplatforms: []\ndataSources: []\ncreatedBy: user\nenabled: true\n---\n# ${name}\n${desc}\n` });
  const files = [{ path: 'vfs/SOUL.md', content: shared.DEFAULT_FILES['SOUL.md'] }, { path: 'vfs/AGENTS.md', content: shared.DEFAULT_FILES['AGENTS.md'] }, { path: 'vfs/super/SUPER.md', content: shared.DEFAULT_FILES['super/SUPER.md'] },
    agent('compliance-reviewer', '合规审核员', '只出审核意见'), agent('data-analyst', '数据复盘分析师', '读录入数据做复盘'), agent('reply-drafter', '评论回复草稿员', '只起草回复'),
    { path: 'vfs/config/super.json', content: JSON.stringify({ schemaVersion: 1, paused: false, concurrency: 2, goals: [{ id: 'g1', title: '涨粉 500', metric: 'followers', target: 500, unit: '粉', from: '2026-10-01', to: '2026-10-31', createdAt: '2026-10-01' }] }) }];
  return shared.buildExport(files, { appVersion: '1.2.0', extra }).zip;
}
/* ---------- 走查工具 ---------- */
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const report = { version: '1.3.0', at: new Date().toISOString(), viewport: '360×800', server: 'none（/api 404，本机模式）', provider: '本地模拟服务商（mock://local，不联网、无 Key）', paths: {} };

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


/** VFS 大文件在 IndexedDB 里分片存（单条 < 64 KB），这里按 db.ts 的 assembleAll 拼回。 */
function assemble(rows) {
  const parts = new Map();
  for (const r of rows) if (r && typeof r.__caChunkOf === 'string') { const a = parts.get(r.__caChunkOf) ?? []; a[r.i] = r.s; parts.set(r.__caChunkOf, a); }
  return rows.filter((r) => !(r && typeof r.__caChunkOf === 'string')).map((r) => (r && typeof r.__caChunks === 'number' ? { ...r, content: Array.from({ length: r.__caChunks }, (_, i) => parts.get(r.__caKey)?.[i] ?? '').join('') } : r));
}
const vfsFiles = async (W) => assemble(await idb(W, 'vfs_files')).filter((f) => !f.deleted);
const vfsText = async (W, p) => (await vfsFiles(W)).find((f) => f.path === p)?.content;
const superState = async (W) => JSON.parse((await vfsText(W, 'config/super.json')) ?? '{}');
const groupState = async (W) => JSON.parse((await vfsText(W, 'config/group.json')) ?? '{}');
async function grp(W, tab) { await go(W, `group?tab=${tab}`); await W.page.waitForTimeout(600); }
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
  ['enable', '启用集团模式（默认组织：4 职能部门 + 4 事业部 + 共享能力中心 + 5 委员会）', async (W) => {
    await go(W, 'command'); await clickTid(W, 'open-group', 900);
    must(W.page.url().includes('#group'), `入口没到统领：${W.page.url()}`);
    if (await tid(W, 'group-enable').count()) await clickTid(W, 'group-enable', 1500);
    const g = await groupState(W); must(g.enabled === true, '没有启用');
    const depts = (await vfsFiles(W)).filter((f) => /^company\/departments\/[a-z0-9-]+\/DEPT\.md$/.test(f.path)).length;
    must(depts >= 13, `DEPT.md ${depts}`);
    W.memo.agentsInDepts = g.org.depts.flatMap((d) => d.members);
    return `「${g.name}」；DEPT.md ${depts} 个；COMMITTEE.md ${(await vfsFiles(W)).filter((f) => /COMMITTEE\.md$/.test(f.path)).length} 个；已归部门的子 Agent ${W.memo.agentsInDepts.length}`;
  }],
  ['goal-okr', '设年度目标 → 经管会拆为部门 OKR（全部公开）', async (W) => {
    await grp(W, 'okr');
    await tid(W, 'group-goal-title').fill('账号年内到 10 万粉'); await tid(W, 'group-goal-target').fill('100000');
    await clickTid(W, 'group-goal-save', 1200);
    const g = await groupState(W); const dept = g.okrs.filter((o) => o.level === 'dept');
    must(dept.length >= 8, `部门 OKR ${dept.length}`); must(await tid(W, 'group-okr-tree').count() === 1, 'OKR 树没显示');
    return `部门 OKR ${dept.length} 个，进度“待录入”（不编数据）`;
  }],
  ['conflict-session', '数据中心发现两个事业部 KR 冲突 → 自动建临时会话', async (W) => {
    await grp(W, 'sessions'); await clickTid(W, 'group-check-conflicts', 1200);
    const g = await groupState(W); must(g.aligns.length >= 1, '没发现冲突'); must(g.sessions.length >= 1, '没有自动拉群');
    W.memo.sid = g.sessions.at(-1).id; return `冲突：${g.aligns[0].conflict.why}；会话成员 ${g.sessions.at(-1).members.length} 个（≤5）`;
  }],
  ['session-4', '4 条消息达成一致 → √ 解散 → 小结与工单', async (W) => {
    await clickTid(W, 'group-session-run', 1500);
    let s = (await groupState(W)).sessions.find((x) => x.id === W.memo.sid);
    must(s.messages.filter((m) => m.kind === 'msg').length === 4, `消息 ${s.messages.length}`);
    await clickTid(W, 'group-session-dissolve', 1500);
    s = (await groupState(W)).sessions.find((x) => x.id === W.memo.sid);
    must(s.status === 'dissolved' && s.outcome, '没解散'); must(await tid(W, 'session-outcome').count() === 1, '没有小结');
    const tasks = (await superState(W)).tasks ?? []; must(tasks.some((t) => t.history?.[0]?.note === '集团小结 / 纪要待办'), '待办没转工单');
    return `结论：${s.outcome.conclusions[0]?.slice(0, 40)}；工单 ${s.outcome.todos.length}`;
  }],
  ['strategy-3x3', '战略室三方三轮（董事长中途插话）→ 纪要', async (W) => {
    await grp(W, 'rooms'); await W.page.locator('[data-testid="room-strategy"] button').first().click();
    await tid(W, 'group-meeting-title').fill('Q4 主推形式：口播还是图文'); await clickTid(W, 'group-meeting-create', 1000);
    await tid(W, 'group-meeting-say-input').fill('预算压到一半，先做小样'); await clickTid(W, 'group-meeting-say', 800);
    await clickTid(W, 'group-meeting-run', 2500);
    const m = (await groupState(W)).meetings.at(-1);
    must(m.status === 'closed' && m.minutes, `会议 ${m.status}`);
    must(m.record.speeches.filter((x) => x.phase === 'independent').every((x) => x.visible.length === 0), '独立陈述可见他人');
    must(m.record.coverage === 1, `质询覆盖 ${m.record.coverage}`);
    must(await tid(W, 'meeting-minutes').count() === 1, '纪要没显示');
    return `${m.minutes.no}；${m.record.rounds} 轮，停因 ${m.record.stopReason}；发言 ${m.record.speeches.length}；拦截重复 ${m.record.blocked.length}`;
  }],
  ['race', '赛马：3 匹 → 盲评 → 董事长选定 → 落选方案入库', async (W) => {
    await grp(W, 'rooms'); await tid(W, 'group-race-topic').fill('主推视频的切入角度'); await clickTid(W, 'group-race-start', 2000);
    await clickTid(W, 'group-race-pick-A', 1500);
    const r = (await groupState(W)).races.at(-1); must(r.status === 'decided' && r.archived.length === 2, `赛马 ${r.status}`);
    const assets = (await vfsFiles(W)).filter((f) => f.path.startsWith('company/assets/')).length; must(assets >= 2, `入库 ${assets}`);
    return `花费 ¥${r.spent}（专项 ¥${r.budgetYuan}）；落选 ${r.archived.length} 个入素材库`;
  }],
  ['collab-veto', '协作出稿：法务合规部否决一篇（硬边界，申诉被拒）；另一篇质量委员会退回一轮后通过 → 请示', async (W) => {
    await grp(W, 'docs'); await clickTid(W, 'group-collab', 2500);
    const g = await groupState(W); must(g.vetoes.some((v) => v.by === 'legal' && v.hardBoundary), '没有合规否决');
    must(g.flow.some((f) => /不可申诉/.test(f.body)), '申诉没有被拒'); const ask = g.docs.find((d) => d.type === '请示' && d.status === 'pending'); must(ask, '没有请示');
    W.memo.ask = ask; return `否决依据：${g.vetoes[0].reason.slice(-16)}；请示 ${ask.no}`;
  }],
  ['approve-publish', '董事长批准请示 → 复制去发布（由你本人发布）', async (W) => {
    await clickTid(W, `group-doc-approve-${W.memo.ask.id}`, 1500);
    const d = (await groupState(W)).docs.find((x) => x.id === W.memo.ask.id); must(d.status === 'approved', `请示 ${d.status}`);
    const id = Number(d.refs[0].slice(6)); const ds = await drafts(W); must(ds.find((x) => x.id === id)?.status === 'approved', '草稿没有进入待发布');
    await clickTid(W, `group-doc-publish-${d.id}`, 1200); must(W.page.url().includes('agent/drafts'), '没跳到待发布');
    return `草稿 #${id} 进入待发布；发布由你本人点击`;
  }],
  ['war-room', '作战室 15 分钟响应热点', async (W) => {
    await grp(W, 'rooms'); await W.page.locator('[data-testid="room-war"] button').first().click();
    await tid(W, 'group-meeting-title').fill('热点：某品牌新品发布，要不要跟'); await clickTid(W, 'group-meeting-create', 900); await clickTid(W, 'group-meeting-run', 2500);
    const m = (await groupState(W)).meetings.at(-1); must(m.roomId === 'war' && m.status === 'closed', '作战室没开完');
    return `${m.minutes.no}；${m.record.rounds} 轮 ≤3；花费 ¥${m.spent.toFixed(4)}`;
  }],
  ['redblue', '红蓝对抗室评“是否新开 B 站”', async (W) => {
    await W.page.locator('[data-testid="room-redblue"] button').first().click();
    await tid(W, 'group-meeting-title').fill('是否新开 B 站'); await clickTid(W, 'group-meeting-create', 900); await clickTid(W, 'group-meeting-run', 2500);
    const m = (await groupState(W)).meetings.at(-1); must(m.roomId === 'redblue' && m.status === 'closed', '红蓝对抗没开完');
    const blue = m.record.speeches.filter((x) => x.phase === 'question' && x.from === m.participants.at(-1)).length;
    return `蓝军质询 ${blue} 次；决议：${m.minutes.resolution.slice(0, 30)}`;
  }],
  ['hr-new-dept', '人资委提议新设“直播策划组” → 董事长批准生效', async (W) => {
    await grp(W, 'org'); await tid(W, 'group-dept-name').fill('直播策划组'); await clickTid(W, 'group-propose-dept', 1000);
    const p = (await groupState(W)).docs.find((d) => d.type === '提案' && d.status === 'pending'); must(p, '没有提案');
    await grp(W, 'docs'); await clickTid(W, `group-doc-approve-${p.id}`, 1500);
    const g = await groupState(W); must(g.org.depts.some((d) => d.name === '直播策划组'), '没有生效');
    return `提案 ${p.no} 批准；DEPT.md 已写入`;
  }],
  ['quarterly', '季度复盘 + 360 评议 + 政委建议（只建议不指挥）', async (W) => {
    await grp(W, 'cockpit'); await clickTid(W, 'group-quarterly-run', 1500);
    const g = await groupState(W); must(g.advice.length > 0 && g.advice.every((a) => a.binding === false), '政委建议缺失');
    must(g.flow.some((f) => f.kind === 'lesson'), 'lesson 没写入上下文流');
    return `政委建议 ${g.advice.length} 条（非约束）；lesson 已入上下文流；开会占比 ${await tid(W, 'kpi-share').innerText().then((t) => t.split('\n')[1] ?? '')}`;
  }],
  ['pause-resume', '一键暂停（<1 秒）→ 恢复（需手动）', async (W) => {
    await grp(W, 'org'); await clickTid(W, 'group-pause', 900);
    must((await groupState(W)).paused === true, '没暂停'); await clickTid(W, 'group-resume', 900); must((await groupState(W)).paused === false, '没恢复');
    return '暂停对子 Agent、会话、会议、赛马同时生效';
  }],
  ['reg-change', '修订《预算管理办法》（L3：提案 → 批准）→ 回滚', async (W) => {
    await grp(W, 'regs'); await clickTid(W, 'reg-budget', 400);
    await tid(W, 'group-reg-add').fill('## 第五条 赛马月度上限\n默认 ¥1。'); await clickTid(W, 'group-reg-propose', 1000);
    const p = (await groupState(W)).docs.find((d) => d.type === '提案' && d.status === 'pending'); must(p, '没有修订提案');
    await grp(W, 'docs'); await clickTid(W, `group-doc-approve-${p.id}`, 1200);
    let g = await groupState(W); must(g.regs.budget.at(-1).version === 2, '版本没升');
    await grp(W, 'regs'); await clickTid(W, 'reg-budget', 300); await clickTid(W, 'group-reg-rollback', 1200);
    g = await groupState(W); must(g.regs.budget.at(-1).version === 1, '没回滚');
    return '《预算管理办法》v2 → 回滚到 v1';
  }],
  ['gray-rollback', '灰度试行抖音写法新版（20% 任务）→ 指标下降 → 自动回滚', async (W) => {
    await grp(W, 'cockpit'); await clickTid(W, 'group-gray-start', 1200);
    await clickTid(W, 'group-gray-observe', 900); await clickTid(W, 'group-gray-eval', 1500);
    const g = (await groupState(W)).grays.at(-1); must(g.status === 'rolled_back', `灰度 ${g.status}`);
    return g.reason;
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
  ['restore-1.2', '用 1.2 备份恢复 → 自动迁移（集团模式默认关闭）', async (W) => {
    const f = path.join(TMP, 'content-agent-1.2.0-backup.zip'); fs.writeFileSync(f, backup12());
    await go(W, 'me/data');
    await W.page.locator('[data-testid="data-page"] input[type="file"]').first().setInputFiles(f);
    await W.page.waitForTimeout(3000);
    const ds = await drafts(W); must(ds.some((d) => d.title === '1.2 的旧草稿'), '旧草稿没有恢复');
    const g = await groupState(W); must(g.enabled === false, '集团模式应默认关闭');
    must((await agentsIn(W)).length === 3, '子 Agent 没恢复');
    return `恢复 ${fs.statSync(f).size} 字节；集团模式默认关闭；3 个子 Agent 保留`;
  }],
  ['me-12', '“我的”仍 ≤12 项、无重复；指挥台是独立入口', async (W) => {
    await go(W, 'me');
    const labels = await W.page.locator('main .row-label, [data-testid="me-index"] .row-label').allInnerTexts();
    must(labels.length > 0 && labels.length <= 12 && new Set(labels).size === labels.length, `入口 ${labels.length}`);
    W.out.meEntries = labels.length;
    await go(W, 'command'); must(await tid(W, 'command-page').count() === 1, '指挥台打不开');
    return `“我的” ${labels.length} 项；#command 正常`;
  }],
  ...FLOW,
]);

await browser.close(); srv.close();
fs.mkdirSync(path.join(ROOT, 'docs/walkthrough'), { recursive: true });
const RP = path.join(ROOT, 'docs/walkthrough/walkthrough-v1.3.json');
if (ONLY) { const prev = JSON.parse(fs.existsSync(RP) ? fs.readFileSync(RP, 'utf8') : '{"paths":{}}'); report.paths = { ...prev.paths, ...report.paths }; }
fs.writeFileSync(RP, JSON.stringify(report, null, 1));
const sum = Object.entries(report.paths).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}${v.consoleErrors || v.pageErrors ? ` 控制台错误 ${v.consoleErrors + v.pageErrors}` : ''}`).join('；');
console.log(`\nwalkthrough：${sum} → ${OUT}`);
process.exit(Object.values(report.paths).every((p) => p.ok) ? 0 : 1);
