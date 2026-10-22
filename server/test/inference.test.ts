import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp, type AppContext } from '../src/app.js';
import { tmp, fakeHttp, AGENT_DEFAULTS } from './helpers.js';
import { validate, stripExtensions, weightedLen, stableStringify } from '../src/models/schema.js';
import { chatStructured } from '../src/models/structured.js';
import { mockAdapter } from '../src/models/mock.js';
import { computeCost } from '../src/models/hub.js';
import { planMaxTokens, splitReasoning, isThinkingModel } from '../src/models/util.js';
import { confidenceTier, signalsOf } from '../src/modules/confidence.js';
import { deterministicChat, EVAL_SEED } from '../src/modules/evals.js';
import { rewrite, resumeDraft, partialRewrite, draftSteps, systemPrompt } from '../src/modules/content.js';
import { schemaFor } from '../src/modules/prompt.js';
import { PLATFORM_SCHEMAS } from '../src/modules/schemas.js';
import { efficiencyMetrics } from '../src/modules/efficiency.js';
import { setSetting } from '../src/db.js';
import type { ChatOptions, ProviderAdapter } from '../src/models/types.js';
import type { FastifyInstance } from 'fastify';

let ctx: AppContext;
let app: FastifyInstance;
const http = fakeHttp([]);

function topic(title: string): number {
  return Number(ctx.db.prepare("INSERT INTO topics(title, angle) VALUES(?, '角度')").run(title).lastInsertRowid);
}

beforeAll(async () => {
  ({ app, ctx } = await buildApp({ dataDir: tmp('ca-inf-'), agentDefaultsDir: AGENT_DEFAULTS, http, rateLimitMs: 0 }));
  ctx.hub.setRoutes({ llm: { default: { provider: 'mock' } }, image: { default: { provider: 'mock' } }, tts: { default: { provider: 'mock' } }, asr: { default: { provider: 'mock' } } });
});

describe('Schema 校验与修复', () => {
  it('长度、加权长度、必填、条目数；扩展关键字剥离；稳定序列化', () => {
    const s = PLATFORM_SCHEMAS.xiaohongshu!;
    expect(validate(s, { title: '一'.repeat(21), body: '正文' }).map((e) => e.kind)).toEqual(['length']);
    expect(validate(s, { body: 'x' })[0]!.message).toContain('缺少必填字段 title');
    expect(validate(s, { title: 't', body: 'b', tags: Array(11).fill('a') })[0]!.kind).toBe('items');
    expect(weightedLen('中a')).toBe(3);
    const x = PLATFORM_SCHEMAS.x_post!;
    expect(validate(x, { body: '短\n---\n' + '长'.repeat(141) }).length).toBe(1);
    expect(validate(x, { body: '长'.repeat(140) }).length).toBe(0);
    expect(JSON.stringify(stripExtensions(x))).not.toContain('x-weightedMax');
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
  });

  it('不通过时带错误信息修复重试一次，并传 response_format', async () => {
    const seen: (ChatOptions | undefined)[] = [];
    const msgs: string[] = [];
    let n = 0;
    const adapter: ProviderAdapter = {
      async chat(messages, model, opts) {
        seen.push(opts);
        msgs.push(messages[messages.length - 1]!.content);
        n++;
        const content = n === 1 ? '```json\n{"title":"这是一个明显超过二十个字的小红书标题用来测试修复","body":"b"}\n```' : '{"title":"短标题","body":"b"}';
        return { provider: 'mock', model, ms: 0, mock: true, content, usage: { unit: 'token', input: 10, output: 5 } };
      },
    };
    ctx.hub.setAdapter('mock', adapter);
    try {
      const r = await chatStructured<{ title: string }>(ctx.hub, 't', [{ role: 'user', content: 'x' }], PLATFORM_SCHEMAS.xiaohongshu!, { name: 'rw' });
      expect(r.firstPass).toBe(false);
      expect(r.calls).toBe(2);
      expect(r.data.title).toBe('短标题');
      expect(r.firstErrors[0]!.kind).toBe('length');
      expect(msgs[1]).toContain('[TASK:repair]');
      expect(msgs[1]).toContain('超过上限 20');
      expect(seen[0]!.responseFormat?.type).toBe('json_schema');
      expect(seen[0]!.maxTokens).toBe(8192);
    } finally {
      ctx.hub.setAdapter('mock', mockAdapter());
    }
  });
});

