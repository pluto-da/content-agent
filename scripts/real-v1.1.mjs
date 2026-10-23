#!/usr/bin/env node
/**
 * 1.1.0 真实 MiMo 实测（PROMPT-v1.1 第十部分第 3 步 / 验收 D15）：自由创作 + 思考开关（开 / 关各一次）+ 看图 + 配音。
 * 走 App 同一套 shared 能力层：callRole → resolveModel → mimo 适配器 → 传输 → parse → 记账。
 * 花费上限 ¥1（REAL_V11_BUDGET 可调低，不可调高于 1）；超过即停。
 * Key：MIMO_INJECTED=1 时由网络层按主机注入，脚本不读取真实 Key；trace 不记请求头，写盘前用 findSecrets 再扫一遍。
 * 用法（app/ 目录，先 npm run build -w shared）：MIMO_INJECTED=1 node scripts/real-v1.1.mjs
 * 输出：evals/real/mimo-v1.1.json（入库，accept-v1.1 的 D15 读这份）；服务不可用时照实记录并标“待 Key”。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callRole, findSecrets, resolveModel, priceOf } from '../shared/dist/index.js';
import { mimoEnv, nodeTransport, mimoState } from './real-common.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outPath = join(root, 'evals', 'real', 'mimo-v1.1.json');
const env = mimoEnv();
const budget = Math.min(1, Number(process.env.REAL_V11_BUDGET ?? 1));
const MODELS = { chat: 'mimo-v2.6-flash', vision: 'mimo-v2.6-flash', tts: 'mimo-v2.5-tts' };
const steps = [];
let spent = 0;
const add = (s) => { steps.push(s); spent += typeof s.costYuan === 'number' ? s.costYuan : 0; process.stdout.write(`${s.ok ? '✓' : '✗'} ${s.id} ${s.name}${s.ms != null ? ` ${s.ms}ms` : ''}${typeof s.costYuan === 'number' ? ` ¥${s.costYuan.toFixed(6)}` : ''}\n`); };
const over = () => spent > budget;
const err = (r) => (r.ok ? undefined : { kind: r.error.kind, reason: env.clean(r.error.reason) });

async function main() {
  const startedAt = new Date().toISOString();
  const report = { version: '1.1.0', startedAt, baseURL: env.baseURL, keyMode: env.injected ? '网络层按主机注入（脚本未读取真实 Key）' : '环境变量（报告已打码）', budgetYuan: budget, models: MODELS, steps };
  if (!env.key) { report.status = '待 Key'; report.note = '没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求'; return finish(report); }
  const transport = nodeTransport(env.proxy);
  const { state } = mimoState(MODELS, env.baseURL);
  const usageLog = [];
  const deps = { state, transport, getKey: async () => env.key, onUsage: (r) => usageLog.push({ role: r.role, model: r.model, ok: r.ok, cost: r.cost, usage: r.usage, ms: r.ms, errorKind: r.errorKind }) };
  const once = { noFallback: true, retry: { max: 0, baseMs: 0 } };

  // M0 可达性（免费）
  {
    const t0 = Date.now();
    let r; try { r = await transport.send({ method: 'GET', url: `${env.baseURL}/models`, headers: { authorization: `Bearer ${env.key}` } }, { timeoutMs: 20000 }); } catch (e) { r = { status: 0, text: String(e.message) }; }
    let ids = []; try { ids = JSON.parse(r.text).data.map((m) => m.id); } catch { /* */ }
    add({ id: 'M0', name: 'GET /models', ok: r.status === 200, ms: Date.now() - t0, status: r.status, models: ids, costYuan: 0 });
    if (r.status !== 200) { report.status = '待 Key'; report.note = `服务不可用（HTTP ${r.status}）：${env.clean(String(r.text).slice(0, 160))}`; return finish(report, usageLog); }
  }
  // 统一解析链：每一步都先用 resolveModel 取模型（与 App 相同）
  const via = (task, need) => { const x = resolveModel(state, task, need); return x ? { model: x.target.model, via: x.via } : null; };

  // F1 自由创作（free-writing 技能为 system，思考关）
  {
    const skill = readFileSync(join(root, 'agent', 'skills', 'free-writing.md'), 'utf8').replace(/^---[\s\S]*?---\n/, '');
    const r = await callRole('chat', { role: 'chat', thinking: false, json: true, maxTokens: 900, messages: [
      { role: 'system', content: `你是内容创作 Agent。按下面的技能写作，只输出符合 Schema 的 JSON。\n\n${skill}` },
      { role: 'user', content: '自由创作一篇 300 字左右的短文：一个上班族下班后用 20 分钟做一件让自己变好的小事。不指定平台。' },
    ] }, deps, { ...once, task: 'draft_write' });
    let parsed = null; if (r.ok) { try { parsed = JSON.parse(String(r.value.text).replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* */ } }
    add({ id: 'free-writing', name: `自由创作（${MODELS.chat}，free-writing 技能，思考关）`, ok: !!(parsed?.title && parsed?.body && parsed.body.length >= 100), criterion: '返回 JSON，含 title 与 ≥100 字正文，不带平台格式', resolved: via('draft_write', 'chat'), ms: r.ms, title: parsed?.title, bodyChars: parsed?.body?.length ?? 0, bodyHead: parsed?.body?.slice(0, 120), tags: parsed?.tags, reasoningChars: r.ok ? (r.value.reasoning?.length ?? 0) : 0, usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: err(r) });
  }
  if (over()) return stop(report, usageLog);

  // T1 / T0 思考开关：同一问题，开一次、关一次；对比 reasoning 与 usage / 费用
  const Q = [{ role: 'user', content: '3 天里 5 篇笔记阅读量 120、90、3000、150、110。第 3 篇算不算爆款？两句话回答。' }];
  const think = {};
  const runs = [];
  for (const on of [true, false]) {
    const r = await callRole('chat', { role: 'chat', thinking: on, maxTokens: 700, messages: Q }, deps, once);
    const v = r.ok ? r.value : null;
    const rc = v?.reasoning?.length ?? 0;
    think[on ? 'on' : 'off'] = { reasoningChars: rc, reasoningTokens: r.ok ? (r.usage?.reasoning ?? 0) : 0, output: r.ok ? r.usage?.output : undefined, cost: r.ok ? r.cost : undefined };
    runs.push({ id: on ? 'thinking-on' : 'thinking-off', name: `对话 思考${on ? '开' : '关'}（${MODELS.chat}，thinking=${on ? 'enabled' : 'disabled'}）`, ok: !!(v?.text && (on ? rc > 0 : rc === 0)), criterion: on ? '返回思考内容（reasoning 非空）且正文非空' : '不走思考（reasoning 为空）且正文非空', resolved: via(undefined, 'chat'), ms: r.ms, reasoningChars: rc, reasoningHead: v?.reasoning?.slice(0, 60), content: v?.text?.slice(0, 160), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: err(r) });
    runs[runs.length - 1].ok = !!(v?.text && (on ? rc > 0 : rc === 0));
  }
  add({ id: 'thinking', name: `思考开关（${MODELS.chat}，同一问题开 / 关各一次）`, ok: runs.every((x) => x.ok), criterion: '开：reasoning 非空且正文非空；关：reasoning 为空且正文非空；两次都按 usage 记账', runs, ms: runs.reduce((a, x) => a + (x.ms ?? 0), 0), costYuan: runs.reduce((a, x) => a + (x.costYuan ?? 0), 0) });
  if (over()) return stop(report, usageLog);
  report.thinkingCompare = { ...think, consistent: (think.on?.reasoningChars ?? 0) > 0 && (think.off?.reasoningChars ?? 1) === 0, note: '计费按 usage 记账：思考开时 reasoning 计入输出 token；关时无 reasoning。trace 与 usageLog 同源（onUsage）。' };

  // V1 看图
  {
    const png = readFileSync(join(root, 'evals', 'real', 'vision-sample.png')).toString('base64');
    const r = await callRole('vision', { role: 'vision', image: `data:image/png;base64,${png}`, question: '图里有哪些形状、各是什么颜色？底部写的文字是什么？一句话回答。', maxTokens: 300 }, deps, once);
    const text = r.ok ? String(r.value.text ?? '') : '';
    const hits = { red: /红/.test(text), blue: /蓝/.test(text), circle: /圆/.test(text), version: /1\.1\.0/.test(text) };
    add({ id: 'vision', name: `看图（${MODELS.vision}，本地 320×200 测试图：红圆、蓝方、文字 v1.1.0）`, ok: !!text && Object.values(hits).filter(Boolean).length >= 3, criterion: '回答至少命中 红 / 蓝 / 圆 / v1.1.0 中的 3 项', resolved: via(undefined, 'vision'), ms: r.ms, answer: text.slice(0, 200), hits, usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: err(r) });
  }
  if (over()) return stop(report, usageLog);

  // S1 配音
  {
    const text = '你好，这是超级工作台 1.1 的配音测试，本段语音由人工智能合成。';
    const r = await callRole('tts', { role: 'tts', text, format: 'wav', voice: 'mimo_default' }, deps, once);
    const item = r.ok && r.value.type === 'media' ? r.value.items[0] : null;
    const buf = item?.base64 ? Buffer.from(item.base64, 'base64') : null;
    const header = buf ? { riff: buf.subarray(0, 4).toString('latin1'), wave: buf.subarray(8, 12).toString('latin1'), bytes: buf.length } : null;
    const sr = buf ? buf.readUInt32LE(24) : 0, ch = buf ? buf.readUInt16LE(22) : 0, bits = buf ? buf.readUInt16LE(34) : 0;
    const seconds = buf && sr && ch && bits ? Number(((buf.length - 44) / (sr * ch * bits / 8)).toFixed(2)) : 0;
    if (buf) { mkdirSync(join(root, 'out', 'real-v1.1'), { recursive: true }); writeFileSync(join(root, 'out', 'real-v1.1', 'tts.wav'), buf); }
    add({ id: 'tts', name: `配音（${MODELS.tts}，wav）`, ok: !!(header?.riff === 'RIFF' && header?.wave === 'WAVE' && seconds > 0.5), criterion: '返回 RIFF/WAVE 音频且时长 > 0.5 s', resolved: via(undefined, 'tts'), ms: r.ms, text, header, sampleRate: sr, seconds, priceKnown: !!priceOf('mimo', MODELS.tts), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: err(r) });
  }
  return finish(report, usageLog);
}

