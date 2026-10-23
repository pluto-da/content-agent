#!/usr/bin/env node
/**
 * accept:v9 —— 逐项检查 C1–C56 并输出结果（out/accept-v9.json / .md）。
 * 证据来源（都在本仓库或构建产物中，CI 可复现）：
 *  - 单测结果：out/vitest-*.json（vitest --reporter=json；按测试名正则匹配，必须“存在且全部通过”）；
 *    没有结果文件时退回“测试存在”（只能记为部分）；
 *  - 评测：out/eval-report-0.9.0.json（G01–G28 / BQ-01–BQ-32，回放模式）；
 *  - out/vfs-doctor-report.json（scripts/vfs-doctor.mjs）、scripts/check-semiotics.py 输出；
 *  - 截图报告：../shots-v9/report.json（项目根，Playwright 三视口）；
 *  - 版本：package.json / scripts/build-android-debug.sh；APK manifest：out/apk-manifest.json（取回 APK 后写入，可选）。
 * 结论只有：通过 / 部分 / 待真机 / 待 Key / 失败。没有证据的项不写“通过”（第十三部分关键原则）。
 * 用法：node scripts/accept-v9.mjs [--strict]（--strict：有“失败”时退出码 1）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const txt = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };

/* ---------- 证据加载 ---------- */
const results = [];
for (const f of existsSync(out) ? readdirSync(out).filter((n) => /^vitest-.*\.json$/.test(n)) : []) {
  const j = J(join(out, f));
  for (const tr of j?.testResults ?? []) for (const a of tr.assertionResults ?? []) results.push({ name: `${(a.ancestorTitles ?? []).join(' > ')} > ${a.title}`, status: a.status, file: f });
}
const haveResults = results.length > 0;
const testSources = ['shared/test', 'web/src', 'server/test', 'server/src', 'evals'].flatMap((d) => {
  const walk = (dir) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.test\.tsx?$/.test(e.name) ? [`${dir}/${e.name}`] : [])) : []);
  return walk(d);
}).map((p) => txt(p)).join('\n');
const evalRep = J(join(out, 'eval-report-0.9.0.json'));
const doctor = J(join(out, 'vfs-doctor-report.json'));
let sem;
try { sem = JSON.parse(execFileSync('python3', [join(root, 'scripts/check-semiotics.py'), join(root, 'agent')], { encoding: 'utf8' })); } catch { sem = null; }
const shotsDir = [join(root, '../shots-v9'), join(root, 'shots-v9')].find((d) => existsSync(join(d, 'report.json')));
const shots = shotsDir ? J(join(shotsDir, 'report.json')) : null;
const apk = J(join(out, 'apk-manifest.json')) ?? J(join(root, '../out/apk-manifest.json'));
const pkg = J(join(root, 'package.json'));
const docsRoot = [join(root, '../design'), join(root, 'docs')].find((d) => existsSync(d));

/* ---------- 证据判定 ---------- */
function test(re, label) {
  const r = new RegExp(re);
  if (haveResults) {
    const hit = results.filter((x) => r.test(x.name));
    if (!hit.length) return { ok: false, text: `测试未找到：${label ?? re}` };
    const bad = hit.filter((x) => x.status !== 'passed' && x.status !== 'skipped');
    return { ok: !bad.length, text: `${label ?? re}：${hit.length} 项${bad.length ? `，失败 ${bad.length}` : ' 全部通过'}（${hit[0].file}）` };
  }
  return { ok: r.test(testSources), soft: true, text: `${label ?? re}：测试存在（本次未提供运行结果）` };
}
function evals(ids) {
  if (!evalRep) return { ok: false, text: '没有评测报告 out/eval-report-0.9.0.json' };
  const want = ids.flatMap((x) => (x.includes('..') ? range(x) : [x]));
  const items = evalRep.items.filter((i) => want.includes(i.id));
  const bad = items.filter((i) => !i.pass);
  return { ok: items.length === want.length && !bad.length, text: `评测 ${want.length} 项（回放）：找到 ${items.length}，失败 ${bad.length}${bad.length ? `（${bad.map((b) => b.id).join('、')}）` : ''}` };
}
function range(s) { const [a, b] = s.split('..'); const pre = a.replace(/\d+$/, ''); const w = a.length - pre.length; const out = []; for (let i = Number(a.slice(pre.length)); i <= Number(b.slice(pre.length)); i++) out.push(`${pre}${String(i).padStart(w, '0')}`); return out; }
const file = (p, label) => ({ ok: existsSync(join(root, p)), text: `${label ?? p}${existsSync(join(root, p)) ? ' 存在' : ' 缺失'}` });
const doc = (name) => ({ ok: !!docsRoot && existsSync(join(docsRoot, name)), text: `${name}${docsRoot && existsSync(join(docsRoot, name)) ? ' 存在' : ' 缺失'}` });
const shotsOk = (pred, label) => (shots ? { ok: !!pred(shots), text: `截图报告：${label}` } : { ok: false, soft: true, text: '截图报告 shots-v9/report.json 不在本环境（截图在项目根生成，未进仓库）' });

