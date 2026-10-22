import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { openDb, setSetting } from '../src/db.js';
import { SecretVault, loadMasterKey } from '../src/crypto.js';
import { ModelHub, computeCost } from '../src/models/hub.js';
import { CAPABILITIES, NotConfiguredError, isCapability } from '../src/models/types.js';
import { BUILTIN_PROVIDERS } from '../src/models/providers.js';
import { mockAdapter } from '../src/models/mock.js';
import { createAdapter, openaiAdapter, anthropicAdapter, dashscopeAdapter, zhipuAdapter, minimaxAdapter, elevenlabsAdapter, comfyuiAdapter } from '../src/models/adapters.js';
import { extractJson, toSrt, estimateSegments, cosine } from '../src/models/util.js';
import { fakeHttp, tmp } from './helpers.js';

function setup(http = fakeHttp([])) {
  const db = openDb(':memory:');
  const d = tmp();
  const vault = new SecretVault(join(d, 's.json'), loadMasterKey(join(d, 'k'), 'p'));
  return { db, vault, hub: new ModelHub(db, vault, http, { pollMs: 0, pollMax: 3 }), http };
}
const def = (id: string) => BUILTIN_PROVIDERS.find((p) => p.id === id)!;

describe('工具函数', () => {
  it('extractJson 容错', () => {
    expect(extractJson<{ a: number }>('说明```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson<number[]>('x [1,2] y')).toEqual([1, 2]);
    expect(() => extractJson('none')).toThrow();
    expect(() => extractJson('{ broken')).toThrow();
  });
  it('SRT 与时间轴估算', () => {
    const segs = estimateSegments('第一句。第二句话更长一些！');
    expect(segs).toHaveLength(2);
    const srt = toSrt([{ start: 0, end: 1.5, text: '你好' }, { start: 3661.2, end: 3662, text: '再见' }]);
    expect(srt).toContain('00:00:00,000 --> 00:00:01,500');
    expect(srt).toContain('01:01:01,200');
    expect(cosine([1, 0], [1, 0])).toBe(1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
  it('能力枚举', () => {
    expect(CAPABILITIES).toHaveLength(8);
    expect(isCapability('tts')).toBe(true);
    expect(isCapability('click')).toBe(false);
  });
});

describe('成本计算', () => {
  it('按单位计费', () => {
    expect(computeCost({ unit: 'token', input: 1_000_000, output: 500_000 }, { input: 2, output: 8 })).toBe(6);
    expect(computeCost({ unit: 'image', input: 0, output: 3 }, { output: 0.2 })).toBeCloseTo(0.6);
    expect(computeCost({ unit: 'char', input: 20000, output: 0 }, { input: 1 })).toBe(2);
    expect(computeCost({ unit: 'second', input: 120, output: 0 }, { input: 0.5 })).toBe(1);
    expect(computeCost({ unit: 'call', input: 2, output: 0 }, { input: 1 })).toBe(2);
    expect(computeCost({ unit: 'call', input: 2, output: 0 }, undefined)).toBe(0);
  });
});

describe('ModelHub 路由', () => {
  it('未选择提供方或缺密钥 → 未配置', async () => {
    const { hub, db } = setup();
    expect(hub.status().every((s) => !s.configured)).toBe(true);
    await expect(hub.chat('t', [{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(NotConfiguredError);
    hub.setRoutes({ llm: { default: { provider: 'deepseek' } } });
    await expect(hub.chat('t', [])).rejects.toThrow('缺少密钥');
    hub.setRoutes({ llm: { default: { provider: 'elevenlabs' } } });
    await expect(hub.chat('t', [])).rejects.toThrow('不提供该能力');
    hub.setRoutes({ llm: { default: { provider: 'nope' } } });
    await expect(hub.chat('t', [])).rejects.toThrow('不存在');
    hub.setRoutes({ llm: { default: { provider: 'ark' } } });
    setSetting(db, 'x', 1);
  });
  it('mock 覆盖全部 8 个能力并记录用量', async () => {
    const { hub, db } = setup();
    hub.setRoutes(Object.fromEntries(CAPABILITIES.map((c) => [c, { default: { provider: 'mock' } }])));
    expect(hub.status().every((s) => s.configured)).toBe(true);
    expect((await hub.chat('t', [{ role: 'user', content: '[TASK:reply_draft]' }])).content).toContain('模拟');
    expect((await hub.vision('t', [{ url: 'https://a/b.png' }], '描述')).content).toContain('视觉');
    expect((await hub.ocr('t', [{ b64: 'x' }])).content).toContain('OCR');
    expect((await hub.image('t', 'cat', { n: 2 })).images).toHaveLength(2);
    const audio = await hub.tts('t', '你好世界');
    const tr = await hub.asr('t', { data: audio.audio });
    expect(tr.text).toBe('你好世界');
    expect((await hub.video('t', 'x')).status).toBe('pending');
    expect((await hub.videoStatus('t', 'mock-task-1')).status).toBe('succeeded');
    expect((await hub.embed('t', ['a', 'b'])).vectors).toHaveLength(2);
    expect((await hub.rerank('t', 'ab', ['xyz', 'ab'])).scores[0]!.index).toBe(1);
    const c = hub.costSummary();
    expect((c.byCapability as { capability: string }[]).map((x) => x.capability).sort()).toEqual(['asr', 'embedding', 'image', 'llm', 'ocr', 'tts', 'video', 'vision']);
    expect((db.prepare('SELECT COUNT(*) AS n FROM usage').get() as { n: number }).n).toBe(10);
  });
  it('主提供方失败才启用备用，并注明', async () => {
    const { hub, vault } = setup();
    vault.set('model.deepseek.key', 'k');
    hub.setAdapter('deepseek', { chat: async () => { throw new Error('网络错误'); } });
    hub.setRoutes({ llm: { default: { provider: 'deepseek' }, fallback: { provider: 'mock' } } });
    const r = await hub.chat('t', [{ role: 'user', content: 'x' }]);
    expect(r.provider).toBe('mock');
    expect((r as { fallbackUsed?: boolean }).fallbackUsed).toBe(true);
    hub.setRoutes({ llm: { default: { provider: 'deepseek' } } });
    await expect(hub.chat('t', [])).rejects.toThrow('网络错误');
    hub.setAdapter('deepseek', {});
    await expect(hub.chat('t', [])).rejects.toThrow('尚未实现');
  });
  it('任务级路由与价格、提供方覆盖', async () => {
    const { hub, db, vault } = setup();
    vault.set('model.kimi.key', 'k');
    hub.setAdapter('kimi', { chat: async (_m, model) => ({ provider: 'kimi', model, ms: 1, mock: false, content: 'ok', usage: { unit: 'token', input: 1_000_000, output: 0 } }) });
    hub.setRoutes({ llm: { default: { provider: 'mock' }, tasks: { review: { provider: 'kimi', model: 'k2' } } } });
    setSetting(db, 'models.prices', { 'kimi:k2': { input: 4 } });
    const r = await hub.chat('review', []);
    expect(r.model).toBe('k2');
    expect(hub.costSummary().total).toBe(4);
    setSetting(db, 'models.providers', { qwen: {}, dashscope: { baseURL: 'https://{WorkspaceId}.x/v1' } });
    vault.set('model.dashscope.key', 'k');
    expect(hub.providerReady(hub.providers().find((p) => p.id === 'dashscope')!).ok).toBe(false);
  });
});

describe('协议适配器（假 HTTP）', () => {
  const ctx = (id: string, http: ReturnType<typeof fakeHttp>, extra = {}) => ({ def: def(id), apiKey: 'K', http, pollMs: 0, pollMax: 3, ...extra });

  it('OpenAI 风格：对话、视觉、图像、TTS、ASR、向量、重排序', async () => {
    const http = fakeHttp([
      (u) => (u.endsWith('/chat/completions') ? { text: JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }) } : undefined),
      (u) => (u.endsWith('/images/generations') ? { text: JSON.stringify({ data: [{ url: 'https://img' }] }) } : undefined),
      (u) => (u.endsWith('/audio/speech') ? { body: Buffer.from('MP3') } : undefined),
      (u) => (u.endsWith('/audio/transcriptions') ? { text: JSON.stringify({ text: '你好', duration: 2, segments: [{ start: 0, end: 2, text: '你好' }] }) } : undefined),
      (u) => (u.endsWith('/embeddings') ? { text: JSON.stringify({ data: [{ index: 1, embedding: [2] }, { index: 0, embedding: [1] }], usage: { prompt_tokens: 4 } }) } : undefined),
      (u) => (u.endsWith('/rerank') ? { text: JSON.stringify({ results: [{ index: 1, relevance_score: 0.9 }] }) } : undefined),
    ]);
    const a = openaiAdapter(ctx('openai', http));
    expect((await a.chat!([{ role: 'user', content: 'x' }], 'm')).usage).toEqual({ unit: 'token', input: 3, output: 1 });
    await a.vision!([{ b64: 'AA', mime: 'image/jpeg' }], '看', 'm');
    expect(JSON.parse(String(http.calls[1]!.opts.body)).messages[0].content[1].image_url.url).toBe('data:image/jpeg;base64,AA');
    expect((await a.image!('p', 'm')).images[0]!.url).toBe('https://img');
    expect((await a.tts!('文本', 'm')).audio.toString()).toBe('MP3');
    expect((await a.asr!({ data: Buffer.from('x') }, 'm')).segments).toHaveLength(1);
    await expect(a.asr!({ url: 'https://a' }, 'm')).rejects.toThrow('上传');
    expect((await a.embed!(['a', 'b'], 'm')).vectors).toEqual([[1], [2]]);
    expect((await a.rerank!('q', ['a', 'b'], 'm')).scores[0]!.score).toBe(0.9);
    expect(http.calls[0]!.opts.proxy).toBeUndefined();
    const bad = openaiAdapter(ctx('deepseek', fakeHttp([() => ({ status: 401, text: 'unauthorized' })])));
    await expect(bad.chat!([], 'm')).rejects.toThrow('401');
    const weird = openaiAdapter(ctx('deepseek', fakeHttp([() => ({ text: '{}' })])));
    await expect(weird.chat!([], 'm')).rejects.toThrow('格式');
  });
  it('代理只用于标记为经代理的提供方', async () => {
    const http = fakeHttp([() => ({ text: JSON.stringify({ choices: [{ message: { content: 'x' } }] }) })]);
    await openaiAdapter({ ...ctx('openai', http), proxy: 'http://127.0.0.1:7890' }).chat!([], 'm');
    expect(http.calls[0]!.opts.proxy).toBe('http://127.0.0.1:7890');
  });
  it('Anthropic', async () => {
    const http = fakeHttp([(u, o) => (u.endsWith('/messages') && o.headers?.['x-api-key'] === 'K' ? { text: JSON.stringify({ content: [{ type: 'text', text: '好' }], usage: { input_tokens: 5, output_tokens: 1 } }) } : undefined)]);
    const a = anthropicAdapter(ctx('anthropic', http));
    const r = await a.chat!([{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }], 'claude');
    expect(r.content).toBe('好');
    expect(JSON.parse(String(http.calls[0]!.opts.body)).system[0].text).toBe('S');
    await a.vision!([{ url: 'https://i' }, { b64: 'B' }], 'p', 'claude');
  });
  it('百炼原生异步：万相图、视频、Paraformer', async () => {
    let polls = 0;
    const http = fakeHttp([
      (u, o) => (u.includes('/services/') && o.headers?.['X-DashScope-Async'] === 'enable' ? { text: JSON.stringify({ output: { task_id: 'T1' } }) } : undefined),
      (u) => {
        if (!u.includes('/tasks/T1')) return undefined;
        polls++;
        return { text: JSON.stringify({ output: polls < 2 ? { task_status: 'RUNNING' } : { task_status: 'SUCCEEDED', results: [{ url: 'https://w', transcription_url: 'https://tr' }], video_url: 'https://v' } }) };
      },
      (u) => (u === 'https://tr' ? { text: JSON.stringify({ transcripts: [{ text: '你好', sentences: [{ begin_time: 0, end_time: 1000, text: '你好' }] }], properties: { original_duration_in_milliseconds: 1000 } }) } : undefined),
    ]);
    const a = dashscopeAdapter(ctx('dashscope', http));
    expect((await a.image!('p', 'wan')).images[0]!.url).toBe('https://w');
    expect((await a.video!('p', 'wan')).taskId).toBe('T1');
    expect((await a.videoStatus!('T1', 'wan')).url).toBe('https://v');
    polls = 0;
    expect((await a.asr!({ url: 'https://a.mp3' }, 'paraformer-v2')).segments[0]).toEqual({ start: 0, end: 1, text: '你好' });
    await expect(a.asr!({ data: Buffer.from('') }, 'p')).rejects.toThrow('公网');
    const fail = dashscopeAdapter(ctx('dashscope', fakeHttp([(u) => (u.includes('/services/') ? { text: JSON.stringify({ output: { task_id: 'T2' } }) } : undefined), () => ({ text: JSON.stringify({ output: { task_status: 'FAILED', message: 'x' } }) })])));
    await expect(fail.image!('p', 'w')).rejects.toThrow('失败');
    const slow = dashscopeAdapter(ctx('dashscope', fakeHttp([(u) => (u.includes('/services/') ? { text: JSON.stringify({ output: { task_id: 'T3' } }) } : undefined), () => ({ text: JSON.stringify({ output: { task_status: 'RUNNING' } }) })])));
    await expect(slow.image!('p', 'w')).rejects.toThrow('超时');
  });
  it('智谱视频、MiniMax 语音与视频、ElevenLabs、ComfyUI', async () => {
    const zh = zhipuAdapter(ctx('zhipu', fakeHttp([
      (u) => (u.endsWith('/videos/generations') ? { text: JSON.stringify({ id: 'Z1' }) } : undefined),
      (u) => (u.includes('/async-result/Z1') ? { text: JSON.stringify({ task_status: 'SUCCESS', video_result: [{ url: 'https://zv' }] }) } : undefined),
    ])));
    expect((await zh.video!('p', 'cogvideox')).taskId).toBe('Z1');
    expect((await zh.videoStatus!('Z1', 'cogvideox')).url).toBe('https://zv');
    const mm = minimaxAdapter(ctx('minimax', fakeHttp([
      (u) => (u.endsWith('/v1/t2a_v2') ? { text: JSON.stringify({ data: { audio: Buffer.from('AUD').toString('hex') }, base_resp: { status_code: 0 } }) } : undefined),
      (u) => (u.endsWith('/v1/video_generation') ? { text: JSON.stringify({ task_id: 'M1' }) } : undefined),
      (u) => (u.includes('/v1/query/video_generation') ? { text: JSON.stringify({ status: 'Success', file_id: 'F' }) } : undefined),
    ])));
    expect((await mm.tts!('你好', 'speech')).audio.toString()).toBe('AUD');
    expect((await mm.video!('p', 'hailuo')).taskId).toBe('M1');
    expect((await mm.videoStatus!('M1', 'hailuo')).message).toContain('file_id=F');
    const mmErr = minimaxAdapter(ctx('minimax', fakeHttp([() => ({ text: JSON.stringify({ base_resp: { status_code: 1004, status_msg: 'auth' } }) })])));
    await expect(mmErr.tts!('x', 'm')).rejects.toThrow('1004');
    const el = elevenlabsAdapter(ctx('elevenlabs', fakeHttp([(u, o) => (u.includes('/text-to-speech/') && o.headers?.['xi-api-key'] === 'K' ? { body: Buffer.from('EL') } : undefined)])));
    expect((await el.tts!('hi', 'eleven')).audio.toString()).toBe('EL');
    await expect(comfyuiAdapter(ctx('comfyui', fakeHttp([]))).image!('p', 'w')).rejects.toThrow('工作流');
    const cf = comfyuiAdapter(ctx('comfyui', fakeHttp([
      (u) => (u.endsWith('/prompt') ? { text: JSON.stringify({ prompt_id: 'P' }) } : undefined),
      (u) => (u.endsWith('/history/P') ? { text: JSON.stringify({ P: { outputs: { '9': { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } } }) } : undefined),
    ]), { comfyWorkflow: '{"6":{"inputs":{"text":"{{prompt}}"}}}' }));
    expect((await cf.image!('猫 "引号"', 'workflow')).images[0]!.url).toContain('/view?filename=a.png');
  });
  it('createAdapter 分发', () => {
    for (const p of BUILTIN_PROVIDERS.filter((x) => x.protocol !== 'mock')) expect(createAdapter({ def: p, apiKey: '', http: fakeHttp([]) })).toBeTypeOf('object');
    expect(() => createAdapter({ def: def('mock'), apiKey: '', http: fakeHttp([]) })).toThrow();
    expect(mockAdapter().chat).toBeTypeOf('function');
  });
});
