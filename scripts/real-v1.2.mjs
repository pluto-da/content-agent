#!/usr/bin/env node
/**
 * 1.2.0 MiMo 实测（PROMPT-v1.2 第十三部分 4 / E21）：超级 Agent 派 2 个子 Agent（平台适配编辑、合规审核员）完成一次真实“一稿多发”，花费 ≤¥2，trace 不含 Key。
 * 走 App 同一套 shared：WORKFLOW_TEMPLATES[one-to-many] → runWorkflow → Orchestrator.delegate（交接契约 Schema 校验、退回一次、预算、任务板）→ callRole → mimo 适配器。
 * Key：MIMO_INJECTED=1 时由网络层按主机注入，脚本不读取真实 Key。输出 evals/real/mimo-v1.2.json（含逐步 trace，已打码）。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRole, findSecrets, Orchestrator, RunRegistry, fromTemplate, WORKFLOW_TEMPLATES, runWorkflow, redact } from '../shared/dist/index.js';
import { mimoEnv, nodeTransport, mimoState } from './real-common.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evals', 'real', 'mimo-v1.2.json');
const env = mimoEnv();
const MODEL = process.env.MIMO_MODEL ?? 'mimo-v2.6-flash';
const BUDGET = 2;
const trace = []; let spent = 0;
const report = { version: '1.2.0', startedAt: new Date().toISOString(), baseURL: env.baseURL, model: MODEL, keyMode: env.injected ? '网络层按主机注入（脚本未读取真实 Key）' : '环境变量（报告已打码）', budgetYuan: BUDGET };

function handoff(a, input, feedback) {
  return [
    { role: 'system', content: `你是子 Agent「${a.name}」（${a.id}），由超级 Agent 指挥，对超级 Agent 负责。\n${a.body}\n\n## 交接契约\n只输出一个 JSON 对象，不要其他文字：{"summary":"不超过 300 字","artifacts":["产出全文"],"cost":0,"evidence":["依据"],"open_questions":[],"failures":[]}\n## 硬边界\n不发布、不点赞、不评论、不私信、不关注；回复只生成草稿；不编造数据。` },
    { role: 'user', content: `${JSON.stringify({ goal: input.goal, constraints: input.constraints, budget: input.budget })}${feedback ? `\n\n上次被退回，修改意见：${feedback}` : ''}` },
  ];
}
async function main() {
  if (!env.key) { report.status = '待 Key'; report.note = '没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求'; return finish(); }
  const transport = nodeTransport(env.proxy);
  const { state } = mimoState({ chat: MODEL }, env.baseURL);
  const deps = { state, transport, getKey: async () => env.key, onUsage: (r) => { spent += r.cost ?? 0; } };
  const once = { noFallback: true, retry: { max: 1, baseMs: 800 } };
  const chat = async (who, messages, json) => {
    if (spent > BUDGET) throw new Error('超出实测预算 ¥2，停止');
    const t0 = Date.now();
    const r = await callRole('chat', { role: 'chat', thinking: false, json, maxTokens: 1200, messages }, deps, once);
    const text = r.ok ? (r.value.text ?? '') : '';
    trace.push({ who, ms: Date.now() - t0, ok: r.ok, request: messages.map((m) => ({ role: m.role, chars: [...m.content].length, head: redact(m.content.slice(0, 120)) })), response: redact(text.slice(0, 600)), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: r.ok ? undefined : env.clean(r.error.reason) });
    if (!r.ok) throw new Error(env.clean(r.error.reason));
    return { text, cost: r.cost ?? 0 };
  };
  const registry = new RunRegistry();
  const tasks = new Map(); const agentSpend = {};
  const orch = new Orchestrator({
    registry, concurrency: 3,
    execute: async (a, input, ctx) => { const r = await chat(a.id, handoff(a, input, ctx.feedback), true); try { const j = JSON.parse(r.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); j.cost = r.cost; return JSON.stringify(j); } catch { return r.text; } },
    spentMonth: (id) => agentSpend[id] ?? 0, estimate: () => 0.02, isPaused: () => false,
    onTask: (t) => tasks.set(t.id, t), onSpend: (id, y) => { agentSpend[id] = (agentSpend[id] ?? 0) + y; },
  });
  const agents = Object.fromEntries(['platform-adapter', 'compliance-reviewer'].map((id) => [id, fromTemplate(id)]));
  const wf = { ...WORKFLOW_TEMPLATES.find((w) => w.id === 'one-to-many'), enabled: true };
  wf.nodes = wf.nodes.map((n) => (n.id === 'mother' ? { ...n, goal: '写一篇母稿（自由创作，不带平台格式）：主题“下班后 30 分钟的小习惯，让第二天更轻松”，400–600 字' } : n.id === 'adapt' ? { ...n, goal: '把母稿适配成 小红书笔记（≤1000 字、带 3–5 个话题标签）和 B 站动态（≤500 字），母稿不改：' } : n));
  const t0 = Date.now();
  const st = await runWorkflow(wf, {
    runAgent: async (agentId, goal) => {
      if (agentId === 'super') { const r = await chat('super', [{ role: 'system', content: '你是超级 Agent，按要求直接给出正文，不要解释。' }, { role: 'user', content: goal }], false); return { ok: true, output: r.text, cost: r.cost }; }
      const r = await orch.delegate(agents[agentId], { goal, context_refs: [], constraints: ['发布与互动由用户本人完成', '只用录入或导入的数据'], budget: 1, deadline: null, output_schema: { type: 'object' } }, { agentId: 'super', depth: 1, title: goal.split('\n')[0].slice(0, 40) });
      return r.ok ? { ok: true, output: [r.output.summary, ...r.output.artifacts].join('\n'), cost: r.task.cost } : { ok: false, output: '', error: r.text, cost: r.task?.cost };
    },
    approval: () => 'approved',
    signal: new AbortController().signal,
  });
  const board = [...tasks.values()].map((t) => ({ agent: t.agentId, state: t.state, history: t.history.map((h) => h.state), returned: t.returned, cost: t.cost, summary: redact(t.summary ?? '').slice(0, 200) }));
  const adapted = st.outputs.adapt ?? ''; const review = st.outputs.review ?? '';
  report.workflow = { status: st.status, ms: Date.now() - t0, nodes: Object.fromEntries(Object.entries(st.nodes).map(([k, n]) => [k, n.status])), motherChars: [...(st.outputs.mother ?? '')].length, adaptedHead: redact(adapted.slice(0, 400)), reviewHead: redact(review.slice(0, 300)) };
  report.board = board;
  report.checks = {
    workflowDone: st.status === 'done',
    twoSubAgentsDone: ['platform-adapter', 'compliance-reviewer'].every((id) => board.some((b) => b.agent === id && b.state === 'done')),
    adaptedHasBoth: /小红书/.test(adapted) && /(B ?站|哔哩)/i.test(adapted),
    reviewOnlyNotes: review.length > 0,
    withinBudget: spent <= BUDGET,
  };
  report.status = Object.values(report.checks).every(Boolean) ? '通过' : '未全部通过';
  return finish();
}
function finish() {
  report.finishedAt = new Date().toISOString();
  report.trace = trace;
  report.cost = { yuan: Number(spent.toFixed(6)), basis: '按 shared/models/pricing.ts 价目 × 实际 usage 计' };
  const text = JSON.stringify(report, null, 2);
  if (!env.injected && env.key && text.includes(env.key)) throw new Error('报告里出现了 Key，未写盘');
  const leaks = findSecrets(text);
  if (leaks.length) throw new Error(`报告疑似含密钥（${leaks.length} 处），未写盘`);
  report.keyLeakScan = { findSecrets: 0, headersRecorded: false };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`写入 evals/real/mimo-v1.2.json：${report.status} · 花费 ¥${report.cost.yuan} · ${JSON.stringify(report.checks ?? {})}\n`);
}
main().catch((e) => { report.status = '失败'; report.error = env.clean(e?.message ?? e); try { finish(); } catch { /* */ } process.stderr.write(`${env.clean(e?.stack ?? e)}\n`); process.exit(1); });
