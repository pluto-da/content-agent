#!/usr/bin/env node
/**
 * accept:v1.3 —— 按 PROMPT-v1.3-conglomerate 第十七部分 F1–F22 逐项检查（out/accept-v1.3.json / .md）。
 * 证据：out/vitest-*.json（按单测名匹配）、docs/*-v1.3.md、docs/refs-v1.3/、docs/shots/shots-v1.3.json、docs/walkthrough/walkthrough-v1.3.json、evals/real/mimo-v1.3.json、docs/release/*-v1.3.json、out/accept-*.json（回归）、源码。
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
const exists = (p) => existsSync(join(root, p));
const file = (p, label = p) => ({ ok: exists(p), text: `${label}${exists(p) ? ' 存在' : ' 缺失'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const docPath = (n) => [join(root, 'docs', n), join(root, '../design', n)].find((p) => existsSync(p));
const docTxt = (n) => { const p = docPath(n); return p ? readFileSync(p, 'utf8') : ''; };
const device = (t) => ({ ok: false, device: true, text: `待真机：${t}` });
const cert = (t) => ({ ok: false, cert: true, text: `待资质：${t}` });
const needKey = (t) => ({ ok: false, key: true, text: `待 Key：${t}` });
const soft = (t) => ({ ok: false, soft: true, text: t });


// ---- 证据文件
const g = (n) => txt(`shared/src/group/${n}.ts`);
const shots = J(join(root, 'docs/shots/shots-v1.3.json'));
const wt = J(join(root, 'docs/walkthrough/walkthrough-v1.3.json'));
const proposals = docTxt('proposals-v1.3.md');
const sr = docTxt('self-review-v1.3.md');
const ci = txt('.github/workflows/ci.yml');
const mimo = J(join(root, 'evals/real/mimo-v1.3.json'));
const reg = (n) => { const j = J(join(out, `accept-${n}.json`)); if (!j) return soft(`先运行 accept-${n}`); const f = j.count?.fail ?? j.counts?.['失败'] ?? 0; return { ok: f === 0, text: `accept-${n}：失败 ${f}` }; };
const i18n = J(join(out, 'i18n-audit.json'));
const sum = shots?.summary;

const F = {
  F1: [test('F1 融合组织'), file('shared/src/group/org.ts', '组织模型 shared/src/group/org.ts'), test('F9 / F10 / F11 / F12 / F13 在 App 里', 'F9 / F10 / F11 / F12 / F13 在 App 里 > 赛马')],
  F2: [test('F2 DEPT / COMMITTEE 清单与编制上限'), test('F16 集团模式默认关闭，可启用与退回 > 默认关闭；启用写入')],
  F3: [test('F3 10 项制度齐全'), { ok: /参照[^。\n]*公开报道[^。\n]*非任何公司官方制度/.test(g('regulations')), text: '制度注明“参照公开报道，非任何公司官方制度”' }, { ok: /集团章程/.test(proposals) && /DOA/.test(proposals), text: `proposals-v1.3.md ${proposals ? '含集团章程与 DOA 默认值（高风险文件只进 proposals）' : '缺失'}` }],
  F4: [test('F4 DOA 引擎执行'), file('shared/src/group/doa.ts', 'DOA 引擎')],
  F5: [test('F5 集团上下文流与 OKR 公开'), test('F5 / F6 目标 → 冲突')],
  F6: [test('F6 临时会话'), test('F5 / F6 目标 → 冲突')],
  F7: [test('F7 7 个常设会议室'), test('F7 / F8 会议在 App 里')],
  F8: [test('F8 讨论协议六步')],
  F9: [test('F9 赛马'), test('F9 / F10 / F11 / F12 / F13 在 App 里 > 赛马')],
  F10: [test('F10 灰度试行与自动回滚'), test('灰度：20% 试行')],
  F11: [test('F11 否决、申诉、升级路径、董事长终裁'), test('F11 否决须引用条款')],
  F12: [test('F12 复盘四步与 lesson 沉淀'), test('季度复盘、360、政委建议')],
  F13: [test('F13 360 评议、政委、任免')],
  F14: [test('F14 “统领”页 7 个子页'), test('F14 驾驶舱与指挥条入口'),
    sum ? { ok: sum.combos === 12 && sum.overflow === 0 && sum.overlap === 0 && sum.truncated === 0 && sum.smallTargets === 0 && sum.spill === 0 && sum.squeezed === 0 && sum.consoleErrors === 0 && sum.pageErrors === 0, text: `截图矩阵 ${sum.combos} 组合 ${sum.shots} 张：溢出 ${sum.overflow} 重叠 ${sum.overlap} 截断 ${sum.truncated} 小触控 ${sum.smallTargets} 溢字 ${sum.spill} 挤压 ${sum.squeezed} 控制台 ${sum.consoleErrors} 报错 ${sum.pageErrors}；英文中文残留（仅报告）${sum.cjkInEnReportOnly}` } : soft('没有 docs/shots/shots-v1.3.json'),
    sum ? { ok: sum.axeCritical === 0 && sum.axeSerious === 0, text: `axe 严重 ${sum.axeCritical} / 重要 ${sum.axeSerious}` } : soft('没有 axe 结果')],
  F15: [test('F15 @部门 / @委员会 / 拉群 / 开会 / 赛马 指令'), test('F15 对话指令')],
  F16: [test('F16 集团模式默认关闭，可启用与退回')],
  F17: [test('会话不提升权限', '会话.*不.*提升权限|不提升权限|不提权'), test('硬边界决议被拒', '硬边界决议被拒|硬边界决议'), test('F17 / F18 全部暂停对集团生效')],
  F18: [test('F18 开会花费占比与 30% 提醒')],
  F19: [test('F19 8 个历史版本备份')],
  F20: [wt ? { ok: Object.keys(wt.paths ?? {}).length === 2 && Object.values(wt.paths).every((p) => p.ok), text: `walkthrough：${Object.entries(wt.paths ?? {}).map(([k, v]) => `${k} ${v.steps.filter((s) => s.ok).length}/${v.steps.length}`).join('；')}` } : soft('没有 docs/walkthrough/walkthrough-v1.3.json'),
    sr ? { ok: !/状态：未处理|\| *未处理 *\|/.test(sr), text: `self-review-v1.3.md 未处理项 ${(sr.match(/状态：未处理|\| *未处理 *\|/g) ?? []).length}` } : soft('没有 self-review-v1.3.md')],
  F21: [mimo ? (mimo.status === '待 Key' ? needKey('MiMo 实测未发出请求（没有 Key）') : { ok: mimo.status === '通过' && (mimo.cost?.yuan ?? 9) <= 3 && leaks(JSON.stringify(mimo)) === 0, text: `MiMo：${mimo.status}，花费 ¥${mimo.cost?.yuan}（≤¥3），${mimo.cost?.calls} 次调用，Key 扫描 ${leaks(JSON.stringify(mimo))}` }) : soft('没有 evals/real/mimo-v1.3.json')],
};
const ciRun = J(join(root, 'docs/release/ci-v1.3.json'));
const apk = J(join(root, 'docs/release/apk-manifest-v1.3.json'));
const desk = J(join(root, 'docs/release/desktop-manifest-v1.3.json'));
const arts = J(join(root, 'docs/release/artifacts-v1.3.json'));
const pkgs = ['.', 'shared', 'server', 'web', 'desktop', 'mobile'];
const semverGte = (a, b) => { const x = String(a ?? '0').split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); } return true; };
F.F22 = [
  ...pkgs.map((w) => { const v = J(join(root, w, 'package.json'))?.version; return { ok: semverGte(v, '1.3.0'), text: `${w === '.' ? '' : `${w}/`}package.json ${v}（1.4.0 起作回归：≥ 1.3.0）` }; }),
  ...['server', 'web'].map((w) => { const d = J(join(root, w, 'package.json'))?.dependencies?.['@content-agent/shared']; return { ok: semverGte(d, '1.3.0'), text: `${w} 依赖 @content-agent/shared ${d}（≥ 1.3.0）` }; }),
  { ok: Object.entries(J(join(root, 'package-lock.json'))?.packages ?? {}).filter(([k]) => ['', 'shared', 'server', 'web', 'desktop', 'mobile'].includes(k)).every(([, v]) => semverGte(v.version, '1.3.0')), text: 'package-lock 工作区版本 ≥ 1.3.0' },
  grep('server/src/app.ts', "version: '1\\.(?:[3-9]|\\d{2,})\\.\\d+'", 'server /api/health ≥ 1.3.0'),
  grep('server/src/app.ts', "a2aOptsFromEnv\\('1\\.(?:[3-9]|\\d{2,})\\.\\d+'\\)", 'A2A Agent Card 版本 ≥ 1.3.0'),
  grep('web/src/local/router.ts', "version: '1\\.(?:[3-9]|\\d{2,})\\.\\d+'", '本机 /api/health ≥ 1.3.0'),
  grep('mobile/scripts/apply-native.mjs', 'Number\\(mv\\[1\\]\\) \\* 10000', 'versionCode = x*10000+y*100+z（1.3.0 → 10300）'),
  grep('.github/workflows/ci.yml', 'accept-v1\\.3\\.mjs --strict', 'CI 跑 accept-v1.3 --strict'),
  grep('.github/workflows/ci.yml', 'name: reports-1\\.(?:[3-9]|\\d{2,})\\.\\d+', 'CI 报告产物 reports-1.x（1.4.0 起作回归：≥ reports-1.3.0）'),
  { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android' },
  { ok: !/154\.8\.183\.93/.test(ci), text: 'CI 不部署 154.8.183.93' },
  reg('v9'), reg('v10'), reg('v11'), reg('v1'), reg('v1.1'), reg('v1.2'),
  i18n ? { ok: i18n.web?.missingEn === 0 && i18n.web?.unknownIds === 0, text: `i18n：英文缺失 ${i18n.web?.missingEn}、未知 id ${i18n.web?.unknownIds}` } : soft('没有 out/i18n-audit.json'),
  ciRun ? { ok: (ciRun.jobs ?? []).every((j) => j.conclusion === 'success'), text: `CI run ${ciRun.run}` } : soft('CI 结论未取回（GitHub Actions 被账单拦截，以本地验证为准）'),
  apk ? { ok: apk.versionName === '1.3.0' && String(apk.versionCode) === '10300', text: `APK：${apk.versionName} / ${apk.versionCode}` } : soft('APK 未取回（CI 被账单拦截）'),
  desk ? { ok: !!desk.win?.installer && !!desk.mac?.installer, text: '桌面包' } : soft('桌面包未取回（CI 被账单拦截）'),
  arts ? { ok: (arts.files ?? []).every((f) => f.bytes > 0 && /^[0-9a-f]{64}$/.test(f.sha256)), text: (arts.files ?? []).map((f) => `${f.name} ${f.bytes} 字节`).join('；') } : soft('产物字节数与 sha256 未记录（CI 被账单拦截，未产出安装包）'),
  device('APK 在安卓手机安装、Windows / Mac 双击安装（未签名）'),
  cert('Windows 代码签名证书、Apple 开发者账号（签名 / 公证 / TestFlight）'),
];
const ITEMS = [
  ['F1', '融合组织：4 职能部门 + 4 事业部 + 共享能力中心 + 5 委员会，可增删改合并'], ['F2', 'DEPT / COMMITTEE 清单与编制上限'], ['F3', '10 项制度齐全，注明参照来源；修改走 L3，可回滚'],
  ['F4', 'DOA 引擎执行，越权拦截并审计'], ['F5', '集团上下文流与 OKR 公开、对齐请求；私密不泄漏'], ['F6', '临时会话 6 种触发、自动推荐成员、上限 / TTL / √ 解散、小结转工单、可升级为会议'],
  ['F7', '7 个常设会议室，含预约、会前文档、白板、主持、纪要、旁听介入、回放'], ['F8', '讨论协议六步、独立陈述、质询全覆盖、防空转、表达规范打分'], ['F9', '赛马（≤3 匹、专项预算、盲评、落选入库、效果统计）'],
  ['F10', '灰度试行与自动回滚'], ['F11', '否决、申诉、升级路径、董事长终裁'], ['F12', '复盘四步与 lesson 沉淀'], ['F13', '360 评议、政委（只建议不指挥）、任免流程'],
  ['F14', '“统领”页 7 个子页完整，三布局截图 0 问题，axe 0 严重'], ['F15', '@部门 / @委员会 / 拉群 / 开会 / 赛马 指令正确'], ['F16', '集团模式默认关闭，可启用与退回'],
  ['F17', '会话 / 会议 / 决议不提升权限；硬边界决议被拒'], ['F18', '开会花费占比与 30% 提醒'], ['F19', '8 个历史版本备份迁移与降级通过'],
  ['F20', 'walkthrough 两条路径通过；self-review 无未处理项'], ['F21', 'MiMo 实测通过，≤ ¥3，无 Key 泄漏'], ['F22', '全部回归与 CI 通过；1.3.0 / 10300；APK、zip、桌面包取回并记录字节数与 sha256'],
].map(([id, t]) => [id, t, F[id]]);
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
writeFileSync(join(out, 'accept-v1.3.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
writeFileSync(join(out, 'accept-v1.3.md'), [`# accept:v1.3（${report.generatedAt}）`, '', line, '', `待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}（条目内检查项计数）`, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}（单测结果 ${results.length} 条）；待真机 ${pending.device} · 待资质 ${pending.cert} · 待人工 ${pending.human} · 待 Key ${pending.key}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
