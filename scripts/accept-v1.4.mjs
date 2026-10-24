#!/usr/bin/env node
/**
 * accept:v1.4 —— 按 PROMPT-v1.4-listed-governance 第十六部分 G1–G25 + 第十九部分 G26 逐项检查（out/accept-v1.4.json / .md）。
 * 证据：out/vitest-*.json（按单测名匹配）、docs/*-v1.4.md（与 design/ 同步）、docs/refs-v1.4/、docs/shots/shots-v1.4.json、docs/walkthrough/walkthrough-v1.4.json、evals/real/mimo-v1.4.json、docs/release/*-v1.4.json、out/accept-*.json（回归）、源码。
 * 以下为 1.3 的说明：
 * accept:v1.3 —— 按 PROMPT-v1.3-conglomerate 第十七部分 F1–F22 逐项检查（out/accept-v1.3.json / .md）。
 * 结论：通过 / 部分 / 待 Key / 待资质 / 待人工 / 待真机 / 失败。
 * 用法：node scripts/accept-v1.3.mjs [--strict]（--strict：有“失败”时退出码 1）。
 * 以下为 1.2 的说明：
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
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const docPath = (n) => [join(root, 'docs', n), join(root, '../design', n)].find((p) => existsSync(p));
const docTxt = (n) => { const p = docPath(n); return p ? readFileSync(p, 'utf8') : ''; };
const device = (t) => ({ ok: false, device: true, text: `待真机：${t}` });
const cert = (t) => ({ ok: false, cert: true, text: `待资质：${t}` });
const needKey = (t) => ({ ok: false, key: true, text: `待 Key：${t}` });
const soft = (t) => ({ ok: false, soft: true, text: t });


// ---- 证据文件
const L = (n) => txt(`shared/src/listed/${n}.ts`);
const shots = J(join(root, 'docs/shots/shots-v1.4.json'));
const wt = J(join(root, 'docs/walkthrough/walkthrough-v1.4.json'));
const proposals = docTxt('proposals-v1.4.md');
const sr = docTxt('self-review-v1.4.md');
const ci = txt('.github/workflows/ci.yml');
const mimo = J(join(root, 'evals/real/mimo-v1.4.json'));
const reg = (n) => { const j = J(join(out, `accept-${n}.json`)); if (!j) return soft(`先运行 accept-${n}`); const f = j.count?.fail ?? j.counts?.['失败'] ?? 0; return { ok: f === 0, text: `accept-${n}：失败 ${f}` }; };
const i18n = J(join(out, 'i18n-audit.json'));
const sum = shots?.summary;
const refs = existsSync(join(root, 'docs/refs-v1.4')) ? readdirSync(join(root, 'docs/refs-v1.4')) : [];
const shotPages = shots ? [...new Set(Object.values(shots.runs ?? {}).flatMap((r) => Object.keys(r.pages ?? {})))] : [];

const G = {
  G1: [test('G1 股东会（年度大会）流程完整'), test('G16 / G17 / G18 接班、集团大学、学堂在 App 里', 'G16 / G17 / G18 接班、集团大学、学堂在 App 里')],
  G2: [test('G2 董事会组成、独立性规则、议事规则、表决理由、董事长否决留痕'), test('G2 / G21 董事会在 App 里', 'G2 / G21 董事会在 App 里')],
  G3: [test('G3 战略、审计、提名与薪酬三个专门委员会，独立董事过半数')],
  G4: [test('G4 三道防线与风险登记册')],
  G5: [test('G5 内审：抽查、六类检查、报告直送、整改跟踪'), test('G5 / G7 / G8 / G11 / G12 / G13 一个月的模拟数据', 'G5 / G7 / G8 / G11 / G12 / G13 一个月的模拟数据')],
  G6: [test('G6 内控矩阵（COSO 五要素）与自动测试'), { ok: /COSO/.test(L('oversight')) && /不构成/.test(L('oversight')), text: '内控矩阵按 COSO 五要素，声明“不构成法律意见”' }],
  G7: [test('G7 月度经营分析（平衡计分卡 + 五列差距表），只用可验证数据')],
  G8: [test('G8 全面预算、偏差预警、调整审批')],
  G9: [test('G9 投入产出看板')],
  G10: [test('G10 董事长简报')],
  G11: [test('G11 季报、年报 11 个章节，数字可追溯，导出 PDF 与 docx，使用笔名'), wt ? { ok: Object.values(wt.paths ?? {}).every((p) => p.steps.some((s) => s.id === 'export-q' && s.ok)), text: 'walkthrough 两条路径导出季报 PDF 与 docx' } : soft('没有 walkthrough-v1.4.json')],
  G12: [test('G12 一致性检查阻止错误报告'), test('1.4 MiMo 实测发现的回归 > 花费 at 不是 ISO 开头也计入损益', '1\\.4 MiMo 实测发现的回归 > 花费 at')],
  G13: [test('G13 业绩发布会'), test('1.4 MiMo 实测发现的回归 > 发布会', '1\\.4 MiMo 实测发现的回归 > 发布会')],
  G14: [test('G14 战略规划（BLM 八步、战略地图、三情景、拆解为 OKR）')],
  G15: [test('G15 提名、薪酬（资源激励）规则公开')],
  G16: [test('G16 接班人计划：影子上岗、盲评、交接、回滚')],
  G17: [test('G17 集团大学：案例库、入职培训测验、最佳实践、知识健康度')],
  G18: [test('G18 董事长学堂：20 张以上卡片、每周一课、徽章、术语悬停')],
  G19: [test('G19 治理分区界面'),
    sum ? { ok: sum.combos === 12 && shotPages.length >= 10 && shotPages.some((p) => /sec=revenue/.test(p)) && sum.overflow === 0 && sum.overlap === 0 && sum.truncated === 0 && sum.smallTargets === 0 && sum.spill === 0 && sum.squeezed === 0 && sum.consoleErrors === 0 && sum.pageErrors === 0, text: `截图矩阵 ${sum.combos} 组合 × ${shotPages.length} 页 = ${sum.shots} 张（含经营收入页）：溢出 ${sum.overflow} 重叠 ${sum.overlap} 截断 ${sum.truncated} 小触控 ${sum.smallTargets} 溢字 ${sum.spill} 挤压 ${sum.squeezed} 控制台 ${sum.consoleErrors} 报错 ${sum.pageErrors}；英文中文残留（仅报告）${sum.cjkInEnReportOnly}` } : soft('没有 docs/shots/shots-v1.4.json'),
    sum ? { ok: sum.axeCritical === 0 && sum.axeSerious === 0, text: `axe 严重 ${sum.axeCritical} / 重要 ${sum.axeSerious}` } : soft('没有 axe 结果')],
  G20: [test('G20 上市公司模式默认关闭，可启用、可退回；诚实声明'), test('G20 上市公司模式默认关闭（状态）'), { ok: /不是法律实体，不涉及真实股权、证券或信息披露义务/.test(L('gov') + L('state') + L('index')), text: '诚实声明原文在 shared' }],
  G21: [test('G21 治理成本上限；治理不提升权限；硬边界决议被拒；不泄露 Key 与隐私'), test('G2 / G21 董事会在 App 里', 'G2 / G21 董事会在 App 里'), { ok: !!proposals && /章程/.test(proposals) && /DOA/.test(proposals) && /独立/.test(proposals) && /治理成本/.test(proposals), text: `proposals-v1.4.md ${proposals ? '含章程 / DOA / 独立性规则 / 治理成本上限（高风险改动只进 proposals）' : '缺失'}` }],
  G22: [test('G22 8 个历史版本备份：恢复 → 迁移 → 使用 → 降级')],
  G23: [wt ? { ok: Object.keys(wt.paths ?? {}).length === 2 && Object.values(wt.paths).every((p) => p.ok && p.steps.every((s) => s.ok && s.shot) && !(p.consoleErrors ?? 0) && !(p.pageErrors ?? 0)), text: `walkthrough：${Object.entries(wt.paths ?? {}).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}`).join('；')}` } : soft('没有 docs/walkthrough/walkthrough-v1.4.json'),
    sr ? { ok: !/状态：未处理|\| *未处理 *\|/.test(sr), text: `self-review-v1.4.md 未处理项 ${(sr.match(/状态：未处理|\| *未处理 *\|/g) ?? []).length}` } : soft('没有 self-review-v1.4.md')],
  G24: [mimo ? (mimo.status === '待 Key' ? needKey('MiMo 实测未发出请求（没有 Key）') : { ok: mimo.status === '通过' && (mimo.cost?.yuan ?? 9) <= 3 && (mimo.runsTotal?.yuan ?? 0) <= 3 && leaks(JSON.stringify(mimo)) === 0 && ['board', 'audit', 'report', 'call'].every((k) => mimo[k]), text: `MiMo：${mimo.status}，最终一次 ¥${mimo.cost?.yuan}、${mimo.cost?.calls} 次；三次合计 ¥${mimo.runsTotal?.yuan}、${mimo.runsTotal?.calls} 次（≤¥3）；董事会 / 内审 / 季报 / 发布会齐全；Key 扫描 ${leaks(JSON.stringify(mimo))}` }) : soft('没有 evals/real/mimo-v1.4.json'),
    mimo?.board ? { ok: mimo.board.directors.every((d) => d.model && d.model !== mimo.models?.ceo && d.weak && /独立性弱/.test(d.label)), text: `独立董事模型 ${[...new Set(mimo.board.directors.map((d) => d.model))].join('、')} ≠ CEO ${mimo.models?.ceo}，标注“${mimo.board.directors[0]?.label}”` } : soft('没有董事会实测')],
  G26: [test('G26 经营收入与全球商机'), test('G26 经营收入与全球商机（App 接线）'),
    wt ? { ok: Object.values(wt.paths ?? {}).every((p) => p.steps.some((s) => s.id === 'revenue' && s.ok)), text: 'walkthrough 两条路径含经营收入一步' } : soft('没有 walkthrough-v1.4.json'),
    { ok: refs.length > 0 && /youtube|tiktok|bilibili/i.test(refs.map((f) => txt(`docs/refs-v1.4/${f}`)).join('\n')), text: `refs-v1.4 含商机官方来源（${refs.length} 个文件）` }],
};
const ciRun = J(join(root, 'docs/release/ci-v1.4.json'));
const apk = J(join(root, 'docs/release/apk-manifest-v1.4.json'));
const desk = J(join(root, 'docs/release/desktop-manifest-v1.4.json'));
const arts = J(join(root, 'docs/release/artifacts-v1.4.json'));
const pkgs = ['.', 'shared', 'server', 'web', 'desktop', 'mobile'];
G.G25 = [
  ...pkgs.map((w) => { const v = J(join(root, w, 'package.json'))?.version; return { ok: v === '1.4.0', text: `${w === '.' ? '' : `${w}/`}package.json ${v}` }; }),
  ...['server', 'web'].map((w) => { const d = J(join(root, w, 'package.json'))?.dependencies?.['@content-agent/shared']; return { ok: d === '1.4.0', text: `${w} 依赖 @content-agent/shared ${d}` }; }),
  { ok: Object.entries(J(join(root, 'package-lock.json'))?.packages ?? {}).filter(([k]) => ['', 'shared', 'server', 'web', 'desktop', 'mobile'].includes(k)).every(([, v]) => v.version === '1.4.0'), text: 'package-lock 工作区版本 1.4.0' },
  grep('server/src/app.ts', "version: '1\\.4\\.0'", 'server /api/health 1.4.0'),
  grep('server/src/app.ts', "a2aOptsFromEnv\\('1\\.4\\.0'\\)", 'A2A Agent Card 版本 1.4.0'),
  grep('web/src/local/router.ts', "version: '1\\.4\\.0'", '本机 /api/health 1.4.0'),
  { ok: /APP_VERSION\s*=\s*'1\.4\.0'/.test(txt('web/src/v9/backup.ts')), text: '备份 APP_VERSION 1.4.0' },
  grep('mobile/scripts/apply-native.mjs', 'Number\\(mv\\[1\\]\\) \\* 10000', 'versionCode = x*10000+y*100+z（1.4.0 → 10400）'),
  grep('.github/workflows/ci.yml', 'accept-v1\\.4\\.mjs --strict', 'CI 跑 accept-v1.4 --strict'),
  grep('.github/workflows/ci.yml', 'name: reports-1\\.4\\.0', 'CI 报告产物 reports-1.4.0'),
  { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android' },
  { ok: !/154\.8\.183\.93/.test(ci), text: 'CI 不部署 154.8.183.93' },
  reg('v9'), reg('v10'), reg('v11'), reg('v1'), reg('v1.1'), reg('v1.2'), reg('v1.3'),
  i18n ? { ok: i18n.web?.missingEn === 0 && i18n.web?.unknownIds === 0, text: `i18n：英文缺失 ${i18n.web?.missingEn}、未知 id ${i18n.web?.unknownIds}` } : soft('没有 out/i18n-audit.json'),
  ciRun ? { ok: (ciRun.jobs ?? []).every((j) => j.conclusion === 'success'), text: `CI run ${ciRun.run}` } : soft('CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准）'),
  apk ? { ok: apk.versionName === '1.4.0' && String(apk.versionCode) === '10400', text: `APK：${apk.versionName} / ${apk.versionCode}` } : soft('APK 未取回（CI 被账单拦截）'),
  desk ? { ok: !!desk.win?.installer && !!desk.mac?.installer, text: '桌面包' } : soft('桌面包未取回（CI 被账单拦截）'),
  arts ? { ok: (arts.files ?? []).every((f) => f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256)), text: (arts.files ?? []).map((f) => `${f.name} ${f.bytes} 字节`).join('；') } : soft('产物字节数与 sha256 未记录（CI 被账单拦截，未产出安装包）'),
  device('APK 在安卓手机安装、Windows / Mac 双击安装（未签名）'),
  cert('Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight）'),
];
const ITEMS = [
  ['G1', '股东会（年度大会）流程完整'], ['G2', '董事会组成、独立性规则、议事规则、表决理由、董事长否决留痕'], ['G3', '战略、审计、提名与薪酬三个专门委员会，独立董事过半数'],
  ['G4', '三道防线与风险登记册'], ['G5', '内审：抽查、六类检查、报告直送、整改跟踪'], ['G6', '内控矩阵（COSO 五要素）与自动测试'],
  ['G7', '月度经营分析（平衡计分卡 + 五列差距表），只用可验证数据'], ['G8', '全面预算、偏差预警、调整审批'], ['G9', '投入产出看板'], ['G10', '董事长简报'],
  ['G11', '季报、年报 11 个章节，数字可追溯，导出 PDF 与 docx，使用笔名'], ['G12', '一致性检查阻止错误报告'], ['G13', '业绩发布会'],
  ['G14', '战略规划（BLM 八步、战略地图、三情景、拆解为 OKR）'], ['G15', '提名、薪酬（资源激励）规则公开'], ['G16', '接班人计划：影子上岗、盲评、交接、回滚'],
  ['G17', '集团大学：案例库、入职培训测验、最佳实践、知识健康度'], ['G18', '董事长学堂：20 张以上卡片、每周一课、徽章、术语悬停'], ['G19', '治理分区界面三种布局截图 0 问题，axe 0 严重'],
  ['G20', '上市公司模式默认关闭，可启用、可退回；诚实声明'], ['G21', '治理成本上限；治理不提升权限；硬边界决议被拒；不泄露 Key 与隐私'], ['G22', '8 个历史版本的备份完成迁移与降级'],
  ['G23', 'walkthrough 两条路径通过；self-review 无未处理项'], ['G24', 'MiMo 实测通过，花费 ≤ ¥3'],
  ['G25', '全部回归通过；版本 1.4.0 / 10400；CI 恢复后取回 APK、zip、桌面包并记录字节数与 sha256（未取回如实标“部分”）'], ['G26', '经营收入与全球商机（损益表、商机卡、评审→提案→批准→工单、报告更新、越界拒绝、walkthrough）'],
].map(([id, t]) => [id, t, G[id]]);
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
writeFileSync(join(out, 'accept-v1.4.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
writeFileSync(join(out, 'accept-v1.4.md'), [`# accept:v1.4（${report.generatedAt}）`, '', line, '', `待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}（条目内检查项计数）`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}（单测结果 ${results.length} 条）；待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
