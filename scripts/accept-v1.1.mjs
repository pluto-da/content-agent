#!/usr/bin/env node
/**
 * accept:v1.1 —— 按 PROMPT-v1.1-unify 第十一部分 D1–D17 逐项检查（out/accept-v1.1.json / .md）。
 * 证据：out/vitest-*.json（CI 的单测步骤现场生成，按测试名匹配；没有就记“部分”，不代填）、out/single-source.json（没有则现场运行
 *      scripts/single-source-check.mjs）、docs/*-v1.1.md（与 design/ 同步的副本）、docs/shots/shots-v1.1.json（截图矩阵报告）、
 *      docs/walkthrough/walkthrough-v1.1.json（冒烟两条路径）、evals/real/mimo-v1.1.json（MiMo 实测，花费与密钥扫描）、
 *      docs/release/{apk,desktop}-manifest-v1.1.json + artifacts-v1.1.json + ci-v1.1.json（CI 成功后取回写入）、out/accept-*.json（回归）、源码。
 * 结论：通过 / 部分 / 待资质 / 待人工 / 待真机 / 失败。人工、真机、资质项不由执行者代填。
 * 用法：node scripts/accept-v1.1.mjs [--strict]（--strict：有“失败”时退出码 1）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const txt = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
const SECRET = [/\bsk-[A-Za-z0-9_-]{16,}/, /\btp-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /"api-key"\s*:\s*"[^"]{12,}"/i];
const leaks = (s) => SECRET.filter((r) => r.test(s)).length;
const semverGte = (a, b) => { const x = String(a ?? '0').split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return true; };

// ---- 单测结果（CI 单测步骤生成 out/vitest-*.json）
const results = [];
for (const f of readdirSync(out).filter((n) => /^vitest-.*\.json$/.test(n))) {
  const j = J(join(out, f));
  for (const tr of j?.testResults ?? []) for (const a of tr.assertionResults ?? []) results.push({ name: `${(a.ancestorTitles ?? []).join(' > ')} > ${a.title}`, status: a.status, file: f });
}
const haveResults = results.length > 0;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function test(label, re = esc(label)) {
  if (!haveResults) return { ok: false, soft: true, text: `${label}：本次没有单测结果（先跑单测输出 out/vitest-*.json）` };
  const r = new RegExp(re);
  const hit = results.filter((x) => r.test(x.name));
  if (!hit.length) return { ok: false, text: `测试未找到：${label}` };
  const bad = hit.filter((x) => x.status !== 'passed');
  return { ok: !bad.length, text: `${label}：${hit.length} 项，通过 ${hit.length - bad.length}${bad.length ? `，未通过 ${bad.length}` : ''}（${hit[0].file}）` };
}
const exists = (p) => existsSync(join(root, p));
const file = (p, label = p) => ({ ok: exists(p), text: `${label}${exists(p) ? ' 存在' : ' 缺失'}` });
const gone = (p, label = p) => ({ ok: !exists(p), text: `${label}${exists(p) ? ' 仍存在' : ' 已删除'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const docPath = (n) => [join(root, 'docs', n), join(root, '../design', n)].find((p) => existsSync(p));
const docTxt = (n) => { const p = docPath(n); return p ? readFileSync(p, 'utf8') : ''; };
const human = (t) => ({ ok: false, human: true, text: `待人工：${t}` });
const device = (t) => ({ ok: false, device: true, text: `待真机：${t}` });
const cert = (t) => ({ ok: false, cert: true, text: `待资质：${t}` });
const soft = (t) => ({ ok: false, soft: true, text: t });

function walk(dir, acc = []) {
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name === 'dist') continue;
    const p = join(dir, n.name);
    if (n.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
const webSrc = walk(join(root, 'web/src')).filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p));
const srcHits = (re) => webSrc.filter((p) => re.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1));

// ---- D1 冲突审计
const audit = docTxt('conflict-audit-v1.1.md');
const auditRows = audit.split('\n').filter((l) => /^\| [A-Z]\d+ \|/.test(l)).map((l) => l.split('|').map((c) => c.trim()));
const aRows = auditRows.filter((c) => /^A/.test(c[1]));
const MUST = [['平台写法', /平台写法/], ['模型选择', /模型选择/], ['截字', /截字/], ['日志/审计/运行状态', /日志.*审计.*运行状态/], ['花钱', /花钱/], ['备份/存储', /本机数据|备份/], ['画像', /画像/], ['成长/技能/记忆', /成长/], ['热点来源', /热点来源/], ['低频项（提醒、重新开始引导）', /低频|重新开始引导/]];
const missingMust = MUST.filter(([, r]) => !aRows.some((c) => r.test(c.join(' ')))).map(([n]) => n);
const noAction = auditRows.filter((c) => !c[7] || !c[9]).map((c) => c[1]);
const D1 = [
  { ok: !!audit, text: `conflict-audit-v1.1.md ${audit ? '存在' : '缺失'}（docs/ 或 ../design/）` },
  { ok: !!audit && missingMust.length === 0, text: `2.2 冲突覆盖：${MUST.length - missingMust.length}/${MUST.length}${missingMust.length ? `，缺 ${missingMust.join('、')}` : ''}` },
  { ok: !!audit && auditRows.length >= 2 * aRows.length - 1 && /穷尽/.test(audit), text: `条目 ${auditRows.length}（A 组 ${aRows.length}，自查 ${auditRows.length - aRows.length}），含“穷尽依据”` },
  { ok: !!audit && noAction.length === 0, text: `每条都有处理与测试${noAction.length ? `；缺：${noAction.join('、')}` : ''}` },
];

// ---- D2 single-source-check
let ss = J(join(out, 'single-source.json'));
if (!ss) { spawnSync(process.execPath, [join(root, 'scripts/single-source-check.mjs'), '--json', join(out, 'single-source.json')], { stdio: 'ignore' }); ss = J(join(out, 'single-source.json')); }
const ssOk = !!ss && ss.pass === true && (ss.results ?? []).every((c) => c.pass);
const D2 = [{ ok: ssOk, text: ss ? `single-source-check：${(ss.results ?? []).map((c) => `${c.id} ${c.pass ? '✓' : '✗'}`).join('、')}` : 'single-source-check 无结果' }, grep('.github/workflows/ci.yml', 'single-source-check\\.mjs', 'CI 运行 single-source-check')];

// ---- D3 模型页
const modelUi = ['web/src/v11/ModelsHub.tsx'].map(txt).join('\n');
const zh = txt('web/src/i18n/zh.ts') + txt('web/src/i18n/zh.json');
const D3 = [
  test('未配置时只有一个主按钮'),
  file('web/src/v11/ModelsHub.tsx', '新模型页 ModelsHub'),
  { ok: !/快速小模型|深度推理|角色/.test(modelUi), text: '模型页源码无“角色 / 快速小模型 / 深度推理”文案' },
  { ok: !srcHits(/['"`]快速小模型['"`]/).length, text: `界面无“快速小模型”独立行${srcHits(/['"`]快速小模型['"`]/).length ? `：${srcHits(/['"`]快速小模型['"`]/).join('、')}` : ''}` },
];
void zh;

// ---- D4–D6 模型归一
const D4 = [test('接入多能力模型后覆盖一览自动点亮'), test('接入一个多能力模型后，覆盖一览自动点亮对应能力')];
const D5 = [test('思考开关：关闭时请求不带思考、计费按实际返回记账'), test('思考是档位')];
const D6 = [test('resolveModel 五级优先级', 'resolveModel 五级优先级'), test('resolveTarget 只是 resolveModel 的别名')];

// ---- D7 写作助手删除
const D7 = [
  gone('web/src/data/assistants.ts', 'web/src/data/assistants.ts'),
  { ok: !srcHits(/\b(AgentSub|AssistantEdit)\b/).length, text: `源码无 AgentSub / AssistantEdit${srcHits(/\b(AgentSub|AssistantEdit)\b/).length ? `：${srcHits(/\b(AgentSub|AssistantEdit)\b/).join('、')}` : ''}` },
  test('D7 旧写作助手删除', 'D7 旧写作助手删除'),
];
const D8 = [test('D8 自由创作为默认', 'D8 自由创作为默认'), exists('agent/skills/free-writing.md') || exists('agent/v9/defaults/skills/free-writing/SKILL.md') ? { ok: true, text: '自由创作技能 free-writing 存在' } : { ok: false, text: '缺 free-writing 技能' }];
const D9 = [test('D9 “我的”≤12 项', 'D9 “我的”≤12 项')];

// ---- D10 硬边界
const webBoundaryConst = srcHits(/HARD_BOUNDARIES/);
const D10 = [
  test('D10 硬边界只读', 'D10 硬边界只读'),
  { ok: webBoundaryConst.length === 0, text: `前端无第二份硬边界常量${webBoundaryConst.length ? `：${webBoundaryConst.join('、')}` : ''}` },
  /HARD_BOUNDARIES/.test(txt('server/src/boundaries.ts')) ? human('服务端 server/src/boundaries.ts 的 HARD_BOUNDARIES 改为从 BOUNDARIES.md 派生属于硬边界改动，等你确认 proposals-v1.1 P1（deviations V11-05）') : { ok: true, text: '服务端无独立常量' },
];

// ---- D11 截字与截图矩阵
const truncHits = webSrc.filter((p) => /\.tsx$/.test(p)).flatMap((p) => readFileSync(p, 'utf8').split('\n').map((l, i) => [p, i + 1, l])).filter(([, , l]) => /\b(title|description|desc|name|label|summary|text)\??\.(slice|substring|substr)\(0,\s*(\d+)\)/.test(l) && !/\.(slice|substring|substr)\(0,\s*1\)/.test(l)).map(([p, n]) => `${p.slice(root.length + 1)}:${n}`);
const shots = J(join(root, 'docs/shots/shots-v1.1.json'));
const D11 = [
  { ok: truncHits.length === 0, text: `源码无截字标题（title/description/name… .slice(0,N)，N≥2）${truncHits.length ? `：${truncHits.join('、')}` : ''}` },
  shots ? { ok: shots.summary?.overflow === 0 && shots.summary?.overlap === 0 && shots.summary?.truncated === 0 && shots.summary?.consoleErrors === 0 && shots.summary?.pageErrors === 0 && shots.summary?.axeSerious === 0 && shots.summary?.axeCritical === 0 && shots.summary?.smallTargets === 0, text: `截图矩阵 ${shots.summary?.shots} 张（${(shots.viewports ?? []).join(' / ')} × 浅深 × 中英）：横向溢出 ${shots.summary?.overflow}、重叠 ${shots.summary?.overlap}、截断 ${shots.summary?.truncated}、触控区<44px ${shots.summary?.smallTargets}、控制台错误 ${shots.summary?.consoleErrors}、页面报错 ${shots.summary?.pageErrors}、axe 严重 ${shots.summary?.axeCritical} / 重要 ${shots.summary?.axeSerious}` } : soft('没有 docs/shots/shots-v1.1.json（先跑 scripts/shots-v1.1.mjs）'),
];

// ---- D12 历史备份
const D12 = [test('D12 四个历史版本备份', 'D12 四个历史版本备份'), test('schemaVersion 3 → 4 迁移与降级', 'schemaVersion 3 → 4 迁移与降级')];

// ---- D13 walkthrough
const wt = J(join(root, 'docs/walkthrough/walkthrough-v1.1.json'));
const wtPath = (k) => wt?.paths?.[k] ? { ok: wt.paths[k].ok === true && (wt.paths[k].steps ?? []).length >= 10 && (wt.paths[k].steps ?? []).every((s) => s.ok && s.shot), text: `${k === 'fresh' ? '新用户' : '1.0 备份用户'}：${(wt.paths[k].steps ?? []).filter((s) => s.ok).length}/${(wt.paths[k].steps ?? []).length} 步通过，截图 ${(wt.paths[k].steps ?? []).filter((s) => s.shot).length} 张${(wt.paths[k].consoleErrors ?? 0) ? `，控制台错误 ${wt.paths[k].consoleErrors}` : ''}` } : soft(`walkthrough 无 ${k} 路径结果`);
const D13 = [exists('scripts/walkthrough-v1.1.mjs') ? file('scripts/walkthrough-v1.1.mjs') : soft('scripts/walkthrough-v1.1.mjs 尚未提交（第十部分第 1 步）'), wt ? wtPath('fresh') : soft('没有 docs/walkthrough/walkthrough-v1.1.json'), wt ? wtPath('legacy') : soft('没有 docs/walkthrough/walkthrough-v1.1.json'), wt ? { ok: wt.paths?.legacy?.duplicateEntries === 0, text: `老用户迁移后重复入口 ${wt.paths?.legacy?.duplicateEntries ?? '—'}` } : soft('—')];

// ---- D14 self-review
const sr = docTxt('self-review-v1.1.md');
const srRows = sr.split('\n').filter((l) => /^\| R\d+ \|/.test(l));
const srOpen = srRows.filter((l) => /未处理|待处理|TODO/.test(l));
const D14 = [sr ? { ok: srRows.length > 0 && srOpen.length === 0, text: `self-review-v1.1.md：${srRows.length} 条，未处理 ${srOpen.length}` } : soft('self-review-v1.1.md 尚未生成（第十部分第 4 步）')];

// ---- D15 MiMo 实测
const mimoTxt = txt('evals/real/mimo-v1.1.json');
const mimo = mimoTxt ? JSON.parse(mimoTxt) : null;
const D15 = mimo ? [
  { ok: ['free-writing', 'thinking', 'vision', 'tts'].every((k) => mimo.steps?.find((s) => s.id === k)?.ok), text: `步骤：${(mimo.steps ?? []).map((s) => `${s.id} ${s.ok ? '✓' : '✗'}`).join('、')}` },
  { ok: (mimo.cost?.yuan ?? 9) <= 1, text: `花费 ¥${mimo.cost?.yuan}（上限 ¥1，${mimo.cost?.basis ?? ''}）` },
  { ok: leaks(mimoTxt) === 0 && mimo.keyInTrace === false, text: `trace 密钥命中 ${leaks(mimoTxt)}，Key 片段出现在 trace：${mimo.keyInTrace ? '是' : '否'}` },
] : [soft('没有 evals/real/mimo-v1.1.json（真实 MiMo 实测需要 Key，CI 不跑）')];

// ---- D16 回归与 CI
const ci = txt('.github/workflows/ci.yml');
const reg = (n) => { const j = J(join(out, `accept-${n}.json`)); if (!j) return soft(`先运行 accept-${n}`); const f = j.count?.fail ?? j.counts?.['失败'] ?? 0; return { ok: f === 0, text: `accept-${n}：失败 ${f}` }; };
const i18n = J(join(out, 'i18n-audit.json'));
const ciRun = J(join(root, 'docs/release/ci-v1.1.json'));
const D16 = [
  grep('.github/workflows/ci.yml', 'accept-v1\\.1\\.mjs --strict', 'CI 跑 accept-v1.1 --strict'),
  grep('.github/workflows/ci.yml', 'name: reports-1\\.(?:[1-9]|\\d{2,})\\.\\d+', 'CI 报告产物 reports-1.x（1.2.0 起作回归：≥ reports-1.1.0）'),
  { ok: /vitest run[^\n]*--outputFile=\.\.\/out\/vitest-shared\.json/.test(ci) && ci.indexOf('vitest-shared.json') < ci.indexOf('accept-v1.1.mjs'), text: 'CI 在 accept 之前现场生成 out/vitest-*.json' },
  { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android' },
  { ok: !/154\.8\.183\.93/.test(ci), text: 'CI 不部署 154.8.183.93' },
  reg('v9'), reg('v10'), reg('v11'), reg('v1'),
  i18n ? { ok: i18n.web?.missingEn === 0 && i18n.web?.unknownIds === 0, text: `i18n：英文缺失 ${i18n.web?.missingEn}、未知 id ${i18n.web?.unknownIds}` } : soft('没有 out/i18n-audit.json'),
  ciRun ? { ok: (ciRun.jobs ?? []).length >= 6 && ciRun.jobs.every((j) => j.conclusion === 'success'), text: `CI run ${ciRun.run}（${ciRun.sha?.slice(0, 7)}）：${(ciRun.jobs ?? []).map((j) => `${j.name} ${j.conclusion}`).join('、')}` } : soft('CI 结论尚未取回（docs/release/ci-v1.1.json，CI 全绿后写入）'),
];

// ---- D17 版本与产物
const pkg = J(join(root, 'package.json'));
const apk = J(join(root, 'docs/release/apk-manifest-v1.1.json'));
const desk = J(join(root, 'docs/release/desktop-manifest-v1.1.json'));
const arts = J(join(root, 'docs/release/artifacts-v1.1.json'));
const D17 = [
  ...['.', 'shared', 'server', 'web', 'desktop', 'mobile'].map((w) => { const v = J(join(root, w, 'package.json'))?.version; const label = `${w === '.' ? '' : `${w}/`}package.json ${v}`; return semverGte(v, '1.1.0') ? { ok: true, text: `${label}（1.2.0 起作回归：≥ 1.1.0）` } : v === '1.0.0' ? soft(`${label}（尚未升版，第十三部分最后一步“版本”）`) : { ok: false, text: label }; }),
  grep('mobile/scripts/apply-native.mjs', 'Number\\(mv\\[1\\]\\) \\* 10000', 'versionCode = x*10000+y*100+z（1.1.0 → 10100）'),
  apk ? { ok: apk.versionName === '1.1.0' && String(apk.versionCode) === '10100', text: `APK build.log：${apk.versionName} / ${apk.versionCode}（run ${apk.run}）` } : soft('APK 尚未取回（docs/release/apk-manifest-v1.1.json）'),
  desk ? { ok: !!desk.win?.installer && !!desk.mac?.installer && desk.win?.sha256ok && desk.mac?.sha256ok, text: `桌面：win ${desk.win?.installer ?? '—'}、mac ${desk.mac?.installer ?? '—'}，分片校验 ${desk.win?.sha256ok && desk.mac?.sha256ok ? '一致' : '不一致'}` } : soft('桌面包尚未取回（docs/release/desktop-manifest-v1.1.json）'),
  arts ? { ok: (arts.files ?? []).length >= 4 && arts.files.every((f) => f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256)), text: (arts.files ?? []).map((f) => `${f.name} ${f.bytes} 字节 sha256 ${f.sha256.slice(0, 12)}…`).join('；') } : soft('产物字节数与 sha256 尚未记录（docs/release/artifacts-v1.1.json）'),
  device('APK 在你的安卓手机上安装、Windows / Mac 双击安装（未签名：SmartScreen“未知发布者”、Gatekeeper 需右键打开）'),
  cert('Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight）'),
];

const ITEMS = [
  ['D1', 'conflict-audit-v1.1.md 覆盖 2.2 全部冲突，每条有处理与测试', D1],
  ['D2', 'single-source-check 通过', D2],
  ['D3', '模型页无“角色 / 快速小模型 / 深度推理”独立行；未配置时只有一个主按钮', D3],
  ['D4', '接入多能力模型后能力覆盖一览自动点亮', D4],
  ['D5', '思考开关在对话中可用，关闭时不走思考，计费与 trace 一致', D5],
  ['D6', 'resolveModel 唯一调用链，单测覆盖五级优先级', D6],
  ['D7', '旧写作助手代码与入口已删除；覆盖迁移为技能修订，可回滚', D7],
  ['D8', '写作默认自由创作；指定平台按技能适配；一稿多适配保留母稿', D8],
  ['D9', '“我的”入口 ≤12，旧路由重定向，命令面板旧词可搜', D9],
  ['D10', '硬边界只读且与 BOUNDARIES 同源，代码中无第二份常量', D10],
  ['D11', '无截字标题；截图矩阵溢出、截断、重叠、控制台错误均为 0', D11],
  ['D12', '四个历史版本备份迁移与降级测试通过', D12],
  ['D13', 'walkthrough 新用户与老用户两条路径全部通过并有截图', D13],
  ['D14', 'self-review-v1.1.md 无未处理项', D14],
  ['D15', 'MiMo 实测通过，花费 ≤¥1，无 Key 泄漏', D15],
  ['D16', '全部回归、扫描与 CI 作业 success', D16],
  ['D17', '版本 1.1.0 / 10100；APK、zip、桌面包已取回并记录字节数与 sha256', D17],
];

const ORDER = ['通过', '部分', '待资质', '待人工', '待真机', '失败'];
const rows = ITEMS.map(([id, title, checks]) => {
  const rest = checks.filter((c) => !c.cert && !c.human && !c.device);
  const anyHard = rest.some((c) => !c.ok && !c.soft);
  const allOk = rest.every((c) => c.ok);
  const verdict = anyHard ? '失败' : !allOk ? '部分' : checks.some((c) => c.cert) ? '待资质' : checks.some((c) => c.human) ? '待人工' : checks.some((c) => c.device) ? '待真机' : '通过';
  return { id, title, verdict, evidence: checks.map((c) => `${c.cert ? '📜' : c.human ? '👤' : c.device ? '📱' : c.ok ? '✓' : c.soft ? '△' : '✗'} ${c.text}`) };
});
const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r.verdict === k).length]));
const pending = { device: ITEMS.flatMap(([, , c]) => c).filter((c) => c.device).length, cert: ITEMS.flatMap(([, , c]) => c).filter((c) => c.cert).length, human: ITEMS.flatMap(([, , c]) => c).filter((c) => c.human).length };
const report = { version: pkg?.version, generatedAt: new Date().toISOString(), haveTestResults: haveResults, tests: results.length, counts, pending, items: rows };
writeFileSync(join(out, 'accept-v1.1.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
writeFileSync(join(out, 'accept-v1.1.md'), [`# accept:v1.1（${report.generatedAt}）`, '', line, '', `待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human}（条目内检查项计数）`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}（单测结果 ${results.length} 条）`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
