/**
 * 0.8.0「超级工作台」单测：流式解析、JSON 指令、热点清洗、保活池（B4）、权限分级（B10）、Agent 循环（Mock 模型：B5 链路 / B8 降级）、
 * 卡片与质量门禁（B6）、发给 Agent（B9）、会话与记忆（B13）、数据源加密、备份 v2。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOpenAIChunk, bigramSimilarity, cleanAndGroup, createSSEParser, createStreamAccumulator, emptyStreamState, extractJsonToolCall, isJunkTitle, looksLikeToolsUnsupported, parseToolArguments, scoreOf, trendOf } from '@content-agent/shared';
import { BrowserPool, clampLimit } from './browser/pool';
import { resetLocalDb, db } from './local/db';
import { saveModels, EMPTY_MODELS, getModels, setPrefs } from './local/store';
import type { ProviderConfig } from './local/llm';
import { EXTERNAL_WRITE_TOOLS, TOOLS, TOOL_DEFS, toolByName, runChecks } from './agent/tools';
import { historyToMessages, type AgentEvent, type TraceStep } from './agent/events';
import { runTurnV9 as runTurn } from './v9/engine';
import { ToolsUnsupportedError, type AgentMsg, type AgentReply, buildRequest } from './agent/model';
import { buildAgentSystem, AGENT_CANNOT } from './agent/prompts';
import { addInbox, applyProfilePatch, createConversation, deleteConversation, EMPTY_PROFILE, getProfile, listConversations, listInbox, listMessages, updateConversation, lastUnfinishedTask } from './agent/store';
import { computeOverview } from './agent/overview';
import { listCreds, readCred, resetSecureKey, saveCred, isConnected } from './local/secure';
import { collectHot } from './hot/collect';
import { localApi } from './local/router';
import { App } from './App';
import { validCustomUrl, shellLayoutOf } from './shell/Workbench';

const mimo: ProviderConfig = { id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-test-9876', model: 'mimo-v2.6-flash', check: { ok: true, at: 'x' } };

beforeEach(() => {
  resetLocalDb(); resetSecureKey();
  localStorage.clear(); sessionStorage.clear();
  location.hash = '';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/* ---------------- 流式解析（B7 单测） ---------------- */
describe('B7 流式解析（shared/stream）', () => {
  it('SSE 任意切分 + [DONE]', () => {
    const ev: string[] = [];
    const p = createSSEParser((e) => ev.push(e.data));
    p.feed('data: {"a"'); p.feed(':1}\n\nda'); p.feed('ta: [DONE]\n\n'); p.end();
    expect(ev).toEqual(['{"a":1}', '[DONE]']);
  });
  it('tool_calls 按 index 合并 arguments 片段，content / reasoning 增量拼接', () => {
    const s = emptyStreamState();
    applyOpenAIChunk(s, { choices: [{ delta: { reasoning_content: '想' } }] });
    applyOpenAIChunk(s, { choices: [{ delta: { content: '你' } }] });
    applyOpenAIChunk(s, { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'hot_', arguments: '{"fo' } }] } }] });
    applyOpenAIChunk(s, { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'fetch', arguments: 'rce":true}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    expect(s.content).toBe('你'); expect(s.reasoning).toBe('想');
    expect(s.toolCalls).toEqual([{ id: 'c1', name: 'hot_fetch', arguments: '{"force":true}' }]);
    expect(s.finishReason).toBe('tool_calls'); expect(s.usage).toEqual({ input: 10, output: 3, cached: undefined });
  });
  it('Anthropic 事件：text_delta + tool_use input_json_delta', () => {
    const deltas: string[] = [];
    const acc = createStreamAccumulator('anthropic', (d) => deltas.push(d.content));
    const ev = (o: unknown) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
    acc.feed(ev({ type: 'message_start', message: { model: 'claude', usage: { input_tokens: 5, output_tokens: 0 } } }));
    acc.feed(ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '好' } }));
    acc.feed(ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'hot_fetch' } }));
    acc.feed(ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{}' } }));
    acc.feed(ev({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } }));
    const s = acc.end();
    expect(deltas).toEqual(['好']); expect(s.toolCalls[0]).toEqual({ id: 't1', name: 'hot_fetch', arguments: '{}' }); expect(s.finishReason).toBe('tool_calls');
  });
});

