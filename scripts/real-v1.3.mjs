#!/usr/bin/env node
/**
 * 1.3.0 MiMo 实测（PROMPT-v1.3-conglomerate 第十六部分 / F21）：1 个临时会话、1 场三方三轮评审会、1 次两匹马的赛马，总花费 ≤ ¥3，trace 不含 Key。
 * 走 App 同一套 shared：openSession / postMessage / checkOff；runDiscussion（六步协议、防空转、表达规范打分）+ speakPrompt；newRace / runRace / scoreBlind / decideRace。
 * 讨论用省钱档 mimo-v2.6-flash（role chat），综合与决议用主模型 mimo-v2.6-pro（role reason）。
 * Key：MIMO_INJECTED=1 时由网络层按主机注入，脚本不读取真实 Key。输出 evals/real/mimo-v1.3.json（已打码）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRole, findSecrets, redact, defaultOrg, openSession, postMessage, checkOff, runDiscussion, speakPrompt, crossExamCoverage, newRace, runRace, scoreBlind, blindCards, decideRace, leaderboard } from '../shared/dist/index.js';
import { mimoEnv, nodeTransport, mimoState } from './real-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evals', 'real', 'mimo-v1.3.json');
const env = mimoEnv();
const CHEAP = process.env.MIMO_MODEL ?? 'mimo-v2.6-flash';
const MAIN = process.env.MIMO_MAIN_MODEL ?? 'mimo-v2.6-pro';
const BUDGET = 3;
const trace = []; let spent = 0;
const report = { version: '1.3.0', startedAt: new Date().toISOString(), baseURL: env.baseURL, models: { cheap: CHEAP, main: MAIN }, keyMode: env.injected ? '网络层按主机注入（脚本未读取真实 Key）' : '环境变量（报告已打码）', budgetYuan: BUDGET };

async function main() {
  if (!env.key) { report.status = '待 Key'; report.note = '没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求'; return finish(); }
  const transport = nodeTransport(env.proxy);
  const { state } = mimoState({ chat: CHEAP, reason: MAIN }, env.baseURL);
  const deps = { state, transport, getKey: async () => env.key, onUsage: (r) => { spent += r.cost ?? 0; } };
  const once = { noFallback: true, retry: { max: 1, baseMs: 800 } };
  const call = async (who, tier, system, user, maxTokens) => {
    if (spent > BUDGET) throw new Error('超出实测预算 ¥3，停止');
    const t0 = Date.now();
    const role = tier === 'main' ? 'reason' : 'chat';
    const before = spent;
    const r = await callRole(role, { role, thinking: false, maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, deps, once);
    const text = r.ok ? (r.value.text ?? '') : '';
    trace.push({ who, tier, model: tier === 'main' ? MAIN : CHEAP, ms: Date.now() - t0, ok: r.ok, request: { systemChars: system.length, userChars: user.length, head: redact(user.slice(0, 100)) }, response: redact(text.slice(0, 500)), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? +(spent - before).toFixed(6)) : 0, error: r.ok ? undefined : env.clean(r.error.reason) });
    if (!r.ok) throw new Error(env.clean(r.error.reason));
    return { text, cost: r.cost ?? 0 };
  };
  const speak = async (req) => { const p = speakPrompt(req); return call(`${req.party.id}·${req.phase}·r${req.round}`, req.tier, p.system, p.user, p.maxTokens); };
  const org = defaultOrg('实测集团');

  // 1）临时会话：数据中心发现档期冲突，拉两位事业部负责人，4 条消息后 √ 解散
  const t1 = Date.now();
  let { session } = openSession([], { topic: '短视频事业部与电商事业部都申请了抖音周三 20:00 黄金档', goal: '双方就档期达成一致', initiator: 'data-center-head', members: ['data-center-head', 'bu-video-head', 'bu-ecom-head'], trigger: 'okr_conflict', budget: 0.3 });
  const turns = [['data-center-head', '数据中心'], ['bu-video-head', '短视频事业部'], ['bu-ecom-head', '电商事业部'], ['data-center-head', '数据中心']];
  for (const [i, [id, name]] of turns.entries()) {
    const sys = `你是 AI 虚拟集团里的「${name}」，在临时会话里讨论。规则：结论先行、≤100 字；数据要写来源，没有就写“推测”；不建议自动发布或自动互动。${i === turns.length - 1 ? '这是最后一条：用“结论：…”给出双方一致的安排，并写一行“待办：<部门><事项>”。' : ''}`;
    const r = await call(`session·${id}`, 'cheap', sys, `议题：${session.topic}\n已有消息：\n${session.messages.filter((m) => m.kind === 'msg').map((m) => `${m.from}：${m.text}`).join('\n') || '（无）'}`, 220);
    const p = postMessage(session, { from: id, text: r.text, cost: r.cost });
    if (p.ok) session = p.session;
  }
  session = checkOff(session, 'data-center-head');
  report.session = { duplicatesBlocked: 4 - session.messages.filter((m) => m.kind === 'msg').length, ms: Date.now() - t1, messages: session.messages.filter((m) => m.kind === 'msg').length, status: session.status, spent: session.spent, conclusions: session.outcome.conclusions.map((x) => redact(x).slice(0, 160)), todos: session.outcome.todos.length, open: session.outcome.open.length };

  // 2）三方三轮评审会（六步协议）
  const t2 = Date.now();
  const parties = [{ id: 'bu-video-head', name: '短视频事业部' }, { id: 'bu-article-head', name: '图文事业部' }, { id: 'legal-head', name: '法务合规部', blue: true }];
  const rec = await runDiscussion({ topic: '下周主推选题：A“通勤 30 分钟的小习惯” vs B“周末一人食清单”', doc: '背景：账号定位通勤效率；问题：下周主推哪个选题；选项：A / B；数据：待录入（没有数据就写待录入）', parties, maxRounds: 3, budgetYuan: 1.2 }, speak);
  report.meeting = {
    ms: Date.now() - t2, rounds: rec.rounds, stopReason: rec.stopReason, speeches: rec.speeches.length, blocked: rec.blocked.length, coverage: crossExamCoverage(rec), spent: rec.spent,
    independentInvisible: rec.speeches.filter((s) => s.phase === 'independent').every((s) => s.visible.length === 0),
    maxChars: Math.max(...rec.speeches.filter((s) => s.phase !== 'synthesis').map((s) => [...s.text].length)),
    avgScore: +(rec.speeches.reduce((a, s) => a + s.score, 0) / rec.speeches.length).toFixed(1), rewritten: rec.speeches.filter((s) => s.flags.includes('rewritten')).length, speculative: rec.speeches.filter((s) => s.flags.includes('speculative')).length,
    synthesis: { consensus: rec.synthesis.consensus.map((x) => redact(x)), disagreements: rec.synthesis.disagreements.map((x) => redact(x)), toVerify: rec.synthesis.toVerify.map((x) => redact(x)) },
    resolution: redact(rec.resolution.text).slice(0, 300), rejected: rec.resolution.rejected ?? null, todos: rec.todos.length,
  };

  // 3）两匹马的赛马（盲评只看代号；董事长选定由脚本按盲评第一模拟“你点选定”，不代表自动决策）
  const t3 = Date.now();
  let race = newRace({ topic: '主推视频“通勤 30 分钟的小习惯”的开头切入角度', deptId: 'bu-video', budgetYuan: 0.4, horses: [{ id: 'h1', agentId: 'bu-video-head', skill: '悬念开场' }, { id: 'h2', agentId: 'bu-article-head', skill: '清单盘点' }] });
  race = await runRace(race, async (h, topic) => call(`race·${h.id}`, 'cheap', `你是「${h.agentId}」，用“${h.skill}”的角度给出一个可执行的开头方案：第一句台词、结构三步、一个风险。≤150 字，结论先行。`, topic, 260));
  for (const reviewer of ['staff-head', 'data-center-head']) {
    const cards = blindCards(race);
    const r = await call(`race-review·${reviewer}`, 'cheap', '你是赛马评审室的盲评人，只看代号与方案。按 1–10 分给每个方案打分，只输出 JSON，如 {"A":7,"B":8}。', cards.map((c) => `方案 ${c.alias}：${c.proposal}`).join('\n\n'), 80);
    let scores = {}; try { scores = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, '').match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { scores = {}; }
    race = scoreBlind(race, reviewer, scores);
  }
  const lb = leaderboard(race);
  race = decideRace(race, lb[0].alias, 'chairman');
  report.race = { ms: Date.now() - t3, horses: race.horses.length, entries: race.entries.map((e) => ({ alias: e.alias, status: e.status, cost: e.cost, head: redact(e.proposal).slice(0, 160) })), leaderboard: lb, winnerAlias: lb[0].alias, archived: race.archived.length, spent: race.spent, blindCardsHideAgent: !JSON.stringify(blindCards(race)).match(/bu-video-head|bu-article-head|mimo/) };

  report.checks = {
    sessionDissolvedWithSummary: report.session.status === 'dissolved' && report.session.messages >= 3 && report.session.conclusions.length > 0,
    meeting3Parties: parties.length === 3 && rec.rounds >= 1,
    meetingIndependentInvisible: report.meeting.independentInvisible,
    meetingCoverage100: report.meeting.coverage === 1,
    meetingHasResolution: !!rec.resolution.text && !rec.resolution.rejected,
    meetingSpeechLe300: report.meeting.maxChars <= 300 + 4,
    race2Horses: race.horses.length === 2 && report.race.entries.filter((e) => e.status === 'done').length === 2,
    raceBlind: report.race.blindCardsHideAgent,
    withinBudget: spent <= BUDGET,
  };
  report.status = Object.values(report.checks).every(Boolean) ? '通过' : '部分';
  return finish();
}
function finish() {
  report.finishedAt = new Date().toISOString();
  report.trace = trace;
  report.cost = { yuan: Number(spent.toFixed(6)), basis: '按 shared/models/pricing.ts 价目 × 实际 usage 计', calls: trace.length };
  const text = JSON.stringify(report, null, 2);
  if (!env.injected && env.key && text.includes(env.key)) throw new Error('报告里出现了 Key，未写盘');
  const leaks = findSecrets(text);
  if (leaks.length) throw new Error(`报告疑似含密钥（${leaks.length} 处），未写盘`);
  report.keyLeakScan = { findSecrets: 0, headersRecorded: false };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`写入 evals/real/mimo-v1.3.json：${report.status} · 花费 ¥${report.cost.yuan} · ${trace.length} 次调用 · ${JSON.stringify(report.checks ?? {})}\n`);
}
main().catch((e) => { report.status = '失败'; report.error = env.clean(e?.message ?? e); try { finish(); } catch { /* */ } process.stderr.write(`${env.clean(e?.stack ?? e)}\n`); process.exit(1); });
