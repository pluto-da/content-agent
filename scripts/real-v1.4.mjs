#!/usr/bin/env node
/**
 * 1.4.0 MiMo 实测（PROMPT-v1.4-listed-governance 第十五部分 3 / G24）：1 次董事会、1 次内审抽查、1 份季报、1 场业绩发布会，总花费 ≤ ¥3，trace 不含 Key。
 * 走 App 同一套 shared：defaultBoard / newMotion / secretaryMaterials / independentVotes / chairmanDecide / boardMinutes；runAudit / auditSummary / deliverAudit；
 * buildReport / finalizeReport / checkConsistency（含收入账，第十九部分）；runEarningsCall。
 * 模型：CEO 与年报正文用主模型 mimo-v2.6-pro；独立董事、内审、分析师用另一个 MiMo 模型 mimo-v2.6-flash；两者都按 chat 角色、不开思考（与 App 一致）。
 * 只接入了 MiMo 一家服务商，所以独立董事是“同服务商另一模型”，按规则标注“独立性弱”。
 * 数据：种子数据（演示 / 自检），在报告里标 sim；不代表真实经营结果。
 * Key：MIMO_INJECTED=1 时由网络层按主机注入，脚本不读取真实 Key。输出 evals/real/mimo-v1.4.json（已打码）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callRole, findSecrets, redact,
  defaultBoard, validateBoard, independenceOf, isWeak, INDEPENDENCE_TEXT, newMotion, secretaryMaterials, independentVotes, chairmanDecide, overrideNotice, boardMinutes,
  runAudit, auditSummary, deliverAudit, buildReport, finalizeReport, checkConsistency, editFigure, runEarningsCall, privacyLeaks, checkGovResolution, PEN_NAME,
} from '../shared/dist/index.js';
import { mimoEnv, nodeTransport, mimoState } from './real-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evals', 'real', 'mimo-v1.4.json');
const env = mimoEnv();
const CHEAP = process.env.MIMO_MODEL ?? 'mimo-v2.6-flash';
const MAIN = process.env.MIMO_MAIN_MODEL ?? 'mimo-v2.6-pro';
const BUDGET = 3;
const AT = 'Thu 2026-12-31 4:00 PM CST (UTC+08:00)';
const trace = []; let spent = 0;
const report = { version: '1.4.0', startedAt: new Date().toISOString(), baseURL: env.baseURL, models: { ceo: MAIN, independent: CHEAP, auditor: CHEAP, analyst: CHEAP }, keyMode: env.injected ? '网络层按主机注入（脚本未读取真实 Key）' : '环境变量（报告已打码）', budgetYuan: BUDGET, data: '种子数据（演示 / 自检），报告标 sim；不代表真实经营结果' };

async function main() {
  if (!env.key) { report.status = '待 Key'; report.note = '没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求'; return finish(); }
  const transport = nodeTransport(env.proxy);
  // 与 App 一致（web/src/v14/store.ts 的 speakers 走 chat，不强制思考）：两个模型都按 chat 角色调用，各用一份绑定
  const mk = (model) => ({ state: mimoState({ chat: model }, env.baseURL).state, transport, getKey: async () => env.key, onUsage: (r) => { spent += r.cost ?? 0; } });
  const DEPS = { [CHEAP]: mk(CHEAP), [MAIN]: mk(MAIN) };
  const once = { noFallback: true, retry: { max: 1, baseMs: 800 } };
  /** GovSpeaker：按请求里的 model 选角色（flash → chat，其余 → reason），把每次调用写进 trace（只记长度与打码后的文本）。 */
  const speaker = (stage) => async (q) => {
    if (spent > BUDGET) throw new Error('超出实测预算 ¥3，停止');
    const model = q.model === CHEAP ? CHEAP : q.model === MAIN ? MAIN : (q.tier === 'main' ? MAIN : CHEAP);
    const role = 'chat'; const deps = DEPS[model];
    const t0 = Date.now(); const before = spent;
    const r = await callRole(role, { role, thinking: false, maxTokens: q.maxTokens, temperature: q.temperature, messages: [{ role: 'system', content: q.system }, { role: 'user', content: q.user }] }, deps, once);
    const text = r.ok ? (r.value.text ?? '') : '';
    const cost = r.ok ? (r.cost ?? +(spent - before).toFixed(6)) : 0;
    trace.push({ stage, who: q.who, role: q.role, model, ms: Date.now() - t0, ok: r.ok, request: { systemChars: q.system.length, userChars: q.user.length, head: redact(q.user.slice(0, 100)) }, response: redact(text.slice(0, 600)), usage: r.ok ? r.usage : undefined, costYuan: cost, error: r.ok ? undefined : env.clean(r.error.reason) });
    if (!r.ok) throw new Error(env.clean(r.error.reason));
    return { text, cost };
  };
  const stageCost = (s) => +trace.filter((x) => x.stage === s).reduce((a, x) => a + (x.costYuan ?? 0), 0).toFixed(6);

  // 1）董事会：CEO = MiMo pro；只有 MiMo 一家 → 独立董事绑定 MiMo flash，标“独立性弱”
  const CEO = { vendor: 'mimo', model: MAIN }; const IND = { vendor: 'mimo', model: CHEAP };
  const board = defaultBoard({ ceo: CEO, available: [CEO, IND] });
  const inds = board.directors.filter((d) => d.kind === 'independent');
  const raw = [
    { kind: '花费账', ref: 'ledger#2026Q4', text: '短视频事业部 Q4 已花 ¥16.00，季度预算 ¥12.00，超支 33%；图文事业部 Q4 已花 ¥3.00，预算 ¥8.00' },
    { kind: '产出', ref: 'drafts#2026Q4', text: '短视频事业部 Q4 产出 9 篇，采纳 5 篇；图文事业部 产出 6 篇，采纳 5 篇' },
    { kind: '退回', ref: 'rulings#2026Q4', text: '质量委员会退回 3 次，其中 2 次为“数据无出处”（引用《质量管理办法》第 2 条）' },
    { kind: '收入账', ref: 'revenue#2026-11', text: '图文事业部 B 站结算 ¥36.50（你录入）；短视频事业部 无收入数据' },
    { kind: '内审', ref: 'audit#2026-11', text: '内审〔2026〕001号：越权 1 项（短视频事业部自行追加 ¥5 视频生成，未走请示），整改中' },
  ];
  const mats = secretaryMaterials({ title: '2027Q1 短视频事业部追加预算 ¥6', conclusion: '建议追加 ¥6 用于视频生成，换取下季度 4 条主推视频', background: '短视频事业部 Q4 超支，CEO 认为追加能放大产出', data: [{ label: 'Q4 花费 ¥16.00 / 预算 ¥12.00', ref: 'ledger#2026Q4' }, { label: 'Q4 采纳 5 / 产出 9', ref: 'drafts#2026Q4' }], risks: ['超支继续扩大', '短视频事业部无收入数据，投入产出无法核实'], ask: '是否批准追加 ¥6' });
  let { motion } = newMotion([], { title: '2027Q1 短视频事业部追加预算 ¥6', matter: 'budget_adjust', materials: mats, evidence: [{ label: 'Q4 花费', ref: 'ledger#2026Q4' }, { label: 'Q4 产出与采纳', ref: 'drafts#2026Q4' }], at: AT });
  const t1 = Date.now();
  motion = await independentVotes(motion, board, raw, speaker('board'));
  const decided = chairmanDecide(motion, board, true, '董事长：先批 ¥3 试一个月（脚本模拟“你点批准”，不代表自动决策）', AT);
  const minutes = boardMinutes('董事会〔2026〕004号', [decided], board);
  report.board = {
    ms: Date.now() - t1, spent: stageCost('board'),
    directors: inds.map((d) => ({ id: d.id, name: d.name, model: d.model?.model, independence: independenceOf(d, CEO), label: INDEPENDENCE_TEXT[independenceOf(d, CEO)], weak: isWeak(independenceOf(d, CEO)), runs: d.runs ?? 1 })),
    warnings: validateBoard(board).warnings,
    votes: decided.votes.map((v) => ({ director: v.directorId, model: v.model, choice: v.choice, reason: redact(v.reason) })),
    decision: decided.decision, override: decided.override ? overrideNotice(decided, board) : null, minutes: redact(minutes),
  };

  // 2）内审抽查：种子数据里放一项越权、一处无出处数据；内审摘要用独立模型（flash），上限 ¥0.3
  const t2 = Date.now();
  const ainput = {
    spend: [{ ref: 'call-1', yuan: 0.12, at: AT }, { ref: 'call-2', yuan: 0.05, at: AT }],
    usage: [{ ref: 'call-1', yuan: 0.12, at: AT }, { ref: 'call-2', yuan: 0.05, at: AT }],
    actions: [...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, matter: 'routine', role: 'executor', actorId: 'bu-video-head', summary: `日常出稿 ${i}`, at: AT, deptId: 'bu-video' })),
      { id: 'big', matter: 'spend', role: 'dept_head', actorId: 'bu-video-head', amountYuan: 5, summary: '短视频事业部自行追加 ¥5 视频生成', at: AT, deptId: 'bu-video', approvedBy: null }],
    rulings: [{ id: 'v1', kind: 'veto', clause: 'quality#2', by: 'legal', at: AT }],
    outputs: [...Array.from({ length: 10 }, (_, i) => ({ id: `d${i}`, text: `第 ${i} 篇：选题思路与结构`, sources: [], at: AT, deptId: 'bu-video' })),
      { id: 'd99', text: '本周涨粉 35%，口播开头效果最好', sources: [], at: AT, deptId: 'bu-video' }],
    facts: [{ label: '本月粉丝增长', value: 320, ref: 'metrics#2026-12' }],
  };
  let audit = runAudit(ainput, { period: '2026-12', at: AT, seq: 2, sampleRate: 1 });
  audit = await auditSummary(audit, speaker('audit'), CHEAP);
  report.audit = { ms: Date.now() - t2, spent: stageCost('audit'), no: audit.no, findings: audit.findings.map((f) => ({ check: f.check, level: f.level, title: redact(f.title), evidence: f.evidence.map((e) => redact(e)), suggestion: redact(f.suggestion), dept: f.dept, due: f.due })), summary: redact(audit.summary), costYuan: audit.costYuan, cap: audit.capYuan, delivery: deliverAudit(audit) };

  // 3）季报：CEO 信用主模型、独立董事意见用 flash；数字由同一函数从记账重算；一致性检查
  const t3 = Date.now();
  const src = {
    period: '2026Q4', kind: 'quarter', groupName: '长鱼集团', at: AT, sim: true,
    spend: [{ ref: 'c1', yuan: 16, at: AT, deptId: 'bu-video', vendor: 'mimo', model: CHEAP }, { ref: 'c2', yuan: 3, at: AT, deptId: 'bu-article', vendor: 'mimo', model: CHEAP }, { ref: 'g1', yuan: 0.4, at: AT, deptId: 'board', vendor: 'mimo', gov: true }],
    usage: [{ ref: 'c1', yuan: 16, at: AT }, { ref: 'c2', yuan: 3, at: AT }, { ref: 'g1', yuan: 0.4, at: AT }],
    drafts: [...Array.from({ length: 9 }, (_, i) => ({ id: `v${i}`, deptId: 'bu-video', status: i < 2 ? 'published' : i < 5 ? 'approved' : i < 7 ? 'rejected' : 'pending', at: AT })), ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, deptId: 'bu-article', status: i < 3 ? 'published' : i < 5 ? 'approved' : 'pending', at: AT }))],
    metrics: [{ key: 'fans', label: '粉丝增长', value: 320, unit: '人', ref: 'metrics#2026-12' }, { key: 'views', label: '播放量', value: null, unit: '次', ref: null }],
    gaps: [], budgetTotal: 30, budgetAlerts: ['短视频事业部季度执行率 133%（偏差 +33%，超过 20% 预警线）'],
    cases: [{ title: '口播 3 秒钩子', kind: 'hit', lesson: '开头先给结论', ref: 'retro#3' }, { title: '无出处涨粉数字被退回', kind: 'failure', lesson: '数字必须写来源', ref: 'retro#4' }],
    audit: { no: audit.no, findings: audit.findings.map((f) => ({ title: f.title, level: f.level, status: 'open' })) }, controlsText: '内控自动测试 11/12 通过（花费审批控制点未通过）',
    risks: [{ title: '短视频事业部持续超支', level: 'high', response: '超支走请示，季度调整须董事会批准', owner: '财务部' }, { title: '平台规则变化', level: 'medium', response: '每周核对官方规则页', owner: '法务合规部' }],
    talent: [{ text: '直播策划组负责人入职培训 5 题答对 4 题，通过上岗', ref: 'training#1' }], outlook: ['把播放量数据接入（目前无数据）', '短视频事业部先补收入数据再谈追加'],
    deptNames: { 'bu-video': '短视频事业部', 'bu-article': '图文事业部', board: '董事会' },
    revenues: [{ id: 'rev-1', deptId: 'bu-article', platform: 'B站', amount: 36.5, period: '2026-11', currency: 'CNY', source: 'user_entry', ref: 'revenue#2026-11', at: AT }],
  };
  const draft0 = buildReport(src, { seq: 1 });
  const figs = draft0.figures.map((x) => `${x.label}=${x.value == null ? '无数据' : `${x.value}${x.unit}`}`).join('；');
  const say = speaker('report');
  const letter = await say({ who: 'ceo', role: 'ceo', tier: 'main', model: MAIN, maxTokens: 500, system: '你是 AI 虚拟集团的 CEO，写季报第一章“致董事长的信”。结论先行；只用给出的数字，“无数据”的项要直说；不夸大、不包装；不提自动发布或自动互动；≤300 字。', user: `${draft0.title}\n数字：${figs}\n预算预警：${src.budgetAlerts.join('；')}\n内审：${audit.summary}` });
  const opinion = await say({ who: inds[0].id, role: 'independent', tier: 'cheap', model: CHEAP, maxTokens: 360, system: '你是 AI 虚拟集团的独立董事，写季报第十一章“独立董事意见”。只看数字与原始记录，不看 CEO 的信；指出 2–3 个具体问题（引用数字名称和数值，或“无数据”项）；给出明确意见（无保留 / 保留 / 否定）；≤200 字。', user: `数字：${figs}\n原始记录：\n${raw.map((r, i) => `[R${i + 1}] ${r.kind}·${r.ref}：${r.text}`).join('\n')}` });
  const draft = buildReport(src, { seq: 1, ceoLetter: letter.text.trim(), directorOpinion: opinion.text.trim(), author: PEN_NAME });
  const final = finalizeReport(draft, src);
  const tampered = finalizeReport(editFigure(buildReport(src, { seq: 1 }), 'spend', 12.34), src);
  const fullText = final.chapters.map((c) => `${c.title}\n${c.paragraphs?.join('\n') ?? ''}`).join('\n');
  report.report = {
    ms: Date.now() - t3, spent: stageCost('report'), title: final.title, no: final.no, author: final.author, status: final.status, chapters: final.chapters.length,
    figures: final.figures.map((f) => ({ id: f.id, label: f.label, value: f.value, unit: f.unit, ref: f.ref })),
    consistency: checkConsistency(final, src), tamperedBlocked: tampered.status === 'blocked', tamperedDiffs: tampered.diffs,
    ceoLetter: redact(letter.text.trim()), directorOpinion: redact(opinion.text.trim()), privacyLeaks: privacyLeaks(JSON.stringify(final)).length, hardBoundary: checkGovResolution(fullText).ok,
  };

  // 4）业绩发布会：CEO（pro）讲解 + 分析师 ×2 与独立董事（flash）提问，上限 ¥0.5
  const t4 = Date.now();
  const call = await runEarningsCall(final, speaker('call'), { askers: [{ id: 'analyst-1', name: '分析师甲', role: 'analyst', model: CHEAP }, { id: 'analyst-2', name: '分析师乙', role: 'analyst', model: CHEAP }, { id: inds[0].id, name: inds[0].name, role: 'independent', model: CHEAP }], ceoModel: MAIN, at: AT });
  report.call = { ms: Date.now() - t4, spent: call.spent, budget: call.budget, stopped: call.stopped, speech: redact(call.speech), qa: call.qa.map((x) => ({ asker: x.asker, role: x.askerRole, question: redact(x.question), basis: x.basis, moderatorAdded: /主持人补充/.test(x.question), answer: redact(x.answer), todo: x.todo })), todos: call.todos, minutesHardBoundaryOk: !/硬边界表述/.test(call.minutes) };

  report.checks = {
    boardIndependentModelDiffers: report.board.directors.every((d) => d.model && d.model !== MAIN),
    boardWeakLabeled: report.board.directors.every((d) => d.weak && /独立性弱/.test(d.label)),
    boardVotesWithReasons: report.board.votes.length === inds.length && report.board.votes.every((v) => v.reason.length >= 8),
    auditFoundOverreachAndUnsourced: report.audit.findings.some((f) => f.check === 'doa_bypass') && report.audit.findings.some((f) => f.check === 'data_source'),
    auditDirectToChairmanCcCeo: report.audit.delivery.some((d) => d.to === 'chairman' && d.kind === 'to') && report.audit.delivery.some((d) => d.to === 'ceo' && d.kind === 'cc'),
    auditWithinCap: (audit.costYuan ?? 0) <= audit.capYuan,
    report11ChaptersFinal: report.report.chapters === 11 && report.report.status === 'final',
    reportConsistencyBlocksTamper: report.report.tamperedBlocked,
    reportNoPrivacy: report.report.privacyLeaks === 0,
    reportPenName: report.report.author === PEN_NAME,
    callHasQa: report.call.qa.length >= 3 && report.call.qa.every((x) => !!x.basis),
    callWithinCap: call.spent <= call.budget + 0.05,
    withinBudget: spent <= BUDGET,
  };
  report.status = Object.values(report.checks).every(Boolean) ? '通过' : '部分';
  return finish();
}
function finish() {
  report.finishedAt = new Date().toISOString();
  report.trace = trace;
  report.cost = { yuan: Number(spent.toFixed(6)), basis: '按 shared/models/pricing.ts 价目 × 实际 usage 计', calls: trace.length, byStage: Object.fromEntries(['board', 'audit', 'report', 'call'].map((s) => [s, +trace.filter((x) => x.stage === s).reduce((a, x) => a + (x.costYuan ?? 0), 0).toFixed(6)])) };
  const text = JSON.stringify(report, null, 2);
  if (!env.injected && env.key && text.includes(env.key)) throw new Error('报告里出现了 Key，未写盘');
  const leaks = findSecrets(text);
  if (leaks.length) throw new Error(`报告疑似含密钥（${leaks.length} 处），未写盘`);
  report.keyLeakScan = { findSecrets: 0, headersRecorded: false };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`写入 evals/real/mimo-v1.4.json：${report.status} · 花费 ¥${report.cost.yuan} · ${trace.length} 次调用 · ${JSON.stringify(report.checks ?? {})}\n`);
}
main().catch((e) => { report.status = '失败'; report.error = env.clean(e?.message ?? e); try { finish(); } catch { /* */ } process.stderr.write(`${env.clean(e?.stack ?? e)}\n`); process.exit(1); });