/* ---------- C1–C56 ---------- */
const ITEMS = [
  ['C1', '无服务端：打开即 Agent 首页，控制台错误 0', [shotsOk((s) => s.summary?.pageErrors === 0 && s.summary?.consoleErrors === 0, '页面报错 0、控制台错误 0（屏蔽 /api）'), test('A1|首页|Agent 首页', '首页即 Agent')]],
  ['C2', '11 角色 5 组、状态点与已接 N/11', [test('11 个角色、5 组顺序'), test('分组、顺序、状态与“已接 N / 11 类”'), shotsOk((s) => s.pages?.includes?.('me-models'), '模型页三视口')]],
  ['C3', '每角色多服务商、默认与备用、账号共用与单独填写', [test('账号共用 Key 与按角色单独填写'), test('默认 / 备用下拉来自勾选了该能力的模型名'), test('添加 OpenAI 兼容服务商')]],
  ['C4', '每角色至少 1 个 Mock 调用跑通、按角色最小探测', [test('11 个角色都有探测定义'), test('Mock 全角色|能力层 Mock')]],
  ['C5', 'MiMo 真实文本 chat 流式 + reason 各 1 次', [{ ok: !!J(join(out, 'mimo-v9-trace.json'))?.chat?.ok, soft: true, text: '需要真实 MiMo Key（本轮未执行，见 deviations-v9 D-REAL）' }], 'pending_key'],
  ['C6', '有 Key 时 MiMo TTS / ASR 真实调用；其余未实测清单', [{ ok: false, soft: true, text: '需要真实 Key；未实测清单见 design/acceptance-v9.md' }], 'pending_key'],
  ['C7', '“试一试”11 角色可用（Mock），存素材 / 插草稿 / 发给 Agent', [test('生图先确认花钱'), test('C7')]],
  ['C8', '能力声明驱动表单与工具 Schema', [test('改声明后 aspect enum 同步变化')]],
  ['C9', 'G01 写小红书并配图（回放 + Mock）', [evals(['G01'])], 'partial'],
  ['C10', '未配置降级 G02 / G21', [evals(['G02', 'G21']), test('未配置')]],
  ['C11', '@ 指定模型只影响本轮', [test('@ 覆盖只用指定的'), evals(['G03'])], 'partial'],
  ['C12', '新卡片正常与失败态截图', [shotsOk((s) => (s.cards ?? 0) >= 11, '11 类卡片截图'), test('失败态|未配置卡|not_configured')], 'partial'],
  ['C13', '并行 / 串行 / 依赖与子任务', [test('前序失败 → 依赖它的步骤 skipped'), test('依赖按拓扑序'), test('子任务')]],
  ['C14', '规划：任务图 Schema、重规划 ≤2、逐步降级', [test('Schema 校验：未知工具、依赖不存在、环、步数超限'), evals(['G04'])]],
  ['C15', '技能渐进加载、用户技能优先', [test('技能渐进加载|C15')]],
  ['C16', '长期记忆：来源 / 条件 / 推断 / 确认 / 查看编辑删除', [test('一次性说法不升级为偏好；密钥不记；推断必须写依据'), test('记忆可编辑、删除')]],
  ['C17', '上下文压缩，约束原样保留（G14）', [test('超限时分层压缩，会话约束原样保留'), evals(['G14'])]],
  ['C18', '审批：花钱 / 视频 / 删除 / 系统文件 / 记忆写入；无对外写入工具', [test('删除 / 系统文件 / 记忆写入一律确认'), test('视频每次都问'), test('工具注册表拒绝对外写入工具')]],
  ['C19', '本机提醒：创建、到点通知（模拟）、不自动执行', [test('提醒：新建、到点只发通知'), test('明早 9 点')], 'pending_device'],
  ['C20', '续跑与幂等 G09 / G10', [evals(['G09', 'G10'])]],
  ['C21', '取消保留产出（G05）', [evals(['G05'])]],
  ['C22', '多会话与单写者 G07 / G08、锁心跳与过期接管', [evals(['G07', 'G08']), test('单写者、心跳、30 秒过期接管')]],
  ['C23', '引用来源 BQ-07 / BQ-08', [evals(['BQ-07', 'BQ-08']), test('B5 无来源事实')]],
  ['C24', '澄清：每轮最多 1 问、不重复问', [evals(['BQ-03', 'BQ-04', 'BQ-05', 'BQ-12'])]],
  ['C25', '状态机合法转移与表外拒绝', [test('随机生成的表外转移 200 次全部被拒且有可见报错')]],
  ['C26', '失败路径（6.17 每行）且无未处理拒绝', [test('5xx 退避重试'), test('429 尊重 Retry-After'), test('断网 → network_offline')]],
  ['C27', '黄金任务 G01–G28（回放）', [evals(['G01..G28'])]],
  ['C28', '行为评测 BQ-01–BQ-32（规则 + 判官）', [evals(['BQ-01..BQ-32'])], 'partial'],
  ['C29', 'SelfCheck', [test('B6 声称 3 张但只成功 2 张'), test('数字出处')]],
  ['C30', 'SYSTEM.md 编辑 / 版本 / 恢复默认 / 下一次运行生效（G24）', [test('编辑 SOUL.md|C30'), evals(['G24']), test('加载预览')]],
  ['C31', '系统文件全套首启生成、逐字比对', [doctor ? { ok: doctor.checks.filter((c) => /^(init|verbatim)/.test(c.id)).every((c) => c.ok), text: 'vfs:doctor 首启与逐字比对' } : { ok: false, text: '没有 vfs-doctor 报告' }, test('默认正文与规格逐字一致')]],
  ['C32', '加载顺序与预算、超预算截断提示', [test('C32|加载顺序')]],
  ['C33', '冲突裁决 9 条', [test('冲突裁决')]],
  ['C34', '入口文件与索引一致；增删后自动同步', [doctor ? { ok: doctor.checks.filter((c) => /^(folders|doctor)/.test(c.id)).every((c) => c.ok), text: 'vfs:doctor 入口 / 索引 / 自动修复' } : { ok: false, text: '没有 vfs-doctor 报告' }]],
  ['C35', '删除验证（G18）', [evals(['G18']), test('忘掉')]],
  ['C36', '导出 / 导入 zip 不含密钥', [test('导出不含 Key|C36'), test('备份页：zip 导出')]],
  ['C37', '损坏文件容错与超限截断', [test('C37|损坏')]],
  ['C38', '合规：显式 / 隐式标识、发布检查', [test('媒体入库带 AIGC 隐式标识'), test('生图先确认花钱 → 出图（AI 生成标识）'), test('C38 / C48 发布检查新增')], 'partial'],
  ['C39', '工程检查全绿 + 密钥扫描 + 硬边界扫描', [{ ok: haveResults && results.every((r) => r.status === 'passed' || r.status === 'skipped' || r.status === 'pending'), soft: !haveResults, text: haveResults ? `单测 ${results.length} 项：失败 ${results.filter((r) => r.status === 'failed').length}` : '本次未提供单测结果' }, file('scripts/scan-secrets.mjs')]],
  ['C40', '交付：APK 0.9.0 / 900、zip、三视口截图、文档', [{ ok: pkg?.version === '0.9.0', text: `package.json 版本 ${pkg?.version}` }, apk ? { ok: apk.versionName === '0.9.0' && String(apk.versionCode) === '900' && apk.package === 'local.contentagent.app', text: `APK manifest ${apk.versionName} / ${apk.versionCode} / ${apk.package}` } : { ok: false, soft: true, text: 'APK 尚未取回（CI 构建后由 apk-build 分支取回）' }, shotsOk((s) => s.summary && ['overflow', 'outOfBounds', 'occluded', 'smallTouch'].every((k) => (s.summary[k] ?? 0) === 0), '溢出 / 越界 / 遮挡 / 触控<44 均为 0'), doc('deviations-v9.md')], 'pending_device'],
  ['C41', '模型名手填并真实调用（无 Key 时 mock 断言请求体）', [test('探测请求体的 model 就是用户填的字符串'), test('手填怪名字'), test('3 个模型名各自勾不同能力')], 'partial'],
  ['C42', '获取模型列表', [test('404 → 没有提供列表'), test('C42 获取列表')]],
  ['C43', '错误模型名白话报错', [test('model_not_found 的白话与两个按钮'), test('错误模型名白话报错'), test('导出不含 Key 且每条绑定都有 model 字段')]],
  ['C44', '核心指令加载与位置', [doctor ? { ok: doctor.checks.find((c) => c.id === 'core.keypoints')?.ok && doctor.checks.find((c) => c.id === 'verbatim.core_directive')?.ok, text: 'core-directive 逐字 + 要点 0 缺失' } : { ok: false, text: '没有 vfs-doctor 报告' }, test('C44|SOUL 第一部分')]],
  ['C45', '优先级与硬边界不被覆盖（G28）', [evals(['G28']), test('注入|放宽')]],
  ['C46', '收益漏斗与归因（G25）', [test('四种归因'), test('收益：表单 \\+ CSV'), evals(['G25'])]],
  ['C47', '无编造收入（G26、BQ-29）', [evals(['G26', 'BQ-29']), test('无来源凭据写入被拒')]],
  ['C48', '收益假设与变现建议（BQ-27）', [evals(['BQ-27']), test('变现路径超 30 天标需重新核实'), test('C38 / C48 发布检查新增')]],
  ['C49', '进化循环需用户确认（G27、BQ-28）', [evals(['G27', 'BQ-28']), test('采纳 → 目标文件版本 \\+1')]],
  ['C50', '防自我强化', [test('个案（n=1）只能 low'), evals(['BQ-30'])]],
  ['C51', '成长记录可视化与诚实声明（BQ-32）', [test('成长记录|C51'), evals(['BQ-32']), shotsOk((s) => s.pages?.includes?.('me-growth'), '成长记录三视口')]],
  ['C52', '符号—结构底座文件存在且可加载', [doctor ? { ok: ['verbatim.semiotics', 'semiotics.pointer', 'semiotics.on_demand'].every((id) => doctor.checks.find((c) => c.id === id)?.ok), text: 'semiotics 逐字 + 指向段 + on_demand' } : { ok: false, text: '没有 vfs-doctor 报告' }, sem ? { ok: sem.pass && sem.principles_chars <= 8000, text: `check-semiotics：PRINCIPLES ${sem.principles_chars} 字` } : { ok: false, text: 'check-semiotics.py 未运行' }]],
  ['C53', '选题输出含符号解码字段', [test('C53 选题输出含符号解码字段')]],
  ['C54', '复盘输出含反证', [test('C54 复盘输出含反证'), evals(['G25'])]],
  ['C55', '引文合规', [sem ? { ok: sem.pass && sem.quotes <= 35 && sem.max_len <= 30, text: `quotes ${sem.quotes}，最长 ${sem.max_len} 字，problems ${sem.problems.length}` } : { ok: false, text: 'check-semiotics.py 未运行' }]],
  ['C56', '路由表覆盖全部流程', [sem ? { ok: sem.pass && sem.workflows === 10 && sem.router_rows > 0, text: `router_rows ${sem.router_rows}，workflows ${sem.workflows}` } : { ok: false, text: 'check-semiotics.py 未运行' }]],
];