describe('稳定前缀与编解码', () => {
  it('同一 skill 的系统提示词逐字节一致，变量不进前缀；顺序 soul → 规则 → skill → 平台规范', () => {
    const skill = ctx.deps.skills().find((s) => s.name === 'xiaohongshu-note')!;
    expect(skill.schema).toBeTruthy();
    expect(skill.body).not.toContain('json schema');
    const a = systemPrompt(ctx.agent, skill, schemaFor(skill, 'xiaohongshu'));
    const b = systemPrompt(ctx.agent, skill, schemaFor(skill, 'xiaohongshu'));
    expect(a).toBe(b);
    const idx = ['【soul.md】', '【规则·working-method.md】', '【skill：xiaohongshu-note】', '【平台规范】'].map((k) => a.indexOf(k));
    expect(idx.every((v, i) => v > 0 && (i === 0 || v > idx[i - 1]!))).toBe(true);
    expect(a).toContain('标题不超过 20 字');
    const other = systemPrompt(ctx.agent, ctx.deps.skills().find((s) => s.name === 'x-post')!, PLATFORM_SCHEMAS.x_post);
    const common = a.slice(0, a.indexOf('【skill：'));
    expect(other.startsWith(common)).toBe(true);
  });
  it('思考模式 max_tokens 默认值、上下文预检、reasoning 拆分、缓存价', () => {
    expect(planMaxTokens(1000, { thinking: false })).toBe(8192);
    expect(planMaxTokens(1000, { thinking: true })).toBe(65536);
    expect(planMaxTokens(1000, { thinking: true, maxOutput: 32768 })).toBe(32768);
    expect(planMaxTokens(120_000, { thinking: false })).toBe(8000);
    expect(() => planMaxTokens(127_500, { thinking: false })).toThrow(/上下文上限/);
    expect(isThinkingModel('deepseek-reasoner')).toBe(true);
    expect(isThinkingModel('qwen-plus')).toBe(false);
    expect(splitReasoning('<think>想</think>成稿')).toEqual({ content: '成稿', reasoning: '想' });
    expect(computeCost({ unit: 'token', input: 1_000_000, output: 0, cachedInput: 500_000 }, { input: 2, cachedInput: 0.5 })).toBeCloseTo(1.25);
  });
});

