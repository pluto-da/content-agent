/**
 * 小米 MiMo 真实联调冒烟脚本（会产生少量真实费用，约几分钱）。
 *
 * 用法（在 app/ 目录）：
 *   MIMO_API_KEY=sk-xxx npm run mimo:smoke
 *   MIMO_API_KEY=tp-xxx MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1 npm run mimo:smoke
 *   MIMO_INJECTED=1 npm run mimo:smoke        # 密钥由网络层按主机注入时：不加认证头
 * 控费：默认每项只调用一次（d 两次），不做 Schema 修复重试与截断重试；MIMO_SMOKE_REPAIR=1 打开。
 * 可选：MIMO_PROXY / HTTPS_PROXY（走代理，MIMO_PROXY=none 关闭）、MIMO_REPORT（报告路径，默认 out/mimo-smoke-report.json）、MIMO_SKIP=f,d（跳过步骤）
 *
 * 依次测：a) GET /models  b) flash 非思考短对话  c) flash 思考模式（reasoning 分离）
 *         d) 同一稳定前缀连续 2 次，看 cached_tokens  e) json_object + 本地 Schema 校验（小红书笔记）  f) pro 一次成稿对比
 * 走的是 App 里同一个适配器（models/adapters.ts 的 openaiAdapter + MiMo 方言），不是另写一套请求。
 * 报告不含密钥；错误信息里如出现密钥会被替换为 ***。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHttp, type HttpClient } from '../http.js';
import { openaiAdapter } from '../models/adapters.js';
import { BUILTIN_PROVIDERS } from '../models/providers.js';
import { computeCost } from '../models/hub.js';
import { validate, charLen, type SchemaError } from '../models/schema.js';
import { repairMessage } from '../models/structured.js';
import { extractJson } from '../models/util.js';
import { PLATFORM_SCHEMAS, describeLimits } from '../modules/schemas.js';
import { HARD_BOUNDARIES } from '../boundaries.js';
import type { ChatMessage, ChatOptions, ChatResult, ProviderDef } from '../models/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..', '..', '..');
const reportPath = process.env.MIMO_REPORT ?? join(appRoot, 'out', 'mimo-smoke-report.json');

const key = (process.env.MIMO_API_KEY ?? '').trim();
const injected = process.env.MIMO_INJECTED === '1';
const baseURL = (process.env.MIMO_BASE_URL ?? 'https://api.xiaomimimo.com/v1').trim().replace(/\/+$/, '');
// 代理：MIMO_PROXY 优先（填 none 关闭），否则沿用 HTTPS_PROXY（沙盒里网络层注入密钥通常经由它）；本机地址不走代理
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(baseURL);
const proxyEnv = process.env.MIMO_PROXY ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? '';
const proxy = !isLocal && proxyEnv && proxyEnv !== 'none' ? proxyEnv : undefined;
const skip = new Set((process.env.MIMO_SKIP ?? '').split(',').map((s) => s.trim()).filter(Boolean));

if (!key && !injected) {
  process.stderr.write([
    '未找到 MIMO_API_KEY，冒烟测试未运行（没有产生任何请求）。',
    '用法：MIMO_API_KEY=sk-xxx npm run mimo:smoke',
    '      Token Plan Key：再加 MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1',
    '      密钥由网络层注入时：MIMO_INJECTED=1 npm run mimo:smoke',
    '',
  ].join('\n'));
  process.exit(2);
}
if (key.startsWith('tp-') || key.startsWith('ttp-')) {
  if (!baseURL.includes('token-plan')) process.stderr.write('提示：tp-/ttp- 开头是 Token Plan Key，通常需要 MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1\n');
}

const redact = (s: string) => (key ? s.split(key).join('***') : s);
const mimoBase = BUILTIN_PROVIDERS.find((p) => p.id === 'mimo')!;
// 控费：冒烟里每项只调用一次（缓存项两次）——关闭适配器的 repetition_truncation 自动重试与 Schema 修复重试，
// 截断与校验失败如实写进报告。需要验证修复链路时设 MIMO_SMOKE_REPAIR=1。
const allowRepair = process.env.MIMO_SMOKE_REPAIR === '1';
const def: ProviderDef = { ...mimoBase, baseURL, useProxy: !!proxy, chatDialect: { ...mimoBase.chatDialect, retryFinishReasons: allowRepair ? mimoBase.chatDialect?.retryFinishReasons : [] } };
const http: HttpClient = defaultHttp;
const adapter = openaiAdapter({ def, apiKey: key, http, proxy });
const FLASH = 'mimo-v2.6-flash';
const PRO = 'mimo-v2.6-pro';

type Step = { id: string; name: string; ok: boolean; skipped?: boolean; ms?: number; error?: string; [k: string]: unknown };
const steps: Step[] = [];

const price = (model: string) => def.defaultPrices?.[model];
function summarize(r: ChatResult) {
  return {
    model: r.model, ms: r.ms, finishReason: r.finishReason ?? null, warnings: r.warnings ?? [],
    usage: { prompt_tokens: r.usage.input, completion_tokens: r.usage.output, cached_tokens: r.usage.cachedInput ?? null, reasoning_tokens: r.usage.reasoningOutput ?? null },
    costYuan: Number(computeCost(r.usage, price(r.model)).toFixed(6)),
  };
}

async function step(id: string, name: string, fn: () => Promise<Record<string, unknown>>): Promise<void> {
  if (skip.has(id)) { steps.push({ id, name, ok: true, skipped: true }); return; }
  const t = Date.now();
  try {
    const extra = await fn();
    steps.push({ id, name, ok: extra.ok !== false, ms: Date.now() - t, ...extra });
  } catch (e) {
    steps.push({ id, name, ok: false, ms: Date.now() - t, error: redact(e instanceof Error ? e.message : String(e)) });
  }
  const last = steps[steps.length - 1]!;
  process.stderr.write(`[${last.ok ? 'OK ' : 'ERR'}] ${id}) ${name}${last.error ? ` — ${last.error}` : ''}\n`);
}

const chat = (messages: ChatMessage[], model: string, opts: ChatOptions) => adapter.chat!(messages, model, opts);

/* ---------- 稳定前缀：硬边界 + 固定规则 + 平台规范（足够长以触发上下文缓存，通常需 ≥1024 token） ---------- */
const xhsSchema = PLATFORM_SCHEMAS.xiaohongshu!;
const stablePrefix = [
  '# 硬边界（不可更改）', ...HARD_BOUNDARIES.map((b) => `- ${b}`),
  '# 角色', '你是一名中文内容运营编辑，负责把素材改写成各平台的原创笔记。语气真诚具体，不夸大，不编造数据或来源；信息不足时写“待核实”。',
  '# 写作规则',
  ...Array.from({ length: 24 }, (_, i) => `- 规则 ${i + 1}：开头一句交代读者能得到什么；每段只讲一件事；用具体的数字、场景和动作代替形容词；避免“家人们”“绝绝子”等套话；结尾给一个可执行的小建议；不使用绝对化用语（最、第一、100%）；涉及健康、金融、法律时提示仅供参考。`),
  '# 平台规范：小红书', ...describeLimits(xhsSchema).map((l) => `- ${l}`),
  '# 输出', '只输出一个 JSON 对象，字段：title（标题）、body（正文）、tags（标签数组）、image_prompts（配图提示词数组，最多 3 个）。不要输出其它文字。',
].join('\n');

