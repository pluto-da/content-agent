#!/usr/bin/env node
/**
 * 0.11.0 真实联调（ROADMAP 0.11「MiMo 真实文本 / 推理 / TTS / ASR」，验收 C5 / C6）。会产生少量真实费用（约几分钱）。
 *
 * 走的是 App 里同一套 v9 统一能力层：shared 的 callRole（选目标 → 适配器 build → 传输 → parse → 分类 → 记账），
 * 适配器是 shared/src/models/adapters/mimo.ts；只有“流式首字”这一项直接用同一个适配器 build 出请求后自己读 SSE（为了量首字时间）。
 *
 * 用法（在 app/ 目录，先 npm run build -w shared）：
 *   MIMO_API_KEY=sk-xxx node scripts/real-v11.mjs
 *   MIMO_INJECTED=1 node scripts/real-v11.mjs          # 密钥由网络层按主机注入（沙盒 / CI 网关）：脚本不读、不传真实 Key
 * 可选：MIMO_BASE_URL、HTTPS_PROXY（经代理）、REAL_V11_OUT（默认 out/real-trace-0.11.json）、REAL_V11_BUDGET（元，默认 5）
 *
 * trace 只记请求的模型、参数摘要、耗时、用量、费用、返回摘要；**不记请求头、不记 Key**；写盘前再用 findSecrets 扫一遍。
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { callRole, emptyModelsV3, addModelEntry, bindRole, adapterOf, createStreamAccumulator, costOf, priceOf, findSecrets, redact } from '../shared/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outPath = process.env.REAL_V11_OUT ?? join(root, 'out', 'real-trace-0.11.json');
const mediaDir = join(root, 'out', 'real-v11');
mkdirSync(mediaDir, { recursive: true });
const injected = process.env.MIMO_INJECTED === '1';
const key = injected ? (process.env.MIMO_API_KEY || 'injected') : (process.env.MIMO_API_KEY ?? '').trim();
if (!key) { process.stderr.write('没有 MIMO_API_KEY，也没设 MIMO_INJECTED=1：未发出任何请求。\n'); process.exit(2); }
const baseURL = (process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1').replace(/\/+$/, '');
const budget = Number(process.env.REAL_V11_BUDGET ?? 5);
const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
const secrets = injected ? [] : [key];
const clean = (s) => redact(String(s), secrets);

/* ---------------- Node 传输（与 App 的 Transport 接口同形） ---------------- */
const transport = {
  async send(req, o) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), o.timeoutMs);
    try {
      const res = await undiciFetch(req.url, { method: req.method, headers: req.headers, body: req.body, dispatcher, signal: ctl.signal });
      const text = await res.text();
      return { status: res.status, text, headers: Object.fromEntries(res.headers.entries()) };
    } finally { clearTimeout(t); }
  },
};

/* ---------------- 模型配置：一个 MiMo 账号，四个角色 ---------------- */
let state = emptyModelsV3();
const acc = { id: 'mimo-real', vendor: 'mimo', label: '小米 MiMo', baseURL, region: 'cn', models: [], hasKey: true };
state.accounts.push(acc);
const MODELS = { chat: 'mimo-v2.6-flash', fast: 'mimo-v2.6-flash', reason: 'mimo-v2.6-flash', tts: 'mimo-v2.5-tts', asr: 'mimo-v2.5-asr' };
const bound = [];
for (const [role, model] of Object.entries(MODELS)) {
  const e = addModelEntry(acc, { model, roles: [role] });
  if (!e.ok) throw new Error(`addModelEntry ${role} ${model}: ${e.error}`);
  acc.models.push(e.entry);
  bound.push([role, e.entry]);
}
// 先把模型条目全部挂到账号上，再绑定角色（bindRole 会 structuredClone 状态）
for (const [role, entry] of bound) state = bindRole(state, role, 'primary', entry);
const usageLog = [];
const deps = { state, transport, getKey: async () => key, onUsage: (r) => { usageLog.push({ role: r.role, model: r.model, ok: r.ok, cost: r.cost, usage: r.usage, ms: r.ms, errorKind: r.errorKind }); } };

const steps = [];
let spent = 0;
const add = (s) => { steps.push(s); if (typeof s.costYuan === 'number') spent += s.costYuan; process.stdout.write(`${s.ok ? '✓' : '✗'} ${s.id} ${s.name}${s.ms != null ? ` ${s.ms}ms` : ''}${s.note ? ` · ${s.note}` : ''}\n`); };
const guard = () => { if (spent > budget) throw new Error(`已花 ¥${spent.toFixed(4)}，超过预算 ¥${budget}，停止`); };