describe('置信度分档', () => {
  it('代理信号 → 高/中/低', () => {
    expect(confidenceTier({ complianceWarns: 0, schemaFirstPass: true, overLength: 0, schemaValid: true })).toBe('high');
    expect(confidenceTier({ complianceWarns: 0, schemaFirstPass: false, overLength: 1, schemaValid: true })).toBe('medium');
    expect(confidenceTier({ complianceWarns: 1, schemaFirstPass: true, overLength: 0, schemaValid: true })).toBe('medium');
    expect(confidenceTier({ complianceWarns: 3, schemaFirstPass: true, overLength: 0, schemaValid: true })).toBe('low');
    expect(confidenceTier({ complianceWarns: 0, schemaFirstPass: false, overLength: 1, schemaValid: false })).toBe('low');
    expect(signalsOf([{ level: 'warn', rule: 'r', match: 'm', advice: '' }, { level: 'info', rule: 'i', match: '', advice: '' }], { firstPass: true, firstErrors: [], errors: [] }).complianceWarns).toBe(1);
  });
  it('开启后 Mock 演示：短标题高置信、长标题中置信（只复核标题）、多处合规命中低置信（强模型重写）', async () => {
    setSetting(ctx.db, 'pipeline.draftVerify', { enabled: true });
    try {
      const hi = await rewrite(ctx.deps, topic('短选题'), 'x_post');
      expect(hi.confidence).toBe('high');
      const mid = await rewrite(ctx.deps, topic('一个相当长的选题标题用来触发小红书标题超限'), 'xiaohongshu');
      expect(mid.confidence).toBe('medium');
      expect(mid.steps.some((s) => s.step.startsWith('复核'))).toBe(true);
      const lo = await rewrite(ctx.deps, topic('最好的第一唯一稳赚项目'), 'x_post');
      expect(lo.confidence).toBe('low');
      expect(lo.steps.some((s) => s.step === '强模型重写')).toBe(true);
      const d = ctx.db.prepare('SELECT title, confidence, calls, min_calls FROM drafts WHERE id = ?').get(mid.draftId) as { title: string; confidence: string; calls: number; min_calls: number };
      expect([...d.title].length).toBeLessThanOrEqual(20);
      expect(d.calls).toBeGreaterThan(d.min_calls);
    } finally {
      setSetting(ctx.db, 'pipeline.draftVerify', { enabled: false });
    }
  });
});