const material = '素材：一位上班族分享了“通勤 40 分钟怎么用”的经验——地铁上用耳机听播客学英语，记 3 个生词；下车前 5 分钟列当天 3 件最重要的事；回程不看工作消息，听音乐放松。坚持一个月后，早上不再慌乱，英语听力也有进步。';

async function xhsOnce(model: string) {
  const messages: ChatMessage[] = [{ role: 'system', content: stablePrefix }, { role: 'user', content: `[TASK:rewrite] 平台：小红书\n${material}` }];
  const opts: ChatOptions = { thinking: false, temperature: 0.7, maxTokens: 4096, responseFormat: { type: 'json_schema', name: 'xiaohongshu', schema: xhsSchema } };
  const r1 = await chat(messages, model, opts);
  const check = (content: string): { data?: { title?: string; body?: string; tags?: string[] }; errors: SchemaError[] } => {
    try {
      const data = extractJson<{ title?: string; body?: string; tags?: string[] }>(content);
      return { data, errors: validate(xhsSchema, data) };
    } catch (e) {
      return { errors: [{ path: '$', kind: 'type', message: `不是合法 JSON：${e instanceof Error ? e.message : String(e)}` }] };
    }
  };
  const c1 = check(r1.content);
  let final = c1, r2: ChatResult | undefined;
  if (c1.errors.length && allowRepair) {
    r2 = await chat([...messages, { role: 'assistant', content: r1.content }, { role: 'user', content: repairMessage(c1.errors) }], model, opts);
    final = check(r2.content);
  }
  return {
    ok: !!final.data && !final.errors.length,
    firstPass: !c1.errors.length, calls: r2 ? 2 : 1,
    firstErrors: c1.errors.map((e) => e.message), finalErrors: final.errors.map((e) => e.message),
    titleChars: final.data?.title ? charLen(final.data.title) : null, bodyChars: final.data?.body ? charLen(final.data.body) : null,
    title: final.data?.title ?? null, bodyPreview: final.data?.body ? `${final.data.body.slice(0, 80)}…` : null, tags: final.data?.tags ?? null,
    repairEnabled: allowRepair,
    requestSent: { response_format: 'json_object（json_schema 已降级，本地校验）', thinking: 'disabled', temperature: 0.7 },
    first: summarize(r1), ...(r2 ? { repair: summarize(r2) } : {}),
  };
}