/* ---------------- JSON 指令（B8 单测） ---------------- */
describe('B8 JSON 指令解析', () => {
  it('代码块 / 裸对象 / 非指令', () => {
    expect(extractJsonToolCall('好的\n```json\n{"tool":"hot_fetch","args":{"force":true}}\n```')).toEqual({ tool: 'hot_fetch', args: { force: true } });
    expect(extractJsonToolCall('{"tool":"draft_write","args":{"topic":"a {b}","platform":"xiaohongshu"}} 多余')).toEqual({ tool: 'draft_write', args: { topic: 'a {b}', platform: 'xiaohongshu' } });
    expect(extractJsonToolCall('今天热点如下：{"x":1}')).toBeNull();
    expect(parseToolArguments('')).toEqual({}); expect(parseToolArguments('{bad')).toBeNull();
    expect(looksLikeToolsUnsupported(400, '{"error":"tools not supported by this model"}')).toBe(true);
    expect(looksLikeToolsUnsupported(401, 'invalid api key')).toBe(false);
  });
});

/* ---------------- 热点清洗与评分 ---------------- */
describe('热点清洗（shared/hotclean）', () => {
  it('去广告 / 纯数字 / 过短；同义标题粗合并；评分与趋势', () => {
    expect(isJunkTitle('【广告】买它')).toBe(true); expect(isJunkTitle('12345')).toBe(true); expect(isJunkTitle('好')).toBe(true);
    expect(bigramSimilarity('小米发布新款手机', '小米发布新款手机了')).toBeGreaterThan(0.6);
    const g = cleanAndGroup([
      { title: '小米发布新款手机', source: '百度热搜', rank: 3 }, { title: '小米发布新款手机了', source: '36氪', rank: 8 },
      { title: 'ＡＩ 编程工具大比拼', source: '少数派', rank: 1 }, { title: '置顶：活动', source: '百度热搜', rank: 1 },
    ]);
    expect(g.length).toBe(2); expect(g[0]!.sources).toEqual(['百度热搜', '36氪']); expect(g[0]!.bestRank).toBe(3); expect(g[1]!.title).toBe('AI 编程工具大比拼');
    expect(scoreOf({ sources: 2, totalSources: 4, bestRank: 1 })).toBeGreaterThan(scoreOf({ sources: 1, totalSources: 4, bestRank: 10 }));
    expect(trendOf('小米发布新款手机', 3, null)).toBe('new');
    expect(trendOf('小米发布新款手机', 3, { 小米发布新款手机: 12 })).toBe('up');
    expect(trendOf('小米发布新款手机', 3, { 小米发布新款手机: 4 })).toBe('flat');
  });
});

/* ---------------- 保活池（B4） ---------------- */
describe('B4 切换保持会话 + LRU 休眠', () => {
  it('A→B→A 不重新打开，A 的地址与前进后退状态保留；第 5 个平台休眠最久未用的，切回按原地址恢复', () => {
    const p = new BrowserPool(4);
    expect(p.activate('xiaohongshu', 'https://creator.xiaohongshu.com/')).toEqual([{ op: 'open', platform: 'xiaohongshu', url: 'https://creator.xiaohongshu.com/', restored: false }, { op: 'show', platform: 'xiaohongshu' }]);
    p.update('xiaohongshu', { url: 'https://creator.xiaohongshu.com/page/3', canGoBack: true });
    p.activate('douyin', 'https://creator.douyin.com/');
    expect(p.activate('xiaohongshu', 'https://creator.xiaohongshu.com/')).toEqual([{ op: 'show', platform: 'xiaohongshu' }]);
    expect(p.get('xiaohongshu')).toMatchObject({ url: 'https://creator.xiaohongshu.com/page/3', canGoBack: true, alive: true });
    p.activate('zhihu', 'https://www.zhihu.com/creator');
    p.activate('kuaishou', 'https://cp.kuaishou.com/');
    p.update('douyin', { url: 'https://creator.douyin.com/p/2' });
    const fifth = p.activate('bilibili', 'https://member.bilibili.com/platform/home');
    expect(fifth[0]).toEqual({ op: 'hibernate', platform: 'douyin', url: 'https://creator.douyin.com/p/2' });
    expect(p.aliveCount()).toBe(4);
    expect(p.activate('douyin', 'https://creator.douyin.com/')).toEqual([{ op: 'hibernate', platform: 'xiaohongshu', url: 'https://creator.xiaohongshu.com/page/3' }, { op: 'open', platform: 'douyin', url: 'https://creator.douyin.com/p/2', restored: true }, { op: 'show', platform: 'douyin' }]);
  });
  it('上限 2–6；内存紧张时休眠非当前；只接受 https 地址更新', () => {
    expect(clampLimit(1)).toBe(2); expect(clampLimit(9)).toBe(6); expect(clampLimit(Number.NaN)).toBe(4);
    const p = new BrowserPool(4);
    p.activate('a', 'https://a.com'); p.activate('b', 'https://b.com');
    p.update('b', { url: 'javascript:alert(1)' });
    expect(p.get('b')!.url).toBe('https://b.com');
    expect(p.trim()).toEqual([{ op: 'hibernate', platform: 'a', url: 'https://a.com' }]);
  });
});

