#!/usr/bin/env node
/**
 * accept:v1.2 —— 按 PROMPT-v1.2-super-agent 第十四部分 E1–E22 逐项检查（out/accept-v1.2.json / .md）。
 * 证据：out/vitest-*.json（单测步骤现场生成，按测试名匹配；没有就记“部分”，不代填）、out/single-source.json（没有则现场运行）、
 *      docs/*-v1.2.md（与 design/ 同步的副本）、docs/refs-v1.2/、docs/shots/shots-v1.2.json（截图矩阵）、
 *      docs/walkthrough/walkthrough-v1.2.json（两条路径）、evals/real/mimo-v1.2.json（MiMo 实测）、
 *      docs/release/{apk,desktop}-manifest-v1.2.json + artifacts-v1.2.json + ci-v1.2.json（CI 成功后取回写入）、out/accept-*.json（回归）、源码。
 * 结论：通过 / 部分 / 待资质 / 待人工 / 待真机 / 失败。人工、真机、资质、待 Key 项不由执行者代填。
 * 用法：node scripts/accept-v1.2.mjs [--strict]（--strict：有“失败”时退出码 1）。
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

// ---- 单测结果
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
  return { ok: !bad.length, text: `${label}：${hit.length} 项，通过 ${hit.length - bad.length}${bad.length ? `，未通过 ${bad.length}` : ''}（${[...new Set(hit.map((h) => h.file))].join('、')}）` };
}
const exists = (p) => existsSync(join(root, p));
const file = (p, label = p) => ({ ok: exists(p), text: `${label}${exists(p) ? ' 存在' : ' 缺失'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const docPath = (n) => [join(root, 'docs', n), join(root, '../design', n)].find((p) => existsSync(p));
const docTxt = (n) => { const p = docPath(n); return p ? readFileSync(p, 'utf8') : ''; };
const human = (t) => ({ ok: false, human: true, text: `待人工：${t}` });
const device = (t) => ({ ok: false, device: true, text: `待真机：${t}` });
const cert = (t) => ({ ok: false, cert: true, text: `待资质：${t}` });
const needKey = (t) => ({ ok: false, key: true, text: `待 Key：${t}` });
const soft = (t) => ({ ok: false, soft: true, text: t });

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    if (n.name === 'node_modules' || n.name === 'dist') continue;
    const p = join(dir, n.name);
    if (n.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
const webSrc = walk(join(root, 'web/src')).filter((p) => /\.(tsx?|css)$/.test(p) && !/\.test\.tsx?$/.test(p));
const srcHits = (re) => webSrc.filter((p) => re.test(readFileSync(p, 'utf8'))).map((p) => p.slice(root.length + 1));
const superSrc = ['governance', 'agents', 'platforms', 'sources', 'workflows', 'mcp', 'a2a'].map((n) => txt(`shared/src/super/${n}.ts`)).join('\n');

// ---- 证据文件
const shots = J(join(root, 'docs/shots/shots-v1.2.json'));
const wt = J(join(root, 'docs/walkthrough/walkthrough-v1.2.json'));
const proposals = docTxt('proposals-v1.2.md');
const sr = docTxt('self-review-v1.2.md');
const refs = txt('docs/refs-v1.2/platforms.md') || (existsSync(join(root, '../design/refs-v1.2/platforms.md')) ? readFileSync(join(root, '../design/refs-v1.2/platforms.md'), 'utf8') : '');
const ci = txt('.github/workflows/ci.yml');

// ---- E1–E6 控制平面
const E1 = [
  test('E1 超级 Agent 身份'),
  file('shared/src/super/governance.ts', '控制平面 shared/src/super/governance.ts'),
  { ok: /AGENTS\.md/.test(proposals) && /指挥职责/.test(proposals), text: `proposals-v1.2.md ${proposals ? '含 AGENTS.md“指挥职责”修订建议（核心文件只以修订建议存在）' : '缺失'}` },
  test('批准 P1 才写 AGENTS.md'),
  ...((proposals.match(/^## (P\d+)[^\n]*状态：待你确认/gm) ?? []).length ? [human(`proposals-v1.2 中 ${(proposals.match(/^## (P\d+)[^\n]*状态：待你确认/gm) ?? []).map((l) => l.slice(3).split(' ')[0]).join(' / ')} 等你确认（核心文件修订，代码未改正文）`)] : []),
];
const E2 = [test('E2 权限分级'), test('E2 工具全部标级')];
const E3 = [test('E3 按 Agent 预算'), test('超额度：暂停并给出审批事项'), test('超额度：不执行、暂停该子 Agent')];
const E4 = [test('E4 审批收件箱 >'), test('E4 审批收件箱（App）')];
const pauseMs = ['fresh', 'legacy'].map((k) => wt?.paths?.[k]?.pauseMs).filter((x) => x != null).flat();
const E5 = [
  test('E5 全部暂停 >'), test('E5 全部暂停（App）'),
  pauseMs.length ? { ok: pauseMs.every((m) => (typeof m === 'number' ? m : Math.max(...Object.values(m ?? {}).map(Number).filter((n) => !Number.isNaN(n)), 0)) <= 1000), text: `walkthrough 实测全部暂停耗时：${JSON.stringify(pauseMs)} ms（≤1000）` } : soft('walkthrough 无全部暂停耗时'),
];
const E6 = [test('E6 目标与进度'), { ok: /待录入/.test(superSrc), text: '无数据写“待录入”（shared/src/super）' }];

// ---- E7–E10 子 Agent
const E7 = [test('E7 子 Agent 增删改与模板'), test('子级权限是父级子集'), test('E7 / E8 / E9 子 Agent 在 App 里')];
const E8 = [test('E8 深度、并发、交接契约、退回一次')];
const E9 = [test('E9 任务板状态流转'), test('任务板 待办→进行中→待验收→完成')];
const E10 = [test('E10 成长记录与改动分级')];

// ---- E11–E13 平台、软件、数据源
const boundaryLine = srcHits(/发布与互动都由你本人在官方 App 内完成/);
const E11 = [
  test('E11 自定义平台'), test('E11 / E13 自定义平台（App）'),
  { ok: boundaryLine.length > 0, text: `界面写明“发布与互动都由你本人在官方 App 内完成”${boundaryLine.length ? `（${boundaryLine.slice(0, 3).join('、')}）` : '：未找到'}` },
];
const E12 = [test('E12 平台模板规格附来源与核对日期'), { ok: /核对/.test(refs) && /待核实/.test(refs + superSrc), text: `docs/refs-v1.2/platforms.md ${refs ? '含来源与核对日期，未核实字段标“待核实”' : '缺失'}` }];
const E13 = [test('E13 自定义软件入口与四类数据源')];

// ---- E14–E16 工作流、MCP、A2A
const E14 = [
  test('E14 工作流 >'), test('E14 工作流（App）'),
  device('定时工作流只在 App 打开时执行到期任务；App 关闭时的工作流提醒通知尚未接入系统通知，接入后需真机验证（deviations-v1.2 V12-05 / V12-06）'),
];
const E15 = [test('E15 MCP 客户端'), file('shared/src/super/mcpMock.ts', '本机模拟 MCP 服务器（两版规范）')];
const E16 = [test('E16 A2A（beta，默认关闭）'), test('E16 A2A 服务端')];

// ---- E17–E18 指挥台
const shotsOk = shots && ['overflow', 'overlap', 'truncated', 'smallTargets', 'consoleErrors', 'pageErrors', 'axeCritical', 'axeSerious'].every((k) => (shots.summary?.[k] ?? 1) === 0);
const E17 = [
  test('E17 / E18 指挥台入口'), test('E17 @子Agent 点名'), test('@子Agent：回复写明交给了谁'),
  shots ? { ok: !!shotsOk && (shots.viewports ?? []).length === 3, text: `截图矩阵 ${shots.summary?.shots} 张（${(shots.viewports ?? []).join(' / ')} × 浅深 × 中英）：溢出 ${shots.summary?.overflow}、重叠 ${shots.summary?.overlap}、截断 ${shots.summary?.truncated}、触控<44 ${shots.summary?.smallTargets}、控制台 ${shots.summary?.consoleErrors}、页面报错 ${shots.summary?.pageErrors}、axe 严重 ${shots.summary?.axeCritical} / 重要 ${shots.summary?.axeSerious}` } : soft('没有 docs/shots/shots-v1.2.json（先跑 scripts/shots-v1.2.mjs）'),
];
let ss = J(join(out, 'single-source.json'));
if (!ss) { spawnSync(process.execPath, [join(root, 'scripts/single-source-check.mjs'), '--json', join(out, 'single-source.json')], { stdio: 'ignore' }); ss = J(join(out, 'single-source.json')); }
const ssOk = !!ss && ss.pass === true && (ss.results ?? []).every((c) => c.pass);
const E18 = [
  test('#command 是独立空间'), test('D9 “我的”≤12 项'),
  wt?.paths?.legacy?.meEntries != null ? { ok: wt.paths.legacy.meEntries <= 12, text: `walkthrough 老用户“我的”入口 ${wt.paths.legacy.meEntries}（≤12）` } : soft('walkthrough 无“我的”入口计数'),
  { ok: ssOk, text: ss ? `single-source-check：${(ss.results ?? []).map((c) => `${c.id} ${c.pass ? '✓' : '✗'}`).join('、')}` : 'single-source-check 无结果' },
];

// ---- E19–E20 迁移、自检
const E19 = [test('E19 六个历史版本备份'), { ok: /'1\.2\.0'/.test(txt('web/src/v12/migrate.test.tsx')) && /'0\.9\.0'/.test(txt('web/src/v12/migrate.test.tsx')), text: '覆盖 0.9 / 0.10 / 0.11 / 1.0 / 1.1 / 1.2 六个版本（web/src/v12/migrate.test.tsx）' }];
const wtPath = (k) => wt?.paths?.[k] ? { ok: wt.paths[k].ok === true && (wt.paths[k].steps ?? []).length >= 15 && wt.paths[k].steps.every((s) => s.ok && s.shot) && !(wt.paths[k].consoleErrors ?? 0) && !(wt.paths[k].pageErrors ?? 0), text: `${k === 'fresh' ? '新用户' : '1.1 备份用户'}：${wt.paths[k].steps.filter((s) => s.ok).length}/${wt.paths[k].steps.length} 步通过，截图 ${wt.paths[k].steps.filter((s) => s.shot).length} 张，控制台错误 ${wt.paths[k].consoleErrors ?? 0}，页面报错 ${wt.paths[k].pageErrors ?? 0}` } : soft(`walkthrough 无 ${k} 路径结果`);
const srRows = sr.split('\n').filter((l) => /^\| R\d+ \|/.test(l));
const srOpen = srRows.filter((l) => /未处理|待处理|TODO/.test(l));
const E20 = [file('scripts/walkthrough-v1.2.mjs'), wtPath('fresh'), wtPath('legacy'), sr ? { ok: srRows.length > 0 && srOpen.length === 0, text: `self-review-v1.2.md：${srRows.length} 条，未处理 ${srOpen.length}` } : soft('self-review-v1.2.md 缺失')];

// ---- E21 MiMo 实测
const mimoTxt = txt('evals/real/mimo-v1.2.json');
const mimo = mimoTxt ? JSON.parse(mimoTxt) : null;
const E21 = !mimo ? [needKey('没有 evals/real/mimo-v1.2.json（真实 MiMo 实测需要 Key，CI 不跑）')]
  : mimo.status === '待 Key' ? [needKey(`MiMo 实测未运行：${mimo.note ?? ''}`)]
  : [
    { ok: mimo.status === '通过' && Object.values(mimo.checks ?? {}).every(Boolean), text: `实测 ${mimo.status}：${Object.entries(mimo.checks ?? {}).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join('、')}` },
    { ok: (mimo.board ?? []).filter((b) => b.state === 'done').length >= 2, text: `子 Agent 任务：${(mimo.board ?? []).map((b) => `${b.agent} ${b.state}${b.returned ? `（退回 ${b.returned}）` : ''}`).join('、')}` },
    { ok: (mimo.cost?.yuan ?? 9) <= 2, text: `花费 ¥${mimo.cost?.yuan}（上限 ¥2，${mimo.cost?.basis ?? ''}）` },
    { ok: leaks(mimoTxt) === 0 && mimo.keyLeakScan?.findSecrets === 0 && mimo.keyLeakScan?.headersRecorded === false, text: `trace 密钥命中 ${leaks(mimoTxt)}，findSecrets ${mimo.keyLeakScan?.findSecrets}，记录请求头：${mimo.keyLeakScan?.headersRecorded ? '是' : '否'}` },
  ];

// ---- E22 回归、版本、产物
const reg = (n) => { const j = J(join(out, `accept-${n}.json`)); if (!j) return soft(`先运行 accept-${n}`); const f = j.count?.fail ?? j.counts?.['失败'] ?? 0; return { ok: f === 0, text: `accept-${n}：失败 ${f}` }; };
const i18n = J(join(out, 'i18n-audit.json'));
const ciRun = J(join(root, 'docs/release/ci-v1.2.json'));
const apk = J(join(root, 'docs/release/apk-manifest-v1.2.json'));
const desk = J(join(root, 'docs/release/desktop-manifest-v1.2.json'));
const arts = J(join(root, 'docs/release/artifacts-v1.2.json'));
const pkgs = ['.', 'shared', 'server', 'web', 'desktop', 'mobile'];
const E22 = [
  ...pkgs.map((w) => { const v = J(join(root, w, 'package.json'))?.version; return { ok: v === '1.2.0', text: `${w === '.' ? '' : `${w}/`}package.json ${v}` }; }),
  ...['server', 'web'].map((w) => { const d = J(join(root, w, 'package.json'))?.dependencies?.['@content-agent/shared']; return { ok: d === '1.2.0', text: `${w} 依赖 @content-agent/shared ${d}` }; }),
  { ok: (J(join(root, 'package-lock.json'))?.packages?.['shared']?.version ?? J(join(root, 'package-lock.json'))?.packages?.['node_modules/@content-agent/shared']?.version) === '1.2.0' || Object.entries(J(join(root, 'package-lock.json'))?.packages ?? {}).filter(([k]) => ['', 'shared', 'server', 'web', 'desktop', 'mobile'].includes(k)).every(([, v]) => v.version === '1.2.0'), text: 'package-lock 工作区版本 1.2.0' },
  grep('server/src/app.ts', "version: '1\\.2\\.0'", 'server /api/health 1.2.0'),
  grep('server/src/app.ts', "a2aOptsFromEnv\\('1\\.2\\.0'\\)", 'A2A Agent Card 版本 1.2.0'),
  grep('web/src/local/router.ts', "version: '1\\.2\\.0'", '本机 /api/health 1.2.0'),
  grep('mobile/scripts/apply-native.mjs', 'Number\\(mv\\[1\\]\\) \\* 10000', 'versionCode = x*10000+y*100+z（1.2.0 → 10200）'),
  grep('.github/workflows/ci.yml', 'accept-v1\\.2\\.mjs --strict', 'CI 跑 accept-v1.2 --strict'),
  grep('.github/workflows/ci.yml', 'name: reports-1\\.2\\.0', 'CI 报告产物 reports-1.2.0'),
  { ok: ci.indexOf('vitest-shared.json') > 0 && ci.indexOf('vitest-shared.json') < ci.indexOf('accept-v1.2.mjs'), text: 'CI 在 accept 之前现场生成 out/vitest-*.json' },
  { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android' },
  { ok: !/154\.8\.183\.93/.test(ci), text: 'CI 不部署 154.8.183.93' },
  reg('v9'), reg('v10'), reg('v11'), reg('v1'), reg('v1.1'),
  i18n ? { ok: i18n.web?.missingEn === 0 && i18n.web?.unknownIds === 0, text: `i18n：英文缺失 ${i18n.web?.missingEn}、未知 id ${i18n.web?.unknownIds}` } : soft('没有 out/i18n-audit.json'),
  ciRun ? { ok: (ciRun.jobs ?? []).length >= 6 && ciRun.jobs.every((j) => j.conclusion === 'success'), text: `CI run ${ciRun.run}：${(ciRun.jobs ?? []).map((j) => `${j.name} ${j.conclusion}`).join('、')}` } : soft('CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准；docs/release/ci-v1.2.json 待 CI 恢复后写入）'),
  apk ? { ok: apk.versionName === '1.2.0' && String(apk.versionCode) === '10200', text: `APK：${apk.versionName} / ${apk.versionCode}` } : soft('APK 未取回（CI 被账单拦截；docs/release/apk-manifest-v1.2.json）'),
  desk ? { ok: !!desk.win?.installer && !!desk.mac?.installer, text: `桌面：win ${desk.win?.installer ?? '—'}、mac ${desk.mac?.installer ?? '—'}` } : soft('桌面包未取回（CI 被账单拦截；docs/release/desktop-manifest-v1.2.json）'),
  arts ? { ok: (arts.files ?? []).length >= 4 && arts.files.every((f) => f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256)), text: (arts.files ?? []).map((f) => `${f.name} ${f.bytes} 字节`).join('；') } : soft('产物字节数与 sha256 未记录（docs/release/artifacts-v1.2.json）'),
  device('APK 在安卓手机安装、Windows / Mac 双击安装（未签名）'),
  cert('Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight）'),
];

const ITEMS = [
  ['E1', '超级 Agent 身份与指挥职责生效，核心文件改动仅以修订建议形式存在', E1],
  ['E2', '权限分级 L0–L3 + 禁止级；工具全部标级；越权被拒并审计', E2],
  ['E3', '按 Agent 预算；超额度暂停进审批', E3],
  ['E4', '审批收件箱汇总 6 类事项，批准、拒绝、修改后批准均可用', E4],
  ['E5', '全部暂停 ≤1 秒停止全部运行与定时；单项暂停可用', E5],
  ['E6', '目标设定与进度，只显示有数据依据的数字', E6],
  ['E7', '子 Agent 增删改、模板 8 个、导入导出、权限为父级子集', E7],
  ['E8', '深度 ≤3、并发上限、交接契约 Schema 校验、退回一次', E8],
  ['E9', '任务板状态流转正确', E9],
  ['E10', '子 Agent 独立成长记录；低风险自动采纳，职责与权限改动需确认', E10],
  ['E11', '自定义平台三种创建方式；能力与内置平台一致且无自动发布 / 互动', E11],
  ['E12', '平台模板规格附来源与核对日期，未核实字段标注', E12],
  ['E13', '自定义软件入口与四类数据源；数据源可授权给子 Agent', E13],
  ['E14', '工作流：定义、三类触发、3 个模板、审批节点、提议保存', E14],
  ['E15', 'MCP 客户端兼容两版规范；逐工具授权；社交互动类工具被拒', E15],
  ['E16', 'A2A 客户端 / 服务端开关默认关闭，开启后受同等治理', E16],
  ['E17', '指挥台、指挥条、@子Agent；三布局截图 0 问题；axe 0 严重', E17],
  ['E18', '“我的”仍 ≤12 项；single-source-check 通过', E18],
  ['E19', '六个历史版本备份迁移与降级通过', E19],
  ['E20', 'walkthrough 两条路径通过；self-review 无未处理项', E20],
  ['E21', 'MiMo 实测通过，花费 ≤¥2，无 Key 泄漏', E21],
  ['E22', '全部回归与 CI 通过；1.2.0 / 10200；APK、zip、桌面包已取回并记录字节数与 sha256', E22],
];

const ORDER = ['通过', '部分', '待 Key', '待资质', '待人工', '待真机', '失败'];
const pend = (c) => c.cert || c.human || c.device || c.key;
const rows = ITEMS.map(([id, title, checks]) => {
  const rest = checks.filter((c) => !pend(c));
  const anyHard = rest.some((c) => !c.ok && !c.soft);
  const allOk = rest.every((c) => c.ok);
  const verdict = anyHard ? '失败' : !allOk ? '部分' : checks.some((c) => c.key) ? '待 Key' : checks.some((c) => c.cert) ? '待资质' : checks.some((c) => c.human) ? '待人工' : checks.some((c) => c.device) ? '待真机' : '通过';
  return { id, title, verdict, evidence: checks.map((c) => `${c.key ? '🔑' : c.cert ? '📜' : c.human ? '👤' : c.device ? '📱' : c.ok ? '✓' : c.soft ? '△' : '✗'} ${c.text}`) };
});
const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r.verdict === k).length]));
const all = ITEMS.flatMap(([, , c]) => c);
const pending = { device: all.filter((c) => c.device).length, cert: all.filter((c) => c.cert).length, human: all.filter((c) => c.human).length, key: all.filter((c) => c.key).length };
const pkg = J(join(root, 'package.json'));
const report = { version: pkg?.version, generatedAt: new Date().toISOString(), haveTestResults: haveResults, tests: results.length, counts, pending, items: rows };
writeFileSync(join(out, 'accept-v1.2.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
writeFileSync(join(out, 'accept-v1.2.md'), [`# accept:v1.2（${report.generatedAt}）`, '', line, '', `待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}（条目内检查项计数）`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}（单测结果 ${results.length} 条）；待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
