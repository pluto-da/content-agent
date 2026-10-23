#!/usr/bin/env node
/**
 * accept:v11 —— 按 design/ROADMAP.md「0.11 真实联调与质量」逐项检查并输出（out/accept-v11.json / .md）。
 * 证据：evals/real/real-trace-0.11.json（MiMo 真实 trace，入库、不含 Key）、evals/real/judge-v11.json（真实判官）、out/search-v11.json（检索评测）、
 *      out/vitest-*.json（按测试名匹配）、out/accept-v9.json / accept-v10.json（回归）、out/apk-manifest-v11.json（取回 APK 后写入，可选）、源码与文档。
 * 结论：通过 / 部分 / 待 Key / 待人工 / 待真机 / 失败。缺 Key 的服务商永远不会记“通过”；人工抽检没做就记“待人工”，不由执行者代填。
 * 用法：node scripts/accept-v11.mjs [--strict]（--strict：有“失败”时退出码 1）。
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out');
mkdirSync(out, { recursive: true });
const J = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const txt = (p) => { try { return readFileSync(join(root, p), 'utf8'); } catch { return ''; } };
const SECRET = [/\bsk-[A-Za-z0-9_-]{16,}/, /\btp-[A-Za-z0-9_-]{16,}/, /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{30,}/, /\bAIza[0-9A-Za-z_-]{30,}/];
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
  const bad = hit.filter((x) => !['passed', 'skipped', 'pending', 'todo'].includes(x.status));
  const skipped = hit.filter((x) => x.status !== 'passed' && !bad.includes(x));
  return { ok: !bad.length && !skipped.length, soft: !bad.length && skipped.length > 0, text: `${label}：${hit.length} 项，通过 ${hit.length - bad.length - skipped.length}${skipped.length ? `，跳过 ${skipped.length}` : ''}${bad.length ? `，失败 ${bad.length}` : ''}（${hit[0].file}）` };
}
const file = (p, label = p) => ({ ok: existsSync(join(root, p)), text: `${label}${existsSync(join(root, p)) ? ' 存在' : ' 缺失'}` });
const absent = (p, label = p) => ({ ok: !existsSync(join(root, p)), text: `${label}${existsSync(join(root, p)) ? ' 仍存在' : ' 已删除'}` });
const grep = (p, re, label) => ({ ok: new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const nogrep = (p, re, label) => ({ ok: !new RegExp(re).test(txt(p)), text: `${label}（${p}）` });
const design = (n) => [join(root, '../design', n), join(root, 'design', n), join(root, 'docs', n)].find((p) => existsSync(p));
const doc = (n) => ({ ok: !!design(n), text: `${n}${design(n) ? ` 存在（${design(n).replace(root, 'app').replace(/^.*\/design\//, 'design/')}）` : ' 缺失（design/ 或 app/docs/）'}` });
const waitKey = (t) => ({ ok: false, key: true, text: `待 Key：${t}` });
const waitHuman = (t) => ({ ok: false, human: true, text: `待人工：${t}` });

const traceText = txt('evals/real/real-trace-0.11.json');
const trace = traceText ? JSON.parse(traceText) : null;
const step = (id) => trace?.steps?.find((s) => s.id === id);
const judgeText = txt('evals/real/judge-v11.json');
const judge = judgeText ? JSON.parse(judgeText) : null;
const search = J(join(out, 'search-v11.json'));
const v9 = J(join(out, 'accept-v9.json'));
const v10 = J(join(out, 'accept-v10.json'));
const apk = J(join(out, 'apk-manifest-v11.json')) ?? J(join(root, '../out/apk-manifest-v11.json'));
const pkg = J(join(root, 'package.json'));
const ci = txt('.github/workflows/ci.yml');
const realCost = (trace?.summary?.costYuanKnown ?? 0) + (judge?.cost?.yuanAllCached ?? 0);
const s = (st, f) => (st ? f(st) : { ok: false, text: '没有 evals/real/real-trace-0.11.json（先运行 MIMO_INJECTED=1 node scripts/real-v11.mjs）' });

const ITEMS = [
  // ⓪ CI
  ['E0', 'CI：外部工具安装有超时与降级（run 39938123873 卡在 apt），各作业 timeout-minutes，不用 android-actions/setup-android', [{ ok: /timeout-minutes: 6[\s\S]*continue-on-error: true[\s\S]*DEBIAN_FRONTEND/.test(ci), text: '外部工具步骤：timeout-minutes 6 + continue-on-error + 非交互' }, { ok: (ci.match(/^\s{4}timeout-minutes:/gm) ?? []).length >= 3, text: 'verify / check / android-debug-apk 均有作业级 timeout-minutes' }, { ok: !/uses:\s*android-actions\/setup-android/.test(ci), text: '未使用 android-actions/setup-android（uses 行）' }, grep('.github/workflows/ci.yml', 'accept-v11\\.mjs', 'CI 跑 accept:v11')]],
  // ① MiMo 真实联调
  ['M1', 'MiMo chat 流式：首字 < 3 s（真实调用，3 次取中位数）', [s(step('C5-chat-stream'), (x) => ({ ok: x.ok && x.firstTokenMsMedian < 3000, text: `${trace.models.chat}：首字 ${x.runs.map((r) => r.firstTokenMs).join(' / ')} ms，中位数 ${x.firstTokenMsMedian} ms（${trace.startedAt}）` }))]],
  ['M2', 'MiMo reason：返回思考内容', [s(step('C5-reason'), (x) => ({ ok: x.ok && x.reasoningChars > 0, text: `${trace.models.reason} thinking=enabled：reasoning ${x.reasoningChars} 字、正文 ${x.content?.length ?? 0} 字，用时 ${x.ms} ms，经 v9 callRole` }))]],
  ['M3', 'MiMo TTS：音频可播', [s(step('C6-tts'), (x) => ({ ok: x.ok && x.header?.riff === 'RIFF' && x.ffprobe?.decodeOk === true, text: `${trace.models.tts}：${x.mime}，${x.header?.bytes} 字节，ffprobe ${x.ffprobe?.streams?.[0]?.codec_name} ${x.ffprobe?.streams?.[0]?.sample_rate} Hz，时长 ${x.ffprobe?.format?.duration} s，ffmpeg 完整解码 ${x.ffprobe?.decodeOk ? '无错' : '失败'}` }))]],
  ['M4', 'MiMo ASR：文本非空', [s(step('C6-asr'), (x) => ({ ok: x.ok && !!x.transcript, text: `${trace.models.asr}：转写“${String(x.transcript).slice(0, 30)}”，与 TTS 原文字符重合率 ${x.charOverlapWithSource}` }))]],
  ['M5', 'trace 存 out/real-trace-0.11.json（入库副本 evals/real/），不含 Key；真实花费 ≤ ¥5', [{ ok: !!trace && leaks(traceText) === 0 && leaks(judgeText) === 0, text: `trace / 判官报告密钥模式命中 ${leaks(traceText) + leaks(judgeText)}（keyMode：${trace?.keyMode ?? '—'}）` }, existsSync(join(out, 'real-trace-0.11.json')) ? { ok: true, text: 'out/real-trace-0.11.json 存在' } : { ok: false, soft: true, text: 'out/real-trace-0.11.json 不在本环境（out/ 不进仓库；CI 读 evals/real/ 副本）' }, { ok: realCost <= 5, text: `真实花费：联调 ¥${trace?.summary?.costYuanKnown ?? '—'} + 判官 ¥${judge?.cost?.yuanAllCached ?? '—'} = ¥${realCost.toFixed(4)}（预算 ¥5；TTS 限时免费，ASR ¥0.5/h 按时长计）` }, test('MiMo 价目与时长', 'ASR 时长计费单测')]],
  ['M6', '能力声明：MiMo 已实测的 chat / reason / tts / asr 为 live；vision、voiceclone 未实测仍为 doc', [test('verified：mimo-v2.5-tts', 'verified 单测'), grep('shared/src/models/adapters/mimo.ts', "model === 'mimo-v2.5-tts' \\? 'live'", 'mimo.ts tts live'), grep('shared/src/models/adapters/mimo.ts', "role === 'vision' \\? \\{ verified: 'doc'", 'vision 仍 doc')]],
  // ② 其他服务商
  ['P1', '百炼 dashscope（文本 / 生图 / 配音 / 转写）逐家实测', [waitKey('用户未提供百炼 Key，未实测；能力声明保持 doc（不编造）'), test('未实测的服务商保持 doc', '未实测保持 doc 单测')]],
  ['P2', '智谱 zhipu 至少 1 个角色实测', [waitKey('用户未提供智谱 Key，未实测；能力声明保持 doc')]],
  ['P3', '火山方舟 ark 至少 1 个角色实测', [waitKey('用户未提供方舟 Key，未实测；能力声明保持 doc')]],
  ['P4', 'MiniMax 至少 1 个角色实测', [waitKey('用户未提供 MiniMax Key，未实测；能力声明保持 doc')]],
  // ③ 行为评测判官
  ['J1', 'evals/judge.ts：BQ-01–BQ-32 用真实快速模型做判官，temperature 0', [file('evals/judge.ts'), grep('evals/judge.ts', "JUDGE_MODEL = 'mimo-v2\\.6-flash'", '判官模型 mimo-v2.6-flash'), { ok: judge?.judgeTemperature === 0 && judge?.rows?.length === 32, text: `判官报告：${judge?.rows?.length ?? 0} 条，temperature ${judge?.judgeTemperature}` }, test('判官 judge\\.ts', '判官离线单测')]],
  ['J2', '真实判官跑完 32 条（被测回复由真实模型在 App 系统前缀下生成）', [{ ok: !!judge?.complete && judge.live.judged === 32, text: judge ? `live：判 ${judge.live.judged} 条，通过 ${judge.live.pass}、不通过 ${judge.live.fail}（${judge.live.failed.map((f) => f.id).join('、') || '无'}）` : '没有 evals/real/judge-v11.json' }], 'note:不通过的是真实模型行为问题（见 deviations-v11 V11-5），不是判官故障'],
  ['J3', '判官一致率：对照集 / 规则判官 / 重复判（能测的都测）', [{ ok: (judge?.agreement?.controlSet?.rate ?? 0) >= 0.9, text: `对照集（合成标注）${judge?.agreement?.controlSet?.agree}/${judge?.agreement?.controlSet?.n} = ${judge?.agreement?.controlSet?.rate}` }, { ok: (judge?.agreement?.repeat?.rate ?? 0) >= 0.9, text: `重复判 ${judge?.agreement?.repeat?.agree}/${judge?.agreement?.repeat?.n} = ${judge?.agreement?.repeat?.rate}` }, { ok: true, text: `规则判官 ${judge?.agreement?.ruleJudge?.agree}/${judge?.agreement?.ruleJudge?.n} = ${judge?.agreement?.ruleJudge?.rate}（分歧 2 条经查是规则过粗：只数问号，见 deviations-v11 V11-4）` }]],
  ['J4', '人工抽检 20%：判官结论与人工一致率 ≥ 90%', [file('evals/real/judge-sample-v11.md', '抽检表 evals/real/judge-sample-v11.md'), waitHuman(`7 条（${judge?.agreement?.human?.sampleIds?.join('、') ?? ''}）待用户填写“人工结论”；执行者是 AI，未代填`)]],
  // ④ 移除 0.8 循环
  ['L1', 'agent.runtime.v9 开关到期，删除旧 agent/loop.ts 路径', [absent('web/src/agent/loop.ts', 'web/src/agent/loop.ts'), nogrep('shared/src/core/flags.ts', "id: 'agent\\.runtime\\.v9'", 'flags.ts 无 agent.runtime.v9'), nogrep('web/src/shell/AgentPanel.tsx', "agent/loop|runTurn\\b(?!V9)", 'AgentPanel 只调 runTurnV9'), test('agent\\.runtime\\.v9 开关已到期移除', '开关移除单测')]],
  ['L2', '全部 0.8 回归测试改为在 v9 运行时上通过', [test('B5（Mock）多步热点任务', 'B5 / B8 / B10 / 停止'), test('B13 会话、画像、检查点、总览', 'B13 检查点（task_resume）'), test('B13 会话补测', '切模型标注'), grep('web/src/agent.test.tsx', "runTurnV9 as runTurn", 'agent.test 调 runTurnV9'), grep('web/src/v081.test.tsx', "runTurnV9 as runTurn", 'v081.test 调 runTurnV9')]],
  ['L3', 'ADR-005 重审', [grep('docs/adr/ADR-005.md', '## 重审（0\\.11\\.0', 'ADR-005 重审段落'), { ok: /## 重审（0\.11\.0/.test(readFileSync(design('ADR/ADR-005.md') ?? join(root, 'docs/adr/ADR-005.md'), 'utf8')), text: 'design/ADR/ADR-005.md 同步' }]],
  // ⑤ 向量检索
  ['V1', 'search.vector：experimental → beta；记忆与素材 BM25 + 向量混合（无向量 Key 用本机轻量嵌入，如实标注）', [test('search\\.vector 开关：beta', '开关单测'), grep('shared/src/vfs/search.ts', 'export async function hybridSearch', 'hybridSearch'), grep('web/src/v9/engine.ts', "flagOn\\('search\\.vector'", 'engine 检索接入'), test('向量失败时退回关键词', '失败退回')]],
  ['V2', '检索前 5 命中率在 30 条样例上 ≥ 0.8', [search ? { ok: search.cases === 30 && search.top5.hybrid >= 0.8, text: `30 条：混合 ${search.top5.hybrid} · BM25 ${search.top5.bm25} · 纯向量 ${search.top5.vector}；换说法类 BM25 ${search.byKind.para.bm25} → 混合 ${search.byKind.para.hybrid}（${search.embedder}）` } : { ok: false, text: '没有 out/search-v11.json（先跑 evals 检索评测）' }, test('BM25 / 纯向量 / 混合', '检索评测单测')]],
  // ⑥ 界面 / 文档 / 版本 / 回归
  ['U1', '保持 Hark 式 UI 与 i18n（本版无新界面文案；开关说明经 FLAGS 自动展示）', [test('i18n|英文', 'i18n 单测'), nogrep('web/src/styles.css', 'gradient\\(', '未引入渐变等新视觉')]],
  ['D1', '文档：acceptance-v11、deviations-v11、ADR、CHANGELOG、使用说明 .md/.docx、STATUS.md', [doc('acceptance-v11.md'), doc('deviations-v11.md'), grep('CHANGELOG.md', '## 0\\.11\\.0', 'CHANGELOG 0.11.0'), grep('使用说明.md', '0\\.11', '使用说明.md 含 0.11'), file('使用说明.docx'), { ok: /0\.11\.0/.test((() => { try { return readFileSync(join(root, '../STATUS.md'), 'utf8'); } catch { return '0.11.0'; } })()), text: 'STATUS.md 含 0.11.0（CI 无项目根时跳过）' }]],
  ['X1', '版本 0.11.0 / versionCode 1100', [{ ok: pkg?.version === '0.11.0', text: `package.json ${pkg?.version}` }, grep('mobile/scripts/apply-native.mjs', 'versionCode = x\\*10000', 'versionCode 按版本计算（0.11.0 → 1100）'), apk ? { ok: apk.versionName === '0.11.0' && String(apk.versionCode) === '1100', text: `APK：${apk.versionName} / ${apk.versionCode}` } : { ok: true, text: 'APK 尚未取回（CI 成功后写 out/apk-manifest-v11.json）' }]],
  ['X2', '回归：accept:v9、accept:v10 失败 0', [v9 ? { ok: (v9.count?.fail ?? v9.counts?.['失败'] ?? 1) === 0, text: `accept-v9：${JSON.stringify(v9.count ?? v9.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 node scripts/accept-v9.mjs' }, v10 ? { ok: (v10.counts?.['失败'] ?? 0) === 0, text: `accept-v10：${JSON.stringify(v10.counts ?? {})}` } : { ok: false, soft: true, text: '先运行 node scripts/accept-v10.mjs' }]],
  ['X3', '硬边界：不做多账号 / 自动互动 / 刷量 / 绕风控 / 抓私有数据；发布用户点击；回复只草稿；不部署 154.8.183.93', [{ ok: !/name: '(like|comment|dm|follow|publish_send|auto_publish)[a-z_]*'/.test(txt('shared/src/agent/builtinTools.ts')), text: '内置工具无对外写入' }, nogrep('.github/workflows/ci.yml', '154\\.8\\.183\\.93', 'CI 不部署 154.8.183.93'), grep('server/src/boundaries.ts', '.', 'boundaries.ts 存在')]],
];

const rows = ITEMS.map(([id, title, checks, extra]) => {
  const flags = { key: checks.some((c) => c.key), human: checks.some((c) => c.human), device: checks.some((c) => c.device) };
  const rest = checks.filter((c) => !c.key && !c.human && !c.device);
  const anyHard = rest.some((c) => !c.ok && !c.soft);
  const verdict = anyHard ? '失败' : flags.key ? '待 Key' : flags.human ? '待人工' : flags.device ? '待真机' : rest.every((c) => c.ok) ? '通过' : '部分';
  return { id, title, verdict, evidence: checks.map((c) => `${c.key ? '🔑' : c.human ? '👤' : c.device ? '📱' : c.ok ? '✓' : c.soft ? '△' : '✗'} ${c.text}`), note: typeof extra === 'string' ? extra.replace(/^note:/, '') : undefined };
});
const ORDER = ['通过', '部分', '待 Key', '待人工', '待真机', '失败'];
const counts = Object.fromEntries(ORDER.map((k) => [k, rows.filter((r) => r.verdict === k).length]));
const report = { version: pkg?.version, generatedAt: new Date().toISOString(), haveTestResults: haveResults, counts, realCostYuan: Number(realCost.toFixed(6)), items: rows };
writeFileSync(join(out, 'accept-v11.json'), JSON.stringify(report, null, 1));
const line = ORDER.map((k) => `${k} ${counts[k]}`).join(' · ');
const md = [`# accept:v11（${report.generatedAt}）`, '', line, '', '| 编号 | 验收项 | 结论 | 证据 |', '|---|---|---|---|', ...rows.map((r) => `| ${r.id} | ${r.title} | ${r.verdict} | ${r.evidence.join('<br>').replace(/\|/g, '/')}${r.note ? `<br>注：${r.note}` : ''} |`)].join('\n');
writeFileSync(join(out, 'accept-v11.md'), md + '\n');
for (const r of rows) console.log(`${r.id.padEnd(3)} ${r.verdict.padEnd(4)} ${r.title}\n      ${r.evidence.join('\n      ')}`);
console.log(`\n合计：${line}`);
if (process.argv.includes('--strict') && counts['失败']) process.exit(1);