/* ---------------- 权限分级（B10） ---------------- */
describe('B10 权限分级', () => {
  it('不存在任何 L3（对外写入）工具；publish_mark / metrics_import 只能由用户点击触发；工具定义只有一份', () => {
    expect(EXTERNAL_WRITE_TOOLS).toEqual([]);
    expect(TOOLS.every((t) => ['L0', 'L1', 'L2'].includes(t.level))).toBe(true);
    expect(toolByName('publish_mark')!.userOnly).toBe(true);
    expect(TOOL_DEFS.map((d) => d.function.name)).toEqual(TOOLS.map((t) => t.name));
    for (const n of ['hot_fetch', 'hot_analyze', 'draft_write', 'publish_check', 'publish_prepare', 'metrics_summary', 'profile_update', 'task_resume', 'skill_route', 'hot_patrol']) expect(toolByName(n)).toBeTruthy();
    expect(TOOLS.some((t) => /like|comment|follow|dm|message|auto_publish|click|fill/i.test(t.name))).toBe(false);
  });
  it('硬边界写进系统提示词：不能做的事 + 越界拒绝规则', () => {
    const s = buildAgentSystem({ profile: 'x', platforms: ['小红书'] });
    for (const c of AGENT_CANNOT) expect(s).toContain(c);
    expect(s).toContain('越界请求'); expect(s).toContain('在抖音创作者中心导出数据后，点＋导入，我来分析');
    expect(s.indexOf('硬边界')).toBeLessThan(s.indexOf('超级工作台'));
  });
});

/* ---------------- Mock 模型跑通 Agent 循环（B5 链路 / B8 降级 / B10 L2 确认） ---------------- */
function mockModel(script: ((msgs: AgentMsg[], o: { tools?: unknown }) => Partial<AgentReply> | Error)[]) {
  let i = 0;
  const calls: { msgs: AgentMsg[]; tools: boolean }[] = [];
  const fn = vi.fn(async (_cfg: ProviderConfig, msgs: AgentMsg[], o: { tools?: unknown; onDelta?: (d: { content: string; reasoning: string }) => void } = {}) => {
    calls.push({ msgs, tools: !!o.tools });
    const step = script[Math.min(i++, script.length - 1)]!(msgs, o);
    if (step instanceof Error) throw step;
    if (step.content) o.onDelta?.({ content: step.content, reasoning: '' });
    return { content: '', toolCalls: [], usage: { input: 100, output: 20 }, ms: 5, model: 'mock', streamed: true, chunks: 3, ...step } as AgentReply;
  });
  return { fn, calls };
}
const rss = (titles: string[]) => `<?xml version="1.0"?><rss><channel>${titles.map((t, i) => `<item><title>${t}</title><link>https://example.com/${i}</link></item>`).join('')}</channel></rss>`;
function stubSources() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (String(url).includes('top.baidu.com')) return new Response(JSON.stringify({ data: { cards: [{ content: [{ word: '小米发布新款手机', hotScore: '100' }, { word: '秋天第一杯奶茶', hotScore: '90' }] }] } }), { status: 200 });
    if (String(url).includes('sspai')) return new Response(rss(['AI 编程工具大比拼', '小米发布新款手机了']), { status: 200 });
    if (String(url).includes('36kr')) return new Response(rss(['新能源车降价潮']), { status: 200 });
    if (String(url).includes('solidot')) return new Response('', { status: 503 });
    throw new TypeError('blocked');
  }));
}
async function setup() {
  await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
  // 0.11.0：0.8 循环已删除，这些 0.8 回归用例改在 v9 运行时上跑；脚本按“每轮只决定下一步”编排，对应 v9 的逐步模式（agent.planner 关）
  await setPrefs({ platforms: ['xiaohongshu', 'douyin'], onboarded: true, flags: { 'agent.planner': false } } as never);
}
const draftJson = JSON.stringify({ title: '小米新机值不值得买', body: '先说结论：值得。\n'.repeat(10), tags: ['数码', '小米'], image_prompts: ['手机'] });