/* ---------------- C5a：chat 流式首字（3 次） ---------------- */
async function streamOnce(i) {
  const adapter = adapterOf('mimo');
  const entry = acc.models.find((m) => m.model === MODELS.chat);
  const req = { role: 'chat', stream: true, maxTokens: 120, thinking: false, messages: [{ role: 'system', content: '你是内容运营助手，回答简洁。' }, { role: 'user', content: `第 ${i} 次：用一句话说说小红书笔记标题为什么建议 20 字以内。` }] };
  const http = adapter.build(req, { account: acc, target: { accountId: acc.id, modelEntryId: entry.id, model: MODELS.chat }, apiKey: key, baseURL });
  const t0 = performance.now();
  let first = null, chunks = 0;
  const accu = createStreamAccumulator('openai', (d) => { if (first == null && d.content) first = performance.now() - t0; });
  const res = await undiciFetch(http.url, { method: 'POST', headers: http.headers, body: http.body, dispatcher });
  const headersMs = performance.now() - t0;
  if (res.status >= 400) return { ok: false, status: res.status, error: clean((await res.text()).slice(0, 300)) };
  const dec = new TextDecoder();
  for await (const c of res.body) { chunks++; accu.feed(dec.decode(c, { stream: true })); }
  const st = accu.end();
  const total = performance.now() - t0;
  const usage = { input: st.usage?.input, output: st.usage?.output, cached: st.usage?.cached };
  return { ok: !!st.content, firstTokenMs: first == null ? null : Math.round(first), headersMs: Math.round(headersMs), totalMs: Math.round(total), chunks, finishReason: st.finishReason ?? null, content: st.content.slice(0, 120), usage, costYuan: costOf(priceOf('mimo', MODELS.chat), usage) ?? 0 };
}

