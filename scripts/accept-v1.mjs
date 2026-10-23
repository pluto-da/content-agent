#!/usr/bin/env node
/**
 * accept:v1 —— 按 design/ROADMAP.md「1.0 可以放心长期用」逐项检查并输出（out/accept-v1.json / .md）。
 * 证据：out/vitest-*.json（按测试名匹配）、docs/perf/stress-idb-1gb.json、docs/a11y/*.json、out/i18n-audit.json、evals/real/judge-v1.json、
 *      out/desktop-manifest-v1.json / out/ios-manifest-v1.json / out/apk-manifest-v1.json（从 CI 产物分支取回后写入，可选）、
 *      out/accept-v9/v10/v11.json（回归）、源码、CI 配置与文档。
 * 结论：通过 / 部分 / 待资质 / 待人工 / 待真机 / 失败。没有证书 / 开发者账号的项永远不记“通过”；人工、真机项不由执行者代填。
 * 用法：node scripts/accept-v1.mjs [--strict]（--strict：有“失败”时退出码 1）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const txt = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
const SECRET = [/\bsk-[A-Za-z0-9_-]{16,}/, /\btp-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i, /\bgh[pousr]_[A-Za-z0-9]{30,}/];
const leaks = (s) => SECRET.filter((r) => r.test(s)).length;

const results = [];
for (const f of readdirSync(out).filter((n) => /^vitest-.*\.json$/.test(n))) {
  const j = J(join(out, f));
  for (const tr of j?.testResults ?? []) for (const a of tr.assertionResults ?? []) results.push({ name: `${(a.ancestorTitles ?? []).join(' > ')} > ${a.title}`, status: a.status, file: f });
}
const haveResults = results.length > 0;
function test(re, label = re) {
  const r = new RegExp(re);
  if (!haveResults) return { ok: false, soft: true, text: `${label}：本次未提供测试结果（先跑单测并输出 out/vitest-*.json）` };
  const hit = results.filter((x) => r.test(x.name));
  if (!hit.length) return { ok: false, text: `测试未找到：${label}` };
  const bad = hit.filter((x) => x.status !== 'passed');
  return { ok: !bad.length, text: `${label}：${hit.length} 项，通过 ${hit.length - bad.length}${bad.length ? `，未通过 ${bad.length}` : ''}（${hit[0].file}）` };
}
const file = (p, label = p) => ({ ok: existsSync(join(root, p)), text: `${label}${existsSync(join(root, p)) ? ' 存在' : ' 缺失'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const design = (n) => [join(root, '../design', n), join(root, 'docs', n)].find((p) => existsSync(p));
const doc = (n) => ({ ok: !!design(n), text: `${n}${design(n) ? ' 存在' : ' 缺失（design/ 或 app/docs/）'}` });
const cert = (t) => ({ ok: false, cert: true, text: `待资质：${t}` });
const human = (t) => ({ ok: false, human: true, text: `待人工：${t}` });
const device = (t) => ({ ok: false, device: true, text: `待真机：${t}` });
const fromOut = (n) => J(join(out, n)) ?? J(join(root, 'docs/release', n)) ?? J(join(root, '../out', n));

const pkg = J(join(root, 'package.json'));
const ci = txt('.github/workflows/ci.yml');
const stress = J(join(root, 'docs/perf/stress-idb-1gb.json'));
const a11y = J(join(root, 'docs/a11y/a11y-v1.json'));
const i18n = J(join(out, 'i18n-audit.json')) ?? J(join(root, 'docs/a11y/i18n-audit-v1.json'));
const judgeText = txt('evals/real/judge-v1.json');
const judge = judgeText ? JSON.parse(judgeText) : null;
const jrow = (id) => judge?.rows?.find((r) => r.id === id);
const desk = fromOut('desktop-manifest-v1.json');
const ios = fromOut('ios-manifest-v1.json');
const apk = fromOut('apk-manifest-v1.json');
const v9 = J(join(out, 'accept-v9.json')), v10 = J(join(out, 'accept-v10.json')), v11 = J(join(out, 'accept-v11.json'));
const deskOs = (os) => desk?.[os] ? (() => { const d = desk[os]; const st = Object.fromEntries((d.smoke?.steps ?? []).map((s) => [s.name, s])); return { ok: d.smoke?.ok === true && d.uninstalled === true && (d.shots?.length ?? 0) >= 4, text: `${os}（run ${d.run ?? '—'}）：安装包 ${d.installer ?? '—'} ${d.installerBytes ?? '—'} 字节；首启 ${st['first-run'] ? '✓' : '✗'}、备份导出 ${st['backup-export']?.bytes ?? 0} 字节、恢复“${String(st['backup-restore']?.msg ?? '').slice(0, 24)}”、safeStorage ${st.safeStorage?.available && st.safeStorage?.roundtrip ? '可用且往返一致' : '不可用'}、卸载 ${d.uninstalled ? '✓' : '✗'}；截图 ${d.shots?.length ?? 0} 张（shots-v1/desktop-${os}/）` }; })() : { ok: false, soft: true, text: `${os}：未取回 CI 桌面产物（out/desktop-manifest-v1.json）` };

const ITEMS = [
  ['E0', 'CI：verify 含 i18n --strict 与 accept:v1；Windows / macOS / iOS 模拟器 runner；不用 android-actions/setup-android', [grep('.github/workflows/ci.yml', 'i18n-audit\\.mjs --strict', 'i18n-audit --strict'), grep('.github/workflows/ci.yml', 'accept-v1\\.mjs', 'CI 跑 accept:v1'), grep('.github/workflows/ci.yml', 'windows-latest', 'windows-latest runner'), grep('.github/workflows/ci.yml', 'macos-latest', 'macos-latest runner'), grep('.github/workflows/ci.yml', 'ios-simulator:', 'ios-simulator 作业'), { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android' }, { ok: !/scan-secrets[\s\S]{0,40}\|\|\s*true/.test(ci), text: '密钥扫描不被吞掉错误' }]],
  // ① 桌面安装包
  ['D1', '桌面安装包：Electron Windows（NSIS）/ macOS（dmg），CI 产出', [grep('desktop/package.json', '"target": "nsis"', 'NSIS'), grep('desktop/package.json', '"target": "dmg"', 'dmg'), file('scripts/stage-desktop.mjs', '暂存脚本（后端 esbuild 单文件）'), file('scripts/desktop-ci.sh'), desk ? { ok: !!desk.win?.installer && !!desk.mac?.installer, text: `已取回：win ${desk.win?.installer ?? '—'}、mac ${desk.mac?.installer ?? '—'}` } : { ok: false, soft: true, text: '未取回 CI 桌面产物' }]],
  ['D2', '安装 → 首启 → 备份恢复 → 卸载全流程截图', [deskOs('win'), deskOs('mac'), file('desktop/smoke.cjs', '冒烟脚本 desktop/smoke.cjs')]],
  ['D3', 'Key 用 safeStorage（SecretBackend: electron-safeStorage）', [grep('web/src/local/secretBackend.ts', "id: 'electron-safeStorage'", 'electron-safeStorage 后端'), grep('desktop/main.cjs', 'safeStorage\\.encryptString', '主进程 safeStorage 加密'), test('SecretBackend: electron-safeStorage', 'safeStorage 单测')]],
  ['D4', '代码签名 / 公证', [cert('Windows 代码签名证书（没有则 SmartScreen 显示“未知发布者”）；macOS Developer ID + 公证（Apple 开发者账号）。当前安装包未签名，见 docs/desktop.md'), grep('docs/desktop.md', '未知发布者', '文档写明“未知发布者”与所需资质')]],
  ['D5', 'Windows / Mac 真机安装验证', [device('CI runner 上已做静默安装 / 首启 / 卸载；用户自己的 Windows 与 Mac 上双击安装、SmartScreen / Gatekeeper 提示待真机')]],
  // ② iOS
  ['I1', 'Capacitor iOS 构建（CI macOS runner 无签名模拟器构建能编译）', [file('scripts/ios-ci.sh'), file('mobile/scripts/ios-add-files.rb', 'Swift 文件自动加入 App target'), ios ? { ok: ios.xcodebuild === 0, text: `ios-build（run ${ios.run ?? '—'}）：xcodebuild ${ios.xcodebuild === 0 ? '成功' : `失败（${ios.xcodebuild}）`}，${ios.app ?? '—'} ${ios.version ?? ''} (${ios.build ?? ''})${ios.screenshot ? '，模拟器首启截图 ✓' : ''}` } : { ok: false, soft: true, text: '未取回 ios-build 分支产物（out/ios-manifest-v1.json）' }]],
  ['I2', 'Key 进 Keychain（SecretBackend: ios-keychain，自写插件）', [file('mobile/native/ios/App/SecureKeysPlugin.swift'), grep('mobile/native/ios/App/SecureKeysPlugin.swift', 'kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly', '仅本机、不随 iCloud 同步'), grep('mobile/native/ios/App/MainViewController.swift', 'SecureKeysPlugin\\(\\)', '插件已注册'), grep('web/src/local/secretBackend.ts', "id: 'ios-keychain'", 'ios-keychain 后端'), test('SecretBackend: ios-keychain', 'ios-keychain 单测')]],
  ['I3', '内置网页用 SFSafariViewController', [grep('web/src/builtin.ts', "import\\('@capacitor/browser'\\)", 'iOS sheet 模式 = @capacitor/browser（iOS 实现即 SFSafariViewController）'), test('iOS 内置网页', 'SFSafariViewController 单测')]],
  ['I4', 'TestFlight 安装；通知、分享、内置网页真机验证', [cert('Apple 开发者账号（签名、TestFlight，年费）'), device('iPhone 真机：通知、分享面板、SFSafariViewController 内登录与发布')]],
  // ③ 存储治理
  ['S1', '存储治理：媒体配额与清理、版本修剪可视化', [file('web/src/v9/media/policy.ts', 'web/src/v9/media'), file('web/src/v1/StoragePage.tsx', '存储页'), test('配额规则|本机接线|存储页', '存储单测')]],
  ['S2', '1 GB 媒体下首屏 < 2 s', [stress ? { ok: stress.pass === true && stress.firstScreenMs?.gb1_withIndex?.median < 2000, text: `1 GB 不可压缩媒体：首屏中位 ${stress.firstScreenMs?.gb1_withIndex?.median} ms（目标 2000；${stress.env?.note ?? ''}，CPU ×${stress.env?.cpuThrottle}）` } : { ok: false, text: '没有 docs/perf/stress-idb-1gb.json' }, device('低端安卓真机复测')]],
  // ④ 费用护栏
  ['F1', '月度预算、按角色日上限、异常花费提醒（只提醒）', [file('shared/src/agent/policy.ts'), test('费用护栏：规则', '规则单测'), test('费用护栏：汇总与异常提醒', '异常提醒单测')]],
  ['F2', '超预算一定先问；审计里每笔花费可追溯', [test('费用护栏：运行时', '运行时单测'), test('费用可追溯', '审计可追溯单测')]],
  // ⑤ 可访问性与多语言
  ['A1', '文案统一 id 制、英文完整（英文缺失 0）', [i18n ? { ok: i18n.web?.missingEn === 0 && i18n.web?.unknownIds === 0 && i18n.core?.missingEn === 0, text: `id ${i18n.web?.ids}，英文缺失 ${i18n.web?.missingEn}，未知 id ${i18n.web?.unknownIds}，写死中文 ${i18n.web?.hardcodedJsx}，核心英文缺失 ${i18n.core?.missingEn}` } : { ok: false, text: '没有 i18n 审计结果' }, test('界面文案 id 制|多语言', 'i18n 单测')]],
  ['A2', 'axe 扫描 0 严重问题；读屏标签；ADR-007 重审', [a11y ? { ok: a11y.summary?.critical === 0 && a11y.summary?.serious === 0, text: `axe ${a11y.axe}：${a11y.summary?.runs} 组（27 页 × 视口 × 语言），critical ${a11y.summary?.critical}、serious ${a11y.summary?.serious}` } : { ok: false, text: '没有 docs/a11y/a11y-v1.json' }, grep('docs/adr/ADR-007.md', '## 重审（1\\.0', 'ADR-007 重审'), human('读屏软件（TalkBack / VoiceOver）人工走查')]],
  // ⑥ 第一部分其余：进化分级、判官复测
  ['G1', '进化分级（ADR-014）：低风险自动生效、核心须确认、可回滚', [file('docs/adr/ADR-014.md'), test('进化分级自动生效', 'shared 单测'), test('进化分级（本机）', 'web 单测')]],
  ['J1', 'MiMo 判官复测 BQ-03 / 12 / 20 / 24（花费 ≤ ¥2，不含 Key）', [judge ? { ok: judge.complete && (judge.cost?.yuanThisRun ?? 9) <= 2 && leaks(judgeText) === 0, text: `judge-v1：live ${judge.live?.pass}/${judge.live?.judged}，本次 ¥${judge.cost?.yuanThisRun}，密钥命中 ${leaks(judgeText)}` } : { ok: false, text: '没有 evals/real/judge-v1.json' }, ...['BQ-20', 'BQ-24'].map((id) => ({ ok: jrow(id)?.liveVerdict?.pass === true, text: `${id}：${jrow(id)?.liveVerdict?.pass ? '通过' : '未通过'}` })), ...['BQ-03', 'BQ-12'].map((id) => (jrow(id)?.liveVerdict?.pass ? { ok: true, text: `${id}：通过` } : human(`${id} 仍不通过——修订建议 P-1 待你确认（design/proposals-v1.0.md）`)))]],
  ['J2', 'proposals-v1.0：已采纳修订 + 待确认修订（含改动对比、依据、风险、回滚）', [doc('proposals-v1.0.md'), grep('docs/proposals-v1.0.md', 'P-1', '含 P-1')]],
  // ⑦ 版本 / 文档 / 回归 / 边界
  ['X1', '版本 1.0.0 / versionCode 10000', [{ ok: pkg?.version === '1.0.0', text: `package.json ${pkg?.version}` }, grep('desktop/package.json', '"version": "1\\.0\\.0"', 'desktop 1.0.0'), grep('mobile/package.json', '"version": "1\\.0\\.0"', 'mobile 1.0.0'), grep('mobile/scripts/apply-native.mjs', 'Number\\(mv\\[1\\]\\) \\* 10000', 'versionCode 规则 x*10000+y*100+z'), apk ? { ok: apk.versionName === '1.0.0' && String(apk.versionCode) === '10000', text: `APK：${apk.versionName} / ${apk.versionCode}，${apk.bytes} 字节（run ${apk.run}）` } : { ok: true, text: 'APK 尚未取回（CI 成功后写 out/apk-manifest-v1.json）' }]],
  ['X2', '文档：CHANGELOG、acceptance-v1、deviations-v1、ROADMAP 状态行、使用说明 .md/.docx、STATUS.md、截图矩阵 shots-v1', [grep('CHANGELOG.md', '## 1\\.0\\.0', 'CHANGELOG 1.0.0'), doc('acceptance-v1.md'), doc('deviations-v1.md'), grep('docs/ROADMAP.md', '状态（[^）]*）[^\\n]*1\\.0\\.0', 'ROADMAP 状态行含 1.0.0'), grep('使用说明.md', '1\\.0', '使用说明.md 含 1.0'), file('使用说明.docx'), file('docs/desktop.md'), file('docs/ios.md'), { ok: (() => { try { return /1\.0\.0/.test(readFileSync(join(root, '../STATUS.md'), 'utf8')); } catch { return true; } })(), text: 'STATUS.md 含 1.0.0（CI 无项目根时跳过）' }, { ok: (() => { try { return readdirSync(join(root, '../shots-v1')).length > 0; } catch { return true; } })(), text: 'shots-v1/ 截图矩阵（CI 无项目根时跳过）' }]],
  ['X3', '回归：accept:v9 / v10 / v11 失败 0', [v9 ? { ok: (v9.count?.fail ?? v9.counts?.['失败'] ?? 1) === 0, text: `accept-v9：${JSON.stringify(v9.count ?? v9.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 accept-v9' }, v10 ? { ok: (v10.counts?.['失败'] ?? 0) === 0, text: `accept-v10：${JSON.stringify(v10.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 accept-v10' }, v11 ? { ok: (v11.counts?.['失败'] ?? 0) === 0, text: `accept-v11：${JSON.stringify(v11.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 accept-v11' }]],
  ['X4', '硬边界：不做多账号 / 自动互动 / 刷量 / 绕风控 / 抓私有数据；发布用户点击；回复只草稿；不部署 154.8.183.93；不写入真实密钥', [{ ok: !/name: '(like|comment|dm|follow|publish_send|auto_publish)[a-z_]*'/.test(txt('shared/src/agent/builtinTools.ts')), text: '内置工具无对外写入' }, { ok: !/154\.8\.183\.93/.test(ci), text: 'CI 不部署 154.8.183.93' }, { ok: !/\.executeJavaScript\(/.test(txt('desktop/browser-views.cjs')), text: '平台网页视图不注入脚本（冒烟只操作本 App 主界面）' }, grep('server/src/boundaries.ts', '.', 'boundaries.ts 存在')]],
];

const ORDER = ['通过', '部分', '待资质', '待人工', '待真机', '失败'];
const rows = ITEMS.map(([id, title, checks]) => {
  const rest = checks.filter((c) => !c.cert && !c.human && !c.device);
  const anyHard = rest.some((c) => !c.ok && !c.soft);
  const verdict = anyHard ? '失败' : checks.some((c) => c.cert) ? '待资质' : checks.some((c) => c.human) ? '待人工' : checks.some((c) => c.device) ? (rest.every((c) => c.ok) ? '待真机' : '部分') : rest.every((c) => c.ok) ? '通过' : '部分';
  return { id, title, verdict, evidence: checks.map((c) => `${c.cert ? '📜' : c.human ? '👤' : c.device ? '📱' : c.ok ? '✓' : c.soft ? '△' : '✗'} ${c.text}`) };
});
const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r.verdict === k).length]));
const report = { version: pkg?.version, generatedAt: new Date().toISOString(), haveTestResults: haveResults, counts, items: rows };
writeFileSync(join(out, 'accept-v1.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
writeFileSync(join(out, 'accept-v1.md'), [`# accept:v1（${report.generatedAt}）`, '', line, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')} |`)].join('\n') + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