describe('B5（Mock）多步热点任务：hot_fetch → hot_analyze → draft_write', () => {
  it('原生 tools 模式三次工具调用、卡片、trace、草稿标题 ≤20 字', async () => {
    await setup(); stubSources();
    const m = mockModel([
      () => ({ content: '我先拉取你启用的热点来源。', toolCalls: [{ id: 'a', name: 'hot_fetch', arguments: '{}' }] }),
      () => ({ toolCalls: [{ id: 'b', name: 'hot_analyze', arguments: '{"platforms":["xiaohongshu","douyin_script"],"depth":"deep"}' }] }),
      () => ({ toolCalls: [{ id: 'c', name: 'draft_write', arguments: '{"topic":"小米新机值不值得买","platform":"xiaohongshu"}' }] }),
      // draft_write 内部的生成调用（generateDraft 经 local/llm chat → fetch）不走 mock，见下方 fetch 分支
      () => ({ content: '写好了：小红书 1 篇，抖音标题 3 个。' }),
    ]);
    const realFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    const clusterJson = JSON.stringify({ clusters: [{ title: '小米新机', members: [0], relevance: 0.8, why: '多源', angles: ['信息差'], perPlatform: { xiaohongshu: { titles: ['小米新机值不值得买', 'b', 'c'] }, douyin_script: { titles: ['x', 'y', 'z'] } } }] });
    // hot_analyze 与 draft_write 内部的模型调用走 fetch（一次性请求）
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => (String(u).includes('/chat/completions') ? new Response(JSON.stringify({ choices: [{ message: { content: String(init?.body).includes('话题簇') ? clusterJson : draftJson } }], usage: { prompt_tokens: 50, completion_tokens: 80 } }), { status: 200, headers: { 'content-type': 'application/json' } }) : realFetch(u, init))));
    const c = await createConversation();
    const events: AgentEvent[] = [];
    const trace: TraceStep[] = [];
    await runTurn({ conversationId: c.id, text: '看看今天各平台热点，给小红书和抖音各出 3 个选题，并把第一个写成小红书笔记', cfg: mimo, onEvent: (e) => events.push(e), call: m.fn as never, trace });
    const tools = trace.filter((t) => t.kind === 'tool');
    expect(tools.map((t) => t.name)).toEqual(['hot_fetch', 'hot_analyze', 'draft_write']);
    expect(tools.every((t) => !t.error)).toBe(true);
    const hot = tools[0]!.result as { sources: { id: string; ok: boolean; reason?: string }[] };
    expect(hot.sources.find((s) => s.id === 'solidot')).toMatchObject({ ok: false });
    expect(hot.sources.find((s) => s.id === 'tophub')).toMatchObject({ ok: false, reason: expect.stringContaining('未连接') });
    const draft = (await db.all('drafts'))[0]!;
    expect([...String(draft.title)].length).toBeLessThanOrEqual(20);
    expect([...String(draft.body)].length).toBeLessThanOrEqual(1000);
    const msgs = await listMessages(c.id);
    const cards = msgs.flatMap((x) => x.cards ?? []);
    expect(cards.map((x) => x.type)).toEqual(['hot', 'analysis', 'draft']);
    expect(cards[1]!.data.usedModel).toBe(true);
    expect(cards[1]!.data.clusters[0].perPlatform.xiaohongshu.titles).toHaveLength(3);
    // v9：工具结果存在运行记录（toolcalls 表），不再写 role=tool 的会话消息
    expect((await db.all('toolcalls')).filter((x) => x.status === 'ok').map((x) => x.tool)).toEqual(['hot_fetch', 'hot_analyze', 'draft_write']);
    expect(m.calls[0]!.tools).toBe(true);
    expect(JSON.stringify(trace)).not.toContain('sk-test-9876');
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect((await getModels()).providers[0]!.toolMode).toBe('native');
    expect((await db.all('tasks'))[0]).toMatchObject({ status: 'done' });
  }, 30000);

  it('B8：服务返回 400 “tools not supported” → 自动切 JSON 指令模式，完成同样三步', async () => {
    await setup(); stubSources();
    const realFetch = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => (String(u).includes('/chat/completions') ? new Response(JSON.stringify({ choices: [{ message: { content: draftJson } }] }), { status: 200 }) : realFetch(u, init))));
    const m = mockModel([
      (_m, o) => (o.tools ? new ToolsUnsupportedError() : { content: '```json\n{"tool":"hot_fetch","args":{}}\n```' }),
      (msgs) => ({ content: msgs.some((x) => x.content.includes('JSON 指令')) ? '```json\n{"tool":"hot_fetch","args":{}}\n```' : 'x' }),
      () => ({ content: '```json\n{"tool":"hot_analyze","args":{"platforms":["xiaohongshu"],"depth":"quick"}}\n```' }),
      () => ({ content: '```json\n{"tool":"draft_write","args":{"topic":"小米新机值不值得买","platform":"xiaohongshu"}}\n```' }),
      () => ({ content: '完成。' }),
    ]);
    const c = await createConversation();
    const trace: TraceStep[] = [];
    const events: AgentEvent[] = [];
    await runTurn({ conversationId: c.id, text: '看看今天热点并写一篇小红书', cfg: mimo, onEvent: (e) => events.push(e), call: m.fn as never, trace });
    expect(events.some((e) => e.type === 'mode' && e.toolMode === 'json')).toBe(true);
    expect(trace.filter((t) => t.kind === 'tool').map((t) => t.name)).toEqual(['hot_fetch', 'hot_analyze', 'draft_write']);
    expect((await getModels()).providers[0]!.toolMode).toBe('json');
    expect(m.calls.slice(1).every((x) => !x.tools)).toBe(true);
    expect(m.calls[1]!.msgs[0]!.content).toContain('{"tool":"名称","args":{…}}');
  }, 30000);

  it('参数不合格 → 带错误修复一次；同一工具同参数连续两次即停止；userOnly 工具被拒绝', async () => {
    await setup(); stubSources();
    const m = mockModel([
      () => ({ toolCalls: [{ id: 'a', name: 'draft_write', arguments: '{"topic":"x"}' }] }),
      () => ({ content: '```json\n{"tool":"draft_write","args":{"topic":"x"}}\n```' }), // 修复仍缺 platform
      () => ({ toolCalls: [{ id: 'b', name: 'publish_mark', arguments: '{"draftId":1}' }] }),
      () => ({ toolCalls: [{ id: 'c', name: 'inbox_list', arguments: '{}' }] }),
      () => ({ toolCalls: [{ id: 'd', name: 'inbox_list', arguments: '{}' }] }),
      () => ({ content: '好的' }),
    ]);
    const c = await createConversation();
    const trace: TraceStep[] = [];
    await runTurn({ conversationId: c.id, text: '试试', cfg: mimo, onEvent: () => {}, call: m.fn as never, trace });
    const t = trace.filter((x) => x.kind === 'tool');
    expect(t[0]!.error).toContain('参数有问题');
    expect(t[1]!.error).toContain('只能由你在卡片上点击触发');
    expect(t[2]!.error).toBeUndefined();
    // v9：重复调用在执行前就被拦下（不再执行第二次），运行以“连续调用两次，已停下”结束
    expect(t).toHaveLength(3);
    expect((await listMessages(c.id)).some((x) => x.content.includes('连续调用两次'))).toBe(true);
  }, 30000);

  it('B10：L2 出确认卡；拒绝 → 不写入；“记住此类”后不再询问', async () => {
    await setup();
    const d = await db.insert('drafts', { platform: 'xiaohongshu', title: 't', body: 'b', status: 'handed_off' });
    await db.insert('metrics', { draft_id: d.id, views: 1 });
    const confirms: string[] = [];
    const run = async (decision: 'allow' | 'deny' | 'remember', views: number) => {
      const m = mockModel([() => ({ toolCalls: [{ id: `m${views}`, name: 'metrics_record', arguments: JSON.stringify({ draftId: d.id, views }) }] }), () => ({ content: 'ok' })]);
      const c = await createConversation();
      await runTurn({ conversationId: c.id, text: `阅读 ${views}`, cfg: mimo, call: m.fn as never, onEvent: (e) => { if (e.type === 'confirm') { confirms.push(e.tool); e.resolve(decision); } } });
    };
    await run('deny', 50);
    expect((await db.all('metrics'))[0]!.views).toBe(1);
    await run('remember', 60);
    expect((await db.all('metrics'))[0]!.views).toBe(60);
    await run('allow', 70);
    expect(confirms).toEqual(['metrics_record', 'metrics_record']);
    expect((await db.all('metrics'))[0]!.views).toBe(70);
  }, 30000);

  it('停止：已收到的内容保留并标注“已停止”', async () => {
    await setup();
    const ctl = new AbortController();
    const fn = vi.fn(async (_c: ProviderConfig, _m: AgentMsg[], o: { onDelta?: (d: { content: string; reasoning: string }) => void }) => { o.onDelta?.({ content: '我先拉', reasoning: '' }); ctl.abort(); throw new DOMException('已停止', 'AbortError'); });
    const c = await createConversation();
    const ev: AgentEvent[] = [];
    await runTurn({ conversationId: c.id, text: '热点', cfg: mimo, signal: ctl.signal, call: fn as never, onEvent: (e) => ev.push(e) });
    // v9：已收到的部分保留在原消息并标“已停止”，运行时另起一条“已停止”说明
    const all = await listMessages(c.id);
    expect(all.find((x) => x.content === '我先拉')).toMatchObject({ content: '我先拉', stopped: true });
    expect(ev.at(-1)).toMatchObject({ type: 'done', stopped: true });
  });
});