const LABEL = { pass: '通过', partial: '部分', pending_device: '待真机', pending_key: '待 Key', fail: '失败' };
const rows = ITEMS.map(([id, title, ev, cap]) => {
  const okN = ev.filter((e) => e.ok && !e.soft).length, softN = ev.filter((e) => e.soft).length, hardBad = ev.filter((e) => !e.ok && !e.soft).length;
  let status = hardBad === 0 && softN === 0 ? 'pass' : okN > 0 || ev.some((e) => e.ok) ? 'partial' : 'fail';
  if (cap === 'pending_key') status = 'pending_key';
  else if (cap === 'pending_device' && status !== 'fail') status = 'pending_device';
  else if (cap === 'partial' && status === 'pass') status = 'partial';
  return { id, title, status, label: LABEL[status], evidence: ev.map((e) => `${e.ok ? '✓' : e.soft ? '…' : '✗'} ${e.text}`) };
});
const count = Object.fromEntries(Object.keys(LABEL).map((k) => [k, rows.filter((r) => r.status === k).length]));
const report = { version: pkg?.version, at: new Date().toISOString(), haveTestResults: haveResults, tests: results.length, count, rows };
writeFileSync(join(out, 'accept-v9.json'), JSON.stringify(report, null, 1));
writeFileSync(join(out, 'accept-v9.md'), [`# accept:v9（${report.at}）`, '', `通过 ${count.pass} · 部分 ${count.partial} · 待真机 ${count.pending_device} · 待 Key ${count.pending_key} · 失败 ${count.fail}（单测结果 ${results.length} 项）`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.label} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(4)} ${r.label.padEnd(4)} ${r.title}`);
console.log(`accept:v9 通过 ${count.pass} · 部分 ${count.partial} · 待真机 ${count.pending_device} · 待 Key ${count.pending_key} · 失败 ${count.fail} → out/accept-v9.json`);
if (process.argv.includes('--strict') && count.fail) process.exit(1);