describe('断点续跑与局部重写', () => {
  it('配图失败只重跑失败步，成功步骤不重复调用', async () => {
    let imageCalls = 0;
    let failFirst = 2;
    const base = mockAdapter();
    ctx.hub.setAdapter('mock', { ...base, async image(p, m, o) { imageCalls++; if (failFirst-- > 0) throw new Error('图像服务 503'); return base.image!(p, m, o); } });
    try {
      const r = await rewrite(ctx.deps, topic('续跑测试'), 'xiaohongshu');
      const failed = draftSteps(ctx.db, r.draftId).filter((s) => s.status === 'failed').map((s) => s.step);
      expect(failed).toEqual(['image-1', 'image-2']);
      expect(imageCalls).toBe(3);
      const res = await resumeDraft(ctx.deps, r.draftId);
      expect(res.rerun).toEqual(['image-1', 'image-2']);
      expect(imageCalls).toBe(5);
      expect(res.assets.filter((a) => a.type === 'image').length).toBe(3);
      const again = await resumeDraft(ctx.deps, r.draftId);
      expect(again.rerun).toEqual([]);
      expect(imageCalls).toBe(5);
    } finally {
      ctx.hub.setAdapter('mock', mockAdapter());
    }
  });
  it('局部重写只发送选中段 + 有界窗口', async () => {
    const r = await rewrite(ctx.deps, topic('局部重写'), 'wechat_article');
    const long = 'A'.repeat(1000) + '【选中段】' + 'B'.repeat(1000);
    ctx.db.prepare('UPDATE drafts SET body = ? WHERE id = ?').run(long, r.draftId);
    let sent = '';
    const base = mockAdapter();
    ctx.hub.setAdapter('mock', { ...base, async chat(m, model, o) { sent = m[m.length - 1]!.content; return base.chat!(m, model, o); } });
    try {
      const start = 1000, end = 1005;
      const out = await partialRewrite(ctx.deps, r.draftId, { start, end, window: 50 });
      expect(out.sentChars).toBe(105);
      expect(sent).toContain('A'.repeat(50) + '\n<<</前文>>>');
      expect(sent).not.toContain('A'.repeat(51));
      expect(out.body.startsWith('A'.repeat(1000) + '【模拟局部改写】【选中段】')).toBe(true);
      expect(out.body.endsWith('B'.repeat(1000))).toBe(true);
      await expect(partialRewrite(ctx.deps, r.draftId, { start: 5, end: 5 })).rejects.toThrow(/选中范围/);
    } finally {
      ctx.hub.setAdapter('mock', mockAdapter());
    }
    const res = await app.inject({ method: 'POST', url: `/api/drafts/${r.draftId}/partial-rewrite`, payload: { start: 0, end: 3, instruction: '更口语' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('确定性评测与健康路由', () => {
  it('temperature=0 + seed，同哈希命中结果缓存', async () => {
    const seen: (ChatOptions | undefined)[] = [];
    const base = mockAdapter();
    ctx.hub.setAdapter('mock', { ...base, async chat(m, model, o) { seen.push(o); return base.chat!(m, model, o); } });
    try {
      const a = await deterministicChat(ctx.hub, ctx.db, 'SYS', '[TASK:rewrite] [PLATFORM:x_post]\n选题标题：哈希');
      const b = await deterministicChat(ctx.hub, ctx.db, 'SYS', '[TASK:rewrite] [PLATFORM:x_post]\n选题标题：哈希');
      const c = await deterministicChat(ctx.hub, ctx.db, 'SYS2', '[TASK:rewrite] [PLATFORM:x_post]\n选题标题：哈希');
      expect([a.cached, b.cached, c.cached]).toEqual([false, true, false]);
      expect(b.content).toBe(a.content);
      expect(seen.length).toBe(2);
      expect(seen[0]).toMatchObject({ temperature: 0, seed: EVAL_SEED });
      expect(a.promptHash).toHaveLength(64);
    } finally {
      ctx.hub.setAdapter('mock', mockAdapter());
    }
  });
  it('主路近期失败率高时先走备用；记录成功率与 p95', async () => {
    const routes = ctx.hub.routes();
    ctx.hub.setRoutes({ ...routes, llm: { default: { provider: 'mock' }, fallback: { provider: 'ollama', model: 'm' } } });
    ctx.hub.setAdapter('ollama', mockAdapter());
    const ins = ctx.db.prepare("INSERT INTO usage(task, provider, model, ms, ok) VALUES('llm:x:token','mock','mock-llm',?,0)");
    for (let i = 0; i < 60; i++) ins.run(100 + i);
    try {
      expect(ctx.hub.isHealthy('mock')).toBe(false);
      const r = await ctx.hub.chat('t', [{ role: 'user', content: 'hi' }]) as { routedBy?: string; fallbackUsed?: boolean };
      expect(r.routedBy).toBe('health');
      expect(r.fallbackUsed).toBe(true);
      const h = ctx.hub.health(60).find((x) => x.provider === 'mock')!;
      expect(h.failRate).toBeGreaterThan(0.5);
      expect(h.p95).toBeGreaterThanOrEqual(h.p50);
    } finally {
      ctx.db.prepare("DELETE FROM usage WHERE provider = 'mock' AND ok = 0").run();
      ctx.hub.setRoutes(routes);
    }
  });
  it('效率度量：单篇成本、缓存命中率、一次通过率、返工放大系数', async () => {
    setSetting(ctx.db, 'models.prices', { mock: { input: 1, output: 2, cachedInput: 0.1 } });
    await rewrite(ctx.deps, topic('度量'), 'x_post');
    await rewrite(ctx.deps, topic('度量'), 'x_post');
    const m = efficiencyMetrics(ctx.db, ctx.hub, 1);
    expect(m.drafts).toBeGreaterThan(0);
    expect(m.cache.hitRate).toBeGreaterThan(0);
    expect(m.firstPass.rate).not.toBeNull();
    expect(m.amplification.factor).toBeGreaterThanOrEqual(1);
    expect(m.costPerDraft).toBeGreaterThan(0);
    const res = await app.inject({ method: 'GET', url: '/api/metrics/efficiency?days=7' });
    expect(res.json().latency.p95).toBeGreaterThanOrEqual(0);
    const ps = await app.inject({ method: 'PUT', url: '/api/pipeline/settings', payload: { draftVerify: { enabled: false }, health: { maxFailRate: 0.6 } } });
    expect(ps.json().health.maxFailRate).toBe(0.6);
    expect(ps.json().warning).toContain('草稿模型');
  });
});