/* ---------------- 质量门禁与发布（B6） ---------------- */
describe('B6 检查卡 / 发布卡', () => {
  it('超长 + 偏好红线 → 阻断；publish_prepare 未过检查返回 needs_check；通过后复制并打开发布页', async () => {
    await db.setKV('profile', { ...EMPTY_PROFILE, redlines: ['减肥药'] });
    const d = await db.insert('drafts', { platform: 'xiaohongshu', title: '这是一个非常非常非常非常非常长的小红书标题啊', body: '推荐减肥药', tags: [], status: 'approved' });
    const ctx = { conversationId: 1, cfg: null };
    const r1 = await toolByName('publish_prepare')!.run({ draftId: d.id }, ctx);
    expect(r1.result).toMatchObject({ needs_check: true });
    const chk = await toolByName('publish_check')!.run({ draftId: d.id }, ctx);
    expect(chk.card!.data.blocking).toBe(true);
    expect(chk.card!.data.checks.find((c: { id: string }) => c.id === 'redline').pass).toBe(false);
    expect((await toolByName('publish_prepare')!.run({ draftId: d.id }, ctx)).result).toMatchObject({ needs_check: true });
    await db.update('drafts', d.id, { title: '小米新机值不值得买', body: '先说结论。' });
    const ok = await runChecks((await db.get('drafts', d.id))!, 'xiaohongshu');
    expect(ok.blocking).toBe(false);
    await toolByName('publish_check')!.run({ draftId: d.id }, ctx);
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const pub = await toolByName('publish_prepare')!.run({ draftId: d.id }, ctx);
    expect(pub.result).toMatchObject({ copied: true, opened: true, steps: ['在发布框里长按粘贴', '检查文字、上传配图', '由你本人点击发布'] });
    expect(pub.card!.data.url).toBe('https://creator.xiaohongshu.com/publish/publish');
    expect((await db.get('drafts', d.id))!.status).toBe('approved'); // 只到“准备好”
  });
  it('browser_open 只允许该平台白名单内的 https 地址', async () => {
    const r = await toolByName('browser_open')!.run({ platform: 'xiaohongshu', page: 'url', url: 'https://evil.com/x' }, { conversationId: 1, cfg: null });
    expect(r.result).toMatchObject({ opened: false });
    const ok = await toolByName('browser_open')!.run({ platform: 'douyin', page: 'publish' }, { conversationId: 1, cfg: null });
    expect(ok.result).toMatchObject({ opened: true, url: 'https://creator.douyin.com/creator-micro/content/upload' });
  });
  it('热点全部失败 → 卡片失败态（原因 + 下一步）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await setPrefs({ hotSources: ['baidu'] });
    await expect(toolByName('hot_fetch')!.run({ force: true }, { conversationId: 1, cfg: null })).rejects.toMatchObject({ advice: expect.stringContaining('热点巡视') });
  });
});