function stop(report, usageLog) { report.stoppedForBudget = true; return finish(report, usageLog); }
function finish(report, usageLog = []) {
  report.finishedAt = new Date().toISOString();
  report.summary = { pass: report.steps.filter((s) => s.ok).length, fail: report.steps.filter((s) => !s.ok).length, costYuan: Number(report.steps.reduce((s, x) => s + (typeof x.costYuan === 'number' ? x.costYuan : 0), 0).toFixed(6)), budgetYuan: report.budgetYuan, withinBudget: true };
  report.summary.withinBudget = report.summary.costYuan <= report.budgetYuan;
  report.cost = { yuan: report.summary.costYuan, basis: '按 shared/models/pricing.ts 价目 × 实际 usage 计（TTS 限时免费记 ¥0）' };
  report.keyInTrace = !env.injected && !!env.key && JSON.stringify(report).includes(env.key);
  report.status ??= report.summary.fail === 0 && report.steps.length >= 5 ? '通过' : '未全部通过';
  report.usageLog = usageLog;
  const text = JSON.stringify(report, null, 2);
  const leaks = findSecrets(text);
  if (!env.injected && env.key && text.includes(env.key)) throw new Error('报告里出现了 Key，未写盘');
  if (leaks.length) throw new Error(`报告疑似含密钥（${leaks.length} 处），未写盘`);
  report.keyLeakScan = { findSecrets: 0, headersRecorded: false };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  process.stdout.write(`\n写入 evals/real/mimo-v1.1.json：${report.status} · 通过 ${report.summary.pass} · 失败 ${report.summary.fail} · 花费 ¥${report.summary.costYuan}\n`);
}
main().catch((e) => { process.stderr.write(`${env.clean(e?.stack ?? e)}\n`); process.exit(1); });