/* ---------- a) 模型列表 ---------- */
await step('a', 'GET /models', async () => {
  const t = Date.now();
  const res = await http(`${baseURL}/models`, { proxy, timeoutMs: 30000, headers: key ? { authorization: `Bearer ${key}` } : {} });
  if (res.status >= 400) throw new Error(`HTTP ${res.status}: ${redact(res.text.slice(0, 200))}`);
  const ids = ((JSON.parse(res.text) as { data?: { id: string }[] }).data ?? []).map((m) => m.id);
  const expected = [FLASH, PRO, 'mimo-v2.6-pro-ultraspeed'];
  return { latencyMs: Date.now() - t, count: ids.length, models: ids, missing: expected.filter((m) => !ids.includes(m)), ok: ids.length > 0 };
});

/* ---------- b) flash 非思考短对话 ---------- */
await step('b', 'flash 非思考短对话', async () => {
  const r = await chat([{ role: 'user', content: '用一句话（不超过 30 字）说明小红书笔记标题该怎么写。' }], FLASH, { thinking: false, temperature: 0, maxTokens: 256 });
  return { reply: r.content.slice(0, 120), hasReasoning: !!r.reasoning, ...summarize(r), ok: !!r.content.trim() && !r.reasoning };
});

/* ---------- c) flash 思考模式 ---------- */
await step('c', 'flash 思考模式（reasoning 分离）', async () => {
  const r = await chat([{ role: 'user', content: '一个账号 3 天发了 5 篇笔记，平均每篇 120 赞；第 4 天发了 2 篇，共 180 赞。4 天的平均每篇点赞是多少？只给数字和一句理由。' }], FLASH, { thinking: true, temperature: 0, maxTokens: 8192 });
  return {
    reply: r.content.slice(0, 160), reasoningChars: r.reasoning?.length ?? 0, contentHasThinkTag: /<think>/.test(r.content),
    note: '思考模式下 temperature 不下发（服务商强制 1.0/0.95）', ...summarize(r),
    ok: !!r.content.trim() && !!r.reasoning && !/<think>/.test(r.content),
  };
});

/* ---------- d) 稳定前缀缓存 ---------- */
await step('d', '稳定前缀连续 2 次（cached_tokens）', async () => {
  const ask = (q: string) => chat([{ role: 'system', content: stablePrefix }, { role: 'user', content: q }], FLASH, { thinking: false, temperature: 0, maxTokens: 128 });
  const r1 = await ask('只回答“收到”。（第 1 次）');
  const r2 = await ask('只回答“收到”。（第 2 次）');
  const c2 = r2.usage.cachedInput;
  return {
    prefixChars: stablePrefix.length, first: summarize(r1), second: summarize(r2),
    cacheHit: typeof c2 === 'number' ? c2 > 0 : null,
    hitRatio: typeof c2 === 'number' && r2.usage.input ? Number((c2 / r2.usage.input).toFixed(3)) : null,
    note: typeof c2 === 'number' ? (c2 > 0 ? '第 2 次命中缓存' : '返回了 cached_tokens 但为 0：缓存可能需要更长前缀或几秒预热，可稍后重跑') : '未返回 cached_tokens 字段',
    ok: true,
  };
});

/* ---------- e) json_object + 本地 Schema（flash） ---------- */
let flashXhs: Record<string, unknown> | undefined;
await step('e', 'json_object + 本地 Schema：小红书笔记（flash）', async () => {
  flashXhs = await xhsOnce(FLASH);
  return flashXhs;
});

/* ---------- f) pro 一次成稿对比 ---------- */
await step('f', 'pro 一次成稿对比', async () => {
  const pro = await xhsOnce(PRO);
  const pick = (x: Record<string, unknown> | undefined) => x && {
    ok: x.ok, firstPass: x.firstPass, calls: x.calls, titleChars: x.titleChars, bodyChars: x.bodyChars,
    ms: (x.first as { ms: number }).ms, costYuan: (x.first as { costYuan: number }).costYuan + ((x.repair as { costYuan?: number } | undefined)?.costYuan ?? 0),
  };
  return { pro, compare: { flash: pick(flashXhs) ?? null, pro: pick(pro) }, ok: pro.ok };
});

const report = {
  tool: 'mimo-smoke', version: 1, at: new Date().toISOString(),
  baseURL, auth: key ? `api key（${key.slice(0, key.indexOf('-') + 1) || '?'}…，已隐藏）` : 'injected by network layer',
  ok: steps.every((s) => s.ok), passed: steps.filter((s) => s.ok && !s.skipped).length, failed: steps.filter((s) => !s.ok).length,
  totalCostYuan: Number(steps.reduce((sum, s) => {
    const add = (x: unknown) => (x && typeof x === 'object' && typeof (x as { costYuan?: unknown }).costYuan === 'number' ? (x as { costYuan: number }).costYuan : 0);
    return sum + add(s) + add(s.first) + add(s.second) + add(s.repair) + add((s.pro as Record<string, unknown> | undefined)?.first) + add((s.pro as Record<string, unknown> | undefined)?.repair);
  }, 0).toFixed(6)),
  steps,
};
const out = redact(JSON.stringify(report, null, 2));
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, out + '\n');
process.stdout.write(out + '\n');
process.stderr.write(`报告已写入 ${reportPath}\n`);
process.exit(report.ok ? 0 : 1);