/* ---------------- 发给 Agent（B9 网页层） ---------------- */
describe('B9 发给 Agent', () => {
  it('模拟系统分享事件 → 先出预览 → 确认后进入素材箱与会话', async () => {
    await setup();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('hero-title', {}, { timeout: 8000 });
    await act(async () => { window.dispatchEvent(new CustomEvent('ca:inbox-preview', { detail: { kind: 'share', channel: 'share', platform: 'xiaohongshu', text: '这家咖啡店真的绝 https://xhslink.com/abc', url: 'https://xhslink.com/abc' } })); });
    expect(await screen.findByTestId('send-preview')).toBeTruthy();
    expect(await listInbox()).toEqual([]);
    await act(async () => { fireEvent.click(screen.getByTestId('preview-save')); });
    await waitFor(async () => expect((await listInbox()).length).toBe(1));
    expect((await listInbox())[0]).toMatchObject({ channel: 'share', platform: 'xiaohongshu', url: 'https://xhslink.com/abc' });
  }, 20000);
  it('素材进入 c 路热点', async () => {
    await addInbox({ kind: 'text', text: '小红书上大家在聊秋天第一杯奶茶', channel: 'process_text', platform: 'xiaohongshu' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    const r = await collectHot({ force: true });
    expect(r.items.find((i) => i.route === 'c')).toMatchObject({ source: '素材箱·xiaohongshu' });
    expect(r.gaps.map((g) => g.platform)).toContain('kuaishou');
  });
});

/* ---------------- 会话与记忆（B13） ---------------- */
describe('B13 会话、画像、检查点、总览', () => {
  it('新建 / 重命名 / 置顶 / 删除', async () => {
    const a = await createConversation('A'); const b = await createConversation('B');
    await updateConversation(a.id, { pinned: true, title: 'A2' });
    expect((await listConversations()).map((c) => c.title)).toEqual(['A2', 'B']);
    await deleteConversation(b.id);
    expect((await listConversations()).map((c) => c.id)).toEqual([a.id]);
  });
  it('profile_update 只提议，采纳前不写入；只能改画像字段', async () => {
    const r = await toolByName('profile_update')!.run({ patch: { positioning: '数码博主', password: 'x' }, reason: '对话里说的' }, { conversationId: 1, cfg: null });
    expect(r.card!.type).toBe('profile');
    expect((await getProfile()).positioning).toBe('');
    expect(applyProfilePatch(EMPTY_PROFILE, { password: 'x' }).diff).toEqual([]);
  });
  it('中断后 task_resume 返回最后检查点与已完成步骤', async () => {
    await setup(); stubSources();
    const m = mockModel([() => ({ toolCalls: [{ id: 'a', name: 'hot_fetch', arguments: '{}' }] }), () => new Error('网络断了')]);
    const c = await createConversation();
    await runTurn({ conversationId: c.id, text: '热点并写稿', cfg: mimo, onEvent: () => {}, call: m.fn as never });
    const t = await lastUnfinishedTask();
    expect(t).toMatchObject({ status: 'failed', goal: '热点并写稿' });
    const r = await toolByName('task_resume')!.run({}, { conversationId: c.id, cfg: null });
    expect((r.result as { done: { tool: string }[] }).done.map((x) => x.tool)).toEqual(['hot_fetch']);
  }, 20000);
  it('总览卡只读本机，不发出任何网络 / 模型请求', async () => {
    await setPrefs({ platforms: ['xiaohongshu'] });
    await db.insert('drafts', { platform: 'xiaohongshu', title: 'a', body: 'b', status: 'approved' });
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const o = await computeOverview();
    expect(o.rows[0]).toMatchObject({ platform: 'xiaohongshu', pendingPublish: 1, stage: '发布' });
    expect(f).not.toHaveBeenCalled();
  });
  it('历史压缩：截断后不以孤立 tool 消息开头', () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({ id: i, conversationId: 1, role: (i % 3 === 0 ? 'tool' : i % 3 === 1 ? 'user' : 'assistant') as 'tool' | 'user' | 'assistant', content: `m${i}`, createdAt: '' }));
    const h = historyToMessages(msgs, 10);
    expect(h[0]!.content).toContain('较早的对话摘要');
    expect(h[2]!.role).not.toBe('tool');
  });
});