async function main() {
  const startedAt = new Date().toISOString();
  // models 列表（确认可达；无费用）
  {
    const t0 = Date.now();
    const r = await transport.send({ method: 'GET', url: `${baseURL}/models`, headers: { authorization: `Bearer ${key}` } }, { timeoutMs: 20000 });
    let ids = [];
    try { ids = JSON.parse(r.text).data.map((m) => m.id); } catch { /* ignore */ }
    add({ id: 'M0', name: 'GET /models', ok: r.status === 200, ms: Date.now() - t0, status: r.status, models: ids, costYuan: 0 });
  }
  // C5a 流式首字
  const runs = [];
  for (let i = 1; i <= 3; i++) { const r = await streamOnce(i); runs.push(r); guard(); }
  const ft = runs.map((r) => r.firstTokenMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
  const median = ft.length ? ft[Math.floor(ft.length / 2)] : null;
  add({ id: 'C5-chat-stream', name: `chat 流式（${MODELS.chat}，3 次）`, ok: runs.every((r) => r.ok) && median != null && median < 3000, criterion: '流式首字 < 3 s（取 3 次中位数）', firstTokenMsMedian: median, runs, costYuan: runs.reduce((s, r) => s + (r.costYuan ?? 0), 0), note: `首字中位数 ${median} ms` });

  // C5b reason（经 callRole，thinking 开）
  {
    const r = await callRole('reason', { role: 'reason', maxTokens: 800, messages: [{ role: 'user', content: '一个账号 3 天发了 5 篇笔记，阅读分别是 120、90、3000、150、110。第 3 篇算不算“爆了”？用两句话回答并说明依据。' }] }, deps, { noFallback: true, retry: { max: 0, baseMs: 0 } });
    const v = r.ok ? r.value : null;
    add({ id: 'C5-reason', name: `reason 思考（${MODELS.reason}，thinking=enabled，经 v9 callRole）`, ok: !!(r.ok && v.type === 'text' && v.reasoning && v.reasoning.length > 0 && v.text), criterion: '返回思考内容（reasoning 非空）且正文非空', ms: r.ms, respondedModel: r.ok ? r.respondedModel : undefined, reasoningChars: v?.reasoning?.length ?? 0, reasoningHead: v?.reasoning?.slice(0, 80), content: v?.text?.slice(0, 160), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? 0) : 0, error: r.ok ? undefined : { kind: r.error.kind, reason: clean(r.error.reason) } });
    guard();
  }

  // C6a TTS（经 callRole）
  const ttsText = '你好，这是超级工作台的配音测试，本段语音由人工智能合成。';
  let wavB64 = null;
  {
    const r = await callRole('tts', { role: 'tts', text: ttsText, format: 'wav', voice: 'mimo_default' }, deps, { noFallback: true, retry: { max: 0, baseMs: 0 } });
    const item = r.ok && r.value.type === 'media' ? r.value.items[0] : null;
    let probe = null, file = null, header = null;
    if (item?.base64) {
      wavB64 = item.base64;
      const buf = Buffer.from(item.base64, 'base64');
      file = join(mediaDir, 'tts.wav');
      writeFileSync(file, buf);
      header = { riff: buf.subarray(0, 4).toString('latin1'), wave: buf.subarray(8, 12).toString('latin1'), bytes: buf.length };
      try { probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' })); } catch (e) { probe = { error: String(e.message).slice(0, 120) }; }
      try { execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' }); probe.decodeOk = true; } catch { if (probe) probe.decodeOk = false; }
    }
    const dur = Number(probe?.format?.duration ?? 0);
    add({ id: 'C6-tts', name: `TTS（${MODELS.tts}，wav，经 v9 callRole）`, ok: !!(item?.base64 && header?.riff === 'RIFF' && dur > 0.5 && probe?.decodeOk !== false), criterion: '返回音频可播（RIFF/WAVE 头正确、ffprobe 时长 > 0.5 s、ffmpeg 完整解码无错）', ms: r.ms, text: ttsText, mime: item?.mime, header, ffprobe: probe, file: file ? 'out/real-v11/tts.wav' : null, usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? null) : 0, priceKnown: !!priceOf('mimo', MODELS.tts), error: r.ok ? undefined : { kind: r.error.kind, reason: clean(r.error.reason) } });
    guard();
  }

  // C6b ASR（用上一步合成的音频转写，经 callRole）
  {
    if (!wavB64) add({ id: 'C6-asr', name: 'ASR', ok: false, note: 'TTS 没有产出音频，ASR 无输入，未调用', costYuan: 0 });
    else {
      const r = await callRole('asr', { role: 'asr', audio: { base64: wavB64, format: 'wav', mime: 'audio/wav' }, language: 'zh' }, deps, { noFallback: true, retry: { max: 0, baseMs: 0 } });
      const text = r.ok && r.value.type === 'transcript' ? r.value.text : '';
      const norm = (s) => s.replace(/[\s，。！？、,.!?]/g, '');
      const a = [...norm(ttsText)], b = new Set([...norm(text)]);
      const overlap = a.length ? a.filter((c) => b.has(c)).length / a.length : 0;
      add({ id: 'C6-asr', name: `ASR（${MODELS.asr}，转写上一步的 TTS 音频，经 v9 callRole）`, ok: !!text.trim(), criterion: 'ASR 文本非空（另记与原文的字符重合率，仅供参考）', ms: r.ms, transcript: text.slice(0, 200), charOverlapWithSource: Number(overlap.toFixed(3)), usage: r.ok ? r.usage : undefined, costYuan: r.ok ? (r.cost ?? null) : 0, priceKnown: !!priceOf('mimo', MODELS.asr), error: r.ok ? undefined : { kind: r.error.kind, reason: clean(r.error.reason) } });
    }
  }

  const known = steps.reduce((s, x) => s + (typeof x.costYuan === 'number' ? x.costYuan : 0), 0);
  const unknownPrice = steps.filter((x) => x.costYuan === null).map((x) => x.id);
  const report = {
    version: '0.11.0', startedAt, finishedAt: new Date().toISOString(), baseURL, keyMode: injected ? '网络层按主机注入（脚本未读取真实 Key）' : '环境变量（报告已打码）',
    models: MODELS, transport: proxy ? 'undici + HTTPS 代理' : 'undici 直连',
    steps,
    summary: { pass: steps.filter((s) => s.ok).length, fail: steps.filter((s) => !s.ok).length, costYuanKnown: Number(known.toFixed(6)), unknownPriceSteps: unknownPrice, budgetYuan: budget },
    notTested: [
      { vendor: '阿里云百炼 dashscope', roles: ['chat', 'image', 'tts', 'asr'], reason: '用户未提供 Key，未实测；能力声明保持 doc' },
      { vendor: '智谱 zhipu', roles: ['chat'], reason: '用户未提供 Key，未实测；能力声明保持 doc' },
      { vendor: '火山方舟 ark', roles: ['chat'], reason: '用户未提供 Key，未实测；能力声明保持 doc' },
      { vendor: 'MiniMax', roles: ['chat', 'tts'], reason: '用户未提供 Key，未实测；能力声明保持 doc' },
    ],
    usageLog,
  };
  const text = JSON.stringify(report, null, 2);
  const leaks = findSecrets(text).filter((h) => !/injected/.test(String(h.match ?? h)));
  if (!injected && text.includes(key)) throw new Error('报告里出现了 Key，未写盘');
  if (leaks.length) throw new Error(`报告疑似含密钥（${leaks.length} 处），未写盘`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
  // out/ 不进 Git：另存一份到 evals/real/（入库，accept-v11 与 CI 读这份；同样不含 Key）
  const tracked = join(root, 'evals', 'real', 'real-trace-0.11.json');
  mkdirSync(dirname(tracked), { recursive: true });
  writeFileSync(tracked, text);
  process.stdout.write(`\n写入 ${outPath}：通过 ${report.summary.pass} · 失败 ${report.summary.fail} · 已知费用 ¥${report.summary.costYuanKnown}${unknownPrice.length ? ` · 价目未收录：${unknownPrice.join('、')}` : ''}\n`);
}
main().catch((e) => { process.stderr.write(`${clean(e?.stack ?? e)}\n`); process.exit(1); });
void existsSync;