/* ---------------- 数据源加密（R1-a） ---------------- */
describe('R1-a 数据源凭证本机加密', () => {
  it('密钥加密保存（库里没有明文），只显示末四位；解密可用', async () => {
    await saveCred('tophub', { apiKey: 'TOPHUB-SECRET-KEY-1234' }, ['apiKey']);
    const raw = JSON.stringify(await listCreds());
    expect(raw).not.toContain('TOPHUB-SECRET-KEY');
    expect((await listCreds()).tophub!.fields.apiKey!.tail).toBe('1234');
    expect((await readCred('tophub'))!.apiKey).toBe('TOPHUB-SECRET-KEY-1234');
    expect(isConnected((await listCreds()).tophub, ['apiKey'])).toBe(true);
  });
  it('备份默认导出不含数据源密钥；version 2 可导入 version 1', async () => {
    await saveCred('tophub', { apiKey: 'TOPHUB-SECRET-KEY-1234' }, ['apiKey']);
    const out = await localApi('/api/backup/export', 'GET', undefined) as Record<string, unknown>;
    expect(out.version).toBe(2);
    expect(JSON.stringify(out)).not.toContain('TOPHUB');
    const r = await localApi('/api/backup/import', 'POST', { format: 'content-agent-local-backup', version: 1, drafts: [{ id: 1, platform: 'xiaohongshu', title: 't', body: 'b', status: 'pending' }] }) as { restored: number };
    expect(r.restored).toBe(1);
  });
});

/* ---------------- 布局与自定义网站 ---------------- */
describe('布局与自定义网站', () => {
  it('四种布局', () => {
    expect(shellLayoutOf(375, 812)).toBe('phone'); expect(shellLayoutOf(820, 1180)).toBe('tablet-portrait');
    expect(shellLayoutOf(1280, 800)).toBe('desktop'); expect(shellLayoutOf(1100, 800)).toBe('tablet-landscape'); expect(shellLayoutOf(1440, 900)).toBe('desktop');
  });
  it('自定义网站必须 https 且不是局域网 / 本机', () => {
    expect(validCustomUrl('https://www.example.com')).toBe('https://www.example.com/');
    for (const u of ['http://a.com', 'https://localhost', 'https://192.168.1.2', 'https://10.0.0.1', 'javascript:alert(1)', 'https://printer.local']) expect(validCustomUrl(u)).toBeNull();
  });
  it('MiMo 请求：tools + stream + reasoning_content 带回 + 不含 temperature 冲突', () => {
    const r = buildRequest(mimo, [{ role: 'system', content: 's' }, { role: 'assistant', content: 'a', reasoning_content: 'r' }, { role: 'user', content: 'u' }], { tools: TOOL_DEFS, thinking: true }, true);
    const b = JSON.parse(r.body);
    expect(b.stream).toBe(true); expect(b.tools.length).toBe(TOOLS.length); expect(b.max_completion_tokens).toBe(4096);
    expect(b.thinking).toEqual({ type: 'enabled' }); expect(b.messages[1].reasoning_content).toBe('r');
    expect(r.headers.authorization).toBe('Bearer sk-test-9876');
  });
});
