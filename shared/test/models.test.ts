import { describe, it, expect } from 'vitest';
import { ROLE_IDS, ROLE_GROUPS, checkModelName, normalizeModelName, addModelEntry, isDuplicateEntry, referencesOf, removeModelEntry, displayModel, configuredRoles, exportModels, importModels, upV2toV3, downV3toV2, ModelsMigrator, deprecationOf, markAgainstList, candidatesFor, emptyModelsV3, callRole, resolveTarget, listModels, probeEntry, statusFromProbes, PROBES, HealthTracker, mergeDecl, guardInput, narrowToolSchema, costOf, priceOf, estimateCost, cacheKey, ADAPTERS, adapterOf, classifyGeneric, findSecrets, DEFAULT_FILES, type RoleRequest, type AdapterCtx } from '../src/index.js';
import { acct, stateWith, fakeTransport, deps, ok } from './helpers.js';

describe('角色注册表', () => {
  it('11 个角色、5 组顺序', () => {
    expect(ROLE_IDS).toEqual(['chat', 'reason', 'fast', 'vision', 'image', 'imageEdit', 'tts', 'asr', 'video', 'embed', 'rerank']);
    expect(ROLE_GROUPS.map((g) => g.label)).toEqual(['文字', '看与画', '声音', '视频', '检索']);
    expect(ROLE_GROUPS.flatMap((g) => g.roles).sort()).toEqual([...ROLE_IDS].sort());
  });
});

describe('模型名输入规则（5.10.2 七条）', () => {
  it('1 任意字符串原样保留（大小写、/ : . _ -），只去首尾空白', () => {
    for (const n of ['kimi/kimi-k3', 'MiniMax/speech-2.8-hd', 'qwen3:8b', 'doubao-seedream-5-0-pro-260628', 'ep-20261022abcd', 'Qwen3.7-Plus']) { expect(checkModelName(` ${n} `)).toBeNull(); expect(normalizeModelName(` ${n}\t`)).toBe(n); }
  });
  it('1 长度 1–256，拒绝换行与控制字符', () => {
    expect(checkModelName('   ')).toBe('empty');
    expect(checkModelName('a'.repeat(257))).toBe('too_long');
    expect(checkModelName('a'.repeat(256))).toBeNull();
    expect(checkModelName('qwen\nplus')).toBe('newline');
    expect(checkModelName('qwen\u0007')).toBe('control');
  });
  it('2 不做白名单、不改写（不在示例表里的名字也能存）', () => {
    const a = acct('relay', 'openai-compatible');
    const r = addModelEntry(a, { model: '随用户填写的任意模型名', roles: ['chat'] });
    expect(r.ok && r.entry.model).toBe('随用户填写的任意模型名');
  });
  it('3 同账号“模型名 + 能力”重复被拒，能力不同允许', () => {
    const a = acct('ds', 'dashscope');
    expect(addModelEntry(a, { model: 'qwen3.7-plus', roles: ['chat', 'vision'] }).ok).toBe(true);
    expect(addModelEntry(a, { model: 'qwen3.7-plus', roles: ['vision', 'chat'] })).toEqual({ ok: false, error: 'duplicate' });
    expect(addModelEntry(a, { model: 'qwen3.7-plus', roles: ['reason'] }).ok).toBe(true);
    expect(isDuplicateEntry(a, ' qwen3.7-plus ', ['chat', 'vision'])).toBe(true);
  });
  it('4 占位来自示例数据文件，不是默认值（示例表只有数据、不参与逻辑）', () => {
    const ex = JSON.parse(DEFAULT_FILES['config/model-examples.json']!);
    expect(ex.examples.image[0].model).toBe('qwen-image-3.0-pro');
    const a = acct('x', 'dashscope');
    expect(addModelEntry(a, { model: '', roles: ['image'] })).toEqual({ ok: false, error: 'empty' });
  });
  it('5 列表外的名字能存、能调用（mock 断言请求体 model 逐字相同）', async () => {
    const s = stateWith([{ acc: acct('relay', 'openai-compatible', { baseURL: 'https://relay.example/v1' }), model: 'My-Org/Weird.Model:v2_x', roles: ['chat'], bind: ['primary'] }]);
    const tr = fakeTransport(() => ok({ model: 'My-Org/Weird.Model:v2_x', choices: [{ message: { content: '你好' } }], usage: { prompt_tokens: 5, completion_tokens: 2 } }));
    const r = await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: '只回复两个字：你好' }] }, deps(s, tr));
    expect(r.ok).toBe(true);
    expect(JSON.parse(tr.calls[0]!.body!).model).toBe('My-Org/Weird.Model:v2_x');
    expect(tr.calls[0]!.url).toBe('https://relay.example/v1/chat/completions');
  });
  it('6 能力声明留空 → 大小守卫用保守值并提示', () => {
    const d = mergeDecl('asr', 'openai-compatible', 'x');
    const g = guardInput(d, { audioSeconds: 30 });
    expect(g).toEqual({ ok: true, conservative: true });
    expect(guardInput(d, { audioSeconds: 999 }).ok).toBe(false);
  });
  it('7 未测试的模型名可以保存（状态 untested）', () => { const a = acct('a', 'mimo'); const r = addModelEntry(a, { model: 'mimo-v2.6-flash', roles: ['chat'] }); expect(r.ok && r.entry.status).toBe('untested'); });
});

describe('同一服务商 ≥3 个模型名 + 引用删除确认 + 显示', () => {
  const s0 = stateWith([
    { acc: acct('ds', 'dashscope'), model: 'qwen3.7-plus', roles: ['chat', 'vision'], bind: ['primary'] },
    { acc: acct('ds', 'dashscope'), model: 'qwen-image-3.0-pro', roles: ['image', 'imageEdit'], bind: ['primary'] },
    { acc: acct('ds', 'dashscope'), model: 'qwen3-asr-flash', roles: ['asr'], bind: ['primary'] },
  ]);
  it('3 个模型名各自勾不同能力，均已绑定', () => {
    expect(s0.accounts[0]!.models).toHaveLength(3);
    expect(configuredRoles(s0).sort()).toEqual(['asr', 'chat', 'image', 'imageEdit', 'vision'].sort());
    expect(candidatesFor(s0, 'image')[0]!.text).toBe('qwen-image-3.0-pro · ds');
  });
  it('删除前列出引用；确认后位置变“未配置”，不静默换别的', () => {
    const id = s0.accounts[0]!.models[1]!.id;
    expect(referencesOf(s0, id)).toEqual([{ role: 'image', slot: '默认' }, { role: 'imageEdit', slot: '默认' }]);
    const s1 = removeModelEntry(s0, id);
    expect(s1.roles.image.primary).toBeUndefined();
    expect(configuredRoles(s1)).not.toContain('image');
  });
  it('显示名（模型名）', () => { expect(displayModel({ label: '千问生图', model: 'qwen-image-3.0-pro' })).toBe('千问生图（qwen-image-3.0-pro）'); expect(displayModel({ model: 'x' })).toBe('x'); });
  it('账号共用 Key 与按角色单独填写：overrideBaseURL / overrideSecretRef', async () => {
    const s = structuredClone(s0);
    s.roles.chat.primary = { ...s.roles.chat.primary!, overrideBaseURL: 'https://other.example/v1', overrideSecretRef: 'secret:chat-only' };
    const seen: string[] = [];
    const tr = fakeTransport((req) => { seen.push(req.url); return ok({ choices: [{ message: { content: 'hi' } }] }); });
    await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: 'x' }] }, deps(s, tr, { getKey: async (_a, t) => (t.overrideSecretRef ? 'sk-override-000000000000' : 'sk-account-0000000000') }));
    expect(seen[0]).toBe('https://other.example/v1/chat/completions');
    expect(tr.calls[0]!.headers.authorization).toBe('Bearer sk-override-000000000000');
  });
});

describe('导出 / 导入 / 迁移', () => {
  it('导出不含 Key 且每条绑定都有 model 字段', () => {
    const s = stateWith([{ acc: acct('mimo', 'mimo', { headers: { 'x-extra': 'sk-' + 'Q'.repeat(30) } }), model: 'mimo-v2.6-flash', roles: ['chat'], bind: ['primary'] }]);
    const out = JSON.stringify(exportModels(s));
    expect(findSecrets(out)).toHaveLength(0);
    const j = JSON.parse(out);
    expect(j.roles.chat.primary.model).toBe('mimo-v2.6-flash');
    expect(j.accounts[0].secretRef).toBe('secret:mimo');
    expect(j.accounts[0].headers['x-extra']).toBe('***');
  });
  it('导入：缺 Key 标 hasKey=false；冲突交给选择', () => {
    const exp = exportModels(stateWith([{ acc: acct('ds', 'dashscope'), model: 'qwen3.7-plus', roles: ['chat'], bind: ['primary'] }]));
    const s = importModels(emptyModelsV3(), exp as never);
    expect(s.accounts[0]!.hasKey).toBe(false);
    expect(s.roles.chat.primary!.model).toBe('qwen3.7-plus');
    const choices: string[] = [];
    importModels(s, exp as never, (c) => { choices.push(c.model); return 'incoming'; });
    expect(choices).toEqual(['qwen3.7-plus']);
  });
  it('迁移 v2→v3 保留旧模型名、命中下线提示；v3→v2 回滚；幂等', () => {
    const v2 = { providers: [{ id: 'deepseek', label: 'DeepSeek', protocol: 'openai' as const, baseURL: 'https://api.deepseek.com', apiKey: 'sk-' + 'D'.repeat(30), model: 'deepseek-chat', check: { ok: true, at: 'x' } }, { id: 'mimo', label: 'MiMo', protocol: 'openai' as const, baseURL: 'https://api.xiaomimimo.com/v1', apiKey: '', model: 'mimo-v2.6-flash' }], defaultProvider: 'deepseek', advanced: { thinking: 'off' as const, temperature: null, fallbackProvider: 'mimo' } };
    const v3 = ModelsMigrator.migrate<any>(v2).doc;
    expect(v3.schemaVersion).toBe(3);
    expect(v3.accounts[0].models[0]).toMatchObject({ model: 'deepseek-chat', source: 'migrated', roles: ['chat'] });
    expect(v3.roles.chat.primary.model).toBe('deepseek-chat');
    expect(v3.roles.chat.fallback.model).toBe('mimo-v2.6-flash');
    expect(JSON.stringify(v3)).not.toContain('D'.repeat(30));
    const deps2 = JSON.parse(DEFAULT_FILES['config/model-deprecations.json']!).items;
    expect(deprecationOf('deepseek-chat', deps2)!.date).toBe('2026-07-24');
    const back = ModelsMigrator.migrate<any>(v3, 2).doc;
    expect(back.defaultProvider).toBe('deepseek');
    expect(back.providers.map((p: any) => p.model)).toEqual(['deepseek-chat', 'mimo-v2.6-flash']);
    expect(back.advanced.fallbackProvider).toBe('mimo');
    expect(JSON.stringify(upV2toV3(v2))).toBe(JSON.stringify(upV2toV3(v2)));
    expect(downV3toV2(upV2toV3(v2)).defaultProvider).toBe('deepseek');
  });
  it('获取列表后：列表里没有的标 not_in_list，并给同前缀替代（只提示）', () => {
    const a = acct('ds', 'openai-compatible');
    addModelEntry(a, { model: 'deepseek-chat', roles: ['chat'] });
    const r = markAgainstList(a, ['deepseek-flash', 'deepseek-v4-pro']);
    expect(a.models[0]!.status).toBe('not_in_list');
    expect(a.models[0]!.model).toBe('deepseek-chat');
    expect(r[0]!.suggestions).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  });
});

describe('错误分类（每个适配器至少 1 条录制样本）', () => {
  const ctx = (vendor: string): AdapterCtx & { role: 'chat' } => ({ account: acct('a', vendor), target: { accountId: 'a', modelEntryId: 'm', model: 'qwen3.7-plsu' }, apiKey: 'k', baseURL: 'https://x', role: 'chat' });
  const samples: [string, number, string, string][] = [
    ['dashscope', 400, '{"code":"InvalidParameter","message":"Model not exist."}', 'model_not_found'],
    ['dashscope', 403, '{"code":"Model.AccessDenied","message":"Model access denied."}', 'model_not_enabled'],
    ['dashscope', 400, '{"code":"DataInspectionFailed"}', 'content_filtered'],
    ['zhipu', 400, '{"error":{"code":"1211","message":"模型不存在，请检查模型代码。"}}', 'model_not_found'],
    ['zhipu', 429, '{"error":{"code":"1113","message":"您的账户已欠费"}}', 'quota'],
    ['ark', 404, '{"error":{"code":"InvalidEndpointOrModel.NotFound"}}', 'model_not_found'],
    ['ark', 403, '{"error":{"code":"ModelNotOpen"}}', 'model_not_enabled'],
    ['mimo', 400, '{"error":{"message":"Model Not Exist"}}', 'model_not_found'],
    ['minimax', 200, '{"base_resp":{"status_code":1008,"status_msg":"insufficient balance"}}', 'quota'],
    ['mock', 404, '{"error":{"code":"model_not_found"}}', 'model_not_found'],
  ];
  for (const [vendor, status, body, kind] of samples) it(`${vendor} ${status} → ${kind}`, () => { expect(adapterOf(vendor)!.classify!(status, body, ctx(vendor))!.kind).toBe(kind); });
  const generic: [number, string, string][] = [
    [404, '{"error":{"code":"model_not_found","message":"The model `gpt-x` does not exist"}}', 'model_not_found'],
    [403, '{"error":{"message":"access denied: model not activated"}}', 'model_not_enabled'],
    [400, '{"error":{"message":"This model does not support image generation"}}', 'capability_mismatch'],
    [401, '{"error":{"message":"Incorrect API key provided: sk-abc***"}}', 'key_invalid'],
    [402, 'insufficient balance', 'quota'], [429, 'rate limited', 'rate_limited'], [503, 'busy', 'server'], [400, 'content_filter triggered', 'content_filtered'],
  ];
  for (const [st, b, k] of generic) it(`通用 ${st} → ${k}`, () => { expect(classifyGeneric(st, b).kind).toBe(k); });
  it('model_not_found 的白话与两个按钮', () => {
    const e = classifyGeneric(404, '{"error":{"code":"model_not_found"}}', { model: 'qwen3.7-plsu' });
    expect(e.reason).toBe('模型名「qwen3.7-plsu」在这家服务里不存在。请核对拼写（大小写、点、横杠、斜杠），或点「获取列表」直接选。');
    expect(e.actions).toEqual(['fetch_list', 'rename_model']);
    expect(e.retriable).toBe(false);
  });
  it('错误文本里的 Key 被打码', () => { const k = 'sk-' + 'R'.repeat(30); expect(classifyGeneric(500, `bad key ${k}`, { secrets: [k] }).detail).not.toContain(k); });
});

describe('适配器 build / parse（假 HTTP）', () => {
  const C = (vendor: string, model: string, extra: Partial<AdapterCtx> = {}): AdapterCtx => ({ account: acct('a', vendor), target: { accountId: 'a', modelEntryId: 'm', model }, apiKey: 'sk-test', baseURL: adapterOf(vendor)!.defaultBaseURL, ...extra });
  it('注册表包含 5.8 矩阵的全部服务商且已冻结', () => {
    expect(ADAPTERS.ids().sort()).toEqual(['anthropic', 'ark', 'comfyui', 'dashscope', 'deepseek', 'elevenlabs', 'gemini', 'kimi', 'mimo', 'minimax', 'mock', 'ollama', 'openai', 'openai-compatible', 'replicate', 'siliconflow', 'stepfun', 'zhipu']);
    expect(ADAPTERS.isFrozen).toBe(true);
  });
  it('MiMo TTS：合成文本放 assistant、风格放 user，解析 audio.data', () => {
    const a = adapterOf('mimo')!; const req: RoleRequest = { role: 'tts', text: '你好', voice: '冰糖', style: '温柔一点' };
    const h = a.build(req, C('mimo', 'mimo-v2.5-tts'));
    const b = JSON.parse(h.body!);
    expect(b.messages).toEqual([{ role: 'user', content: '温柔一点' }, { role: 'assistant', content: '你好' }]);
    expect(b.audio).toEqual({ format: 'wav', voice: '冰糖' });
    const p = a.parse(req, ok({ choices: [{ message: { audio: { data: 'UklGRg==' } } }] }), C('mimo', 'x'));
    expect(p.value).toEqual({ type: 'media', items: [{ base64: 'UklGRg==', mime: 'audio/wav' }] });
  });
  it('MiMo 文本方言：max_completion_tokens + thinking.type；思考时不发 temperature', () => {
    const b = JSON.parse(adapterOf('mimo')!.build({ role: 'reason', messages: [{ role: 'user', content: 'x' }], temperature: 0.3 }, C('mimo', 'mimo-v2.6-pro')).body!);
    expect(b.max_completion_tokens).toBeDefined(); expect(b.thinking).toEqual({ type: 'enabled' }); expect(b.temperature).toBeUndefined();
  });
  it('MiMo ASR：input_audio Data URL', () => {
    const b = JSON.parse(adapterOf('mimo')!.build({ role: 'asr', audio: { base64: 'AAA', format: 'wav', mime: 'audio/wav' } }, C('mimo', 'mimo-v2.5-asr')).body!);
    expect(b.messages[0].content[0].input_audio.data).toBe('data:audio/wav;base64,AAA');
  });
  it('百炼生图：原生异步（X-DashScope-Async）+ 轮询解析', () => {
    const a = adapterOf('dashscope')!; const ctx = C('dashscope', 'qwen-image-3.0-pro');
    const h = a.build({ role: 'image', prompt: '猫', aspect: '3:4' }, ctx);
    expect(h.url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis');
    expect(h.headers['X-DashScope-Async']).toBe('enable');
    expect(JSON.parse(h.body!).parameters.size).toBe('960*1280');
    const sub = a.parse({ role: 'image', prompt: '猫' }, ok({ output: { task_id: 't1', task_status: 'PENDING' } }), ctx);
    expect(sub.value).toMatchObject({ type: 'job', jobId: 't1', status: 'queued' });
    expect(a.poll!.build('t1', ctx).url).toBe('https://dashscope.aliyuncs.com/api/v1/tasks/t1');
    const done = a.poll!.parse(ok({ output: { task_id: 't1', task_status: 'SUCCEEDED', results: [{ url: 'https://oss/x.png' }] } }), ctx);
    expect(done.value).toMatchObject({ status: 'succeeded', items: [{ url: 'https://oss/x.png', ttlHours: 24 }] });
  });
  it('百炼业务空间域名、TTS HTTP（output.audio.url）、重排、ASR', () => {
    const a = adapterOf('dashscope')!; const ctx = C('dashscope', 'cosyvoice-v3-flash', { account: acct('a', 'dashscope', { workspaceId: 'ws123' }) });
    expect(a.build({ role: 'tts', text: '你好' }, ctx).url).toBe('https://ws123.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
    expect(a.parse({ role: 'tts', text: '你好' }, ok({ output: { audio: { url: 'https://a/x.mp3' } } }), ctx).value).toMatchObject({ items: [{ url: 'https://a/x.mp3' }] });
    expect(a.build({ role: 'rerank', query: '猫', documents: ['猫咪', '汽车'] }, ctx).url).toMatch(/compatible-api\/v1\/reranks$/);
    const asr = JSON.parse(a.build({ role: 'asr', audio: { base64: 'B', format: 'wav', mime: 'audio/wav' } }, C('dashscope', 'qwen3-asr-flash')).body!);
    expect(asr.messages[0].content[0].input_audio.data).toBe('data:audio/wav;base64,B');
  });
  it('智谱视频：提交 + async-result 轮询', () => {
    const a = adapterOf('zhipu')!; const ctx = C('zhipu', 'cogvideox-3');
    expect(a.build({ role: 'video', prompt: 'x', duration: 5 }, ctx).url).toBe('https://open.bigmodel.cn/api/paas/v4/videos/generations');
    expect(a.parse({ role: 'video', prompt: 'x' }, ok({ id: 'v1' }), ctx).value).toMatchObject({ jobId: 'v1' });
    expect(a.poll!.parse(ok({ id: 'v1', task_status: 'SUCCESS', video_result: [{ url: 'https://v.mp4' }] }), ctx).value).toMatchObject({ status: 'succeeded' });
  });
  it('方舟改图（参考图 image 参数）与视频任务', () => {
    const a = adapterOf('ark')!; const ctx = C('ark', 'doubao-seedream-5-0-pro-260628');
    const b = JSON.parse(a.build({ role: 'imageEdit', images: ['data:image/png;base64,AA'], instruction: '白底' }, ctx).body!);
    expect(b.image).toBe('data:image/png;base64,AA'); expect(b.prompt).toBe('白底');
    expect(a.build({ role: 'video', prompt: 'x' }, ctx).url).toMatch(/contents\/generations\/tasks$/);
  });
  it('MiniMax：image_generation base64、t2a_v2 hex 音频', () => {
    const a = adapterOf('minimax')!; const ctx = C('minimax', 'image-01');
    expect(a.parse({ role: 'image', prompt: 'x' }, ok({ data: { image_base64: ['QUJD'] } }), ctx).value).toMatchObject({ items: [{ base64: 'QUJD' }] });
    expect(a.parse({ role: 'tts', text: 'hi' }, ok({ data: { audio: '414243' } }), ctx).value).toMatchObject({ items: [{ base64: 'QUJD' }] });
  });
  it('OpenAI 兼容：改图与转写走 multipart，配音二进制', () => {
    const a = adapterOf('openai')!; const ctx = C('openai', 'some-image-model');
    const h = a.build({ role: 'imageEdit', images: ['data:image/png;base64,AA'], instruction: 'x' }, ctx);
    expect(h.multipart!.find((p) => p.name === 'image')).toMatchObject({ mime: 'image/png', base64: 'AA' });
    expect(a.build({ role: 'asr', audio: { base64: 'B', format: 'mp3', mime: 'audio/mpeg' } }, ctx).multipart!.find((p) => p.name === 'file')).toBeTruthy();
    expect(a.build({ role: 'tts', text: 'x' }, ctx).responseType).toBe('binary');
    expect(a.parse({ role: 'tts', text: 'x' }, { status: 200, base64: 'SUQz', mime: 'audio/mpeg' }, ctx).value).toMatchObject({ items: [{ base64: 'SUQz' }] });
  });
  it('硅基流动生图 1 小时有效、重排解析', () => {
    const a = adapterOf('siliconflow')!; const ctx = C('siliconflow', 'x');
    expect(a.parse({ role: 'image', prompt: 'x' }, ok({ images: [{ url: 'https://i' }] }), ctx).value).toMatchObject({ items: [{ ttlHours: 1 }] });
    expect(a.parse({ role: 'rerank', query: 'q', documents: ['a', 'b'] }, ok({ results: [{ index: 1, relevance_score: 0.2 }, { index: 0, relevance_score: 0.9 }] }), ctx).value).toEqual({ type: 'ranking', results: [{ index: 0, score: 0.9 }, { index: 1, score: 0.2 }] });
  });
  it('Replicate：owner/name、Prefer: wait、字段对照', () => {
    const a = adapterOf('replicate')!;
    const h = a.build({ role: 'image', prompt: 'x', aspect: '1:1' }, C('replicate', 'black-forest-labs/flux-schnell', { account: acct('a', 'replicate', { extra: { 'map.prompt': 'text' } }) }));
    expect(h.url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions');
    expect(h.headers.Prefer).toBe('wait=60'); expect(JSON.parse(h.body!).input.text).toBe('x');
    expect(() => a.build({ role: 'image', prompt: 'x' }, C('replicate', 'noslash'))).toThrow(/owner\/name/);
  });
  it('ComfyUI：工作流字段对照写入节点、model 不发送、解析 checkpoint', () => {
    const a = adapterOf('comfyui')!;
    const wf = JSON.stringify({ '3': { class_type: 'KSampler', inputs: { seed: 1 } }, '6': { class_type: 'CLIPTextEncode', inputs: { text: '' } }, '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } } });
    const h = a.build({ role: 'image', prompt: '猫', seed: 42 }, C('comfyui', 'workflow:我的工作流', { target: { accountId: 'a', modelEntryId: 'm', model: 'workflow:我的工作流', options: { workflow: wf, map: { prompt: '6.text', seed: '3.seed' } } } }));
    const g = JSON.parse(h.body!).prompt;
    expect(g['6'].inputs.text).toBe('猫'); expect(g['3'].inputs.seed).toBe(42);
    expect(h.body).not.toContain('workflow:我的工作流');
  });
  it('Ollama 列表走 /api/tags；Anthropic messages', () => {
    expect(adapterOf('ollama')!.listModels!.build({ account: acct('a', 'ollama'), apiKey: '', baseURL: 'http://192.168.1.10:11434/v1' }).url).toBe('http://192.168.1.10:11434/api/tags');
    expect(adapterOf('ollama')!.listModels!.parse(ok({ models: [{ name: 'qwen3:8b' }] }))).toEqual([{ id: 'qwen3:8b' }]);
    const h = adapterOf('anthropic')!.build({ role: 'chat', messages: [{ role: 'system', content: 'S' }, { role: 'user', content: 'u' }] }, C('anthropic', 'claude-x'));
    expect(JSON.parse(h.body!).system).toBe('S'); expect(h.headers['x-api-key']).toBe('sk-test');
  });
  it('ElevenLabs 与 Kimi 列表能力字段', () => {
    expect(adapterOf('elevenlabs')!.build({ role: 'tts', text: 'x' }, C('elevenlabs', 'eleven_v3')).headers['xi-api-key']).toBe('sk-test');
    const l = adapterOf('kimi')!.listModels!.parse(ok({ data: [{ id: 'kimi-k3', context_length: 1000000, supports_image_in: true, supports_reasoning: true }] }));
    expect(l[0]).toMatchObject({ id: 'kimi-k3', contextLength: 1000000, caps: { imageIn: true, reasoning: true } });
  });
});

describe('统一能力层 callRole（路由 / 重试 / 备用 / 记账）', () => {
  const two = () => stateWith([
    { acc: acct('a1', 'openai-compatible', { baseURL: 'https://a1/v1' }), model: 'm1', roles: ['image'], bind: ['primary'] },
    { acc: acct('a2', 'openai-compatible', { baseURL: 'https://a2/v1' }), model: 'm2', roles: ['image'], bind: ['fallback'] },
  ]);
  const img = { b64: ok({ data: [{ b64_json: 'QUJD' }] }) };
  it('未配置 → role_not_configured（生图不跨角色回退）', async () => { const r = await callRole('image', { role: 'image', prompt: 'x' }, deps(emptyModelsV3(), fakeTransport(() => img.b64))); expect(!r.ok && r.error.kind).toBe('role_not_configured'); });
  it('fast 未配置回退 chat；reason 回退 chat 并开思考', async () => {
    const s = stateWith([{ acc: acct('m', 'mimo', { baseURL: 'https://api.xiaomimimo.com/v1' }), model: 'mimo-v2.6-flash', roles: ['chat'], bind: ['primary'] }]);
    expect(resolveTarget(s, 'fast')!.via).toBe('role-fallback');
    const tr = fakeTransport(() => ok({ choices: [{ message: { content: '2' } }] }));
    await callRole('reason', { role: 'reason', messages: [{ role: 'user', content: '1+1' }] }, deps(s, tr));
    expect(JSON.parse(tr.calls[0]!.body!).thinking).toEqual({ type: 'enabled' });
  });
  it('5xx 退避重试 2 次（1s、2s ±20%）后切备用一次，并写明', async () => {
    const delays: number[] = [];
    const tr = fakeTransport((req) => (req.url.startsWith('https://a1') ? { status: 503, text: 'busy' } : img.b64));
    const r = await callRole('image', { role: 'image', prompt: 'x' }, deps(two(), tr, { sleep: async (ms) => { delays.push(ms); } }));
    expect(r.ok).toBe(true);
    expect(delays).toEqual([1000, 2000]);
    expect(tr.calls.filter((c) => c.url.startsWith('https://a1'))).toHaveLength(3);
    expect(r.ok && r.usedFallback && r.note).toMatch(/已改用备用：m2/);
  });
  it('429 尊重 Retry-After', async () => {
    const delays: number[] = []; let n = 0;
    const tr = fakeTransport(() => (n++ === 0 ? { status: 429, text: 'rl', headers: { 'retry-after': '3' } } : img.b64));
    await callRole('image', { role: 'image', prompt: 'x' }, deps(two(), tr, { sleep: async (ms) => { delays.push(ms); } }));
    expect(delays[0]).toBe(3000);
  });
  for (const [status, body, kind] of [[401, 'invalid api key', 'key_invalid'], [402, 'insufficient balance', 'quota'], [400, 'content_filter', 'content_filtered'], [404, 'model_not_found', 'model_not_found']] as const) {
    it(`${kind}：不重试、不切备用`, async () => {
      const tr = fakeTransport(() => ({ status, text: body }));
      const r = await callRole('image', { role: 'image', prompt: 'x' }, deps(two(), tr));
      expect(!r.ok && r.error.kind).toBe(kind);
      expect(tr.calls).toHaveLength(1);
    });
  }
  it('断网 → network_offline，不发请求', async () => { const tr = fakeTransport(() => img.b64); const r = await callRole('image', { role: 'image', prompt: 'x' }, deps(two(), tr, { online: () => false })); expect(!r.ok && r.error.kind).toBe('network_offline'); expect(tr.calls).toHaveLength(0); });
  it('健康路由：默认近期不稳定 → 先走备用', async () => {
    const h = new HealthTracker(); for (let i = 0; i < 4; i++) h.record('a1:m1', false);
    expect(resolveTarget(two(), 'image', { health: h })!.via).toBe('fallback-first');
  });
  it('@ 覆盖只用指定的，不悄悄换别家', async () => {
    const s = two(); const t = s.roles.image.fallback!;
    const tr = fakeTransport(() => ({ status: 401, text: 'invalid key' }));
    const r = await callRole('image', { role: 'image', prompt: 'x' }, deps(s, tr), { override: t });
    expect(!r.ok).toBe(true); expect(tr.calls.every((c) => c.url.startsWith('https://a2'))).toBe(true);
  });
  it('respondedModel 与请求不同 → 结果带 respondedModel', async () => {
    const s = stateWith([{ acc: acct('x', 'openai-compatible', { baseURL: 'https://x/v1' }), model: 'old-name', roles: ['chat'], bind: ['primary'] }]);
    const r = await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: 'x' }] }, deps(s, fakeTransport(() => ok({ model: 'new-name-2026', choices: [{ message: { content: 'ok' } }] }))));
    expect(r.ok && r.respondedModel).toBe('new-name-2026');
    expect(r.ok && r.target.model).toBe('old-name');
  });
  it('缓存：fast 与 embed 命中缓存，键不含 Key', async () => {
    const s = stateWith([{ acc: acct('m', 'mock'), model: 'mock-embed', roles: ['embed'], bind: ['primary'] }]);
    const store = new Map<string, any>();
    const cache = { get: async (k: string) => store.get(k), set: async (k: string, v: any) => { store.set(k, v); } };
    const a = await callRole('embed', { role: 'embed', input: ['测试'] }, deps(s, fakeTransport(() => ok({})), { cache }));
    const b = await callRole('embed', { role: 'embed', input: ['测试'] }, deps(s, fakeTransport(() => ok({})), { cache }));
    expect(a.ok && !a.fromCache).toBe(true); expect(b.ok && b.fromCache).toBe(true);
    expect(cacheKey('embed', 'mock', 'x', { role: 'embed', input: ['a'] })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('用量记录：requestedModel / respondedModel / 费用（已核实单价）', async () => {
    const s = stateWith([{ acc: acct('m', 'mimo', { baseURL: 'https://api.xiaomimimo.com/v1' }), model: 'mimo-v2.6-flash', roles: ['chat'], bind: ['primary'] }]);
    const recs: any[] = [];
    await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: 'x' }] }, deps(s, fakeTransport(() => ok({ model: 'mimo-v2.6-flash', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1000000, completion_tokens: 0 } })), { onUsage: (r) => { recs.push(r); } }));
    expect(recs[0]).toMatchObject({ role: 'chat', requestedModel: 'mimo-v2.6-flash', cost: 1, ok: true });
    expect(costOf(priceOf('dashscope', 'unknown-model'), { images: 1 })).toBeNull();
    expect(estimateCost('image', undefined, { images: 1 })).toBeNull();
  });
  it('网页直连失败 → cors 白话', async () => {
    const s = stateWith([{ acc: acct('x', 'openai-compatible', { baseURL: 'https://example-relay.invalid/v1' }), model: 'm', roles: ['chat'], bind: ['primary'] }]);
    const tr = { async send() { throw new TypeError('Failed to fetch'); } };
    const r = await callRole('chat', { role: 'chat', messages: [{ role: 'user', content: 'x' }] }, deps(s, tr, { web: true }));
    expect(!r.ok && r.error.kind).toBe('cors');
    expect(!r.ok && r.error.reason).toContain('不允许网页直接调用');
  });
});

describe('能力声明驱动 Schema（C8）', () => {
  it('改声明后 aspect enum 同步变化；未声明不限制', () => {
    const base = { type: 'object', properties: { aspect: { type: 'string' }, n: { type: 'integer', maximum: 4 } } };
    expect((narrowToolSchema(base, mergeDecl('image', 'x', 'y', { aspectRatios: ['1:1', '16:9'] })) as any).properties.aspect.enum).toEqual(['1:1', '16:9']);
    expect((narrowToolSchema(base, mergeDecl('image', 'x', 'y', { aspectRatios: ['3:4'], maxImages: 2 })) as any).properties.n.maximum).toBe(2);
    expect((narrowToolSchema(base, mergeDecl('image', 'x', 'y')) as any).properties.aspect.enum).toBeUndefined();
    expect(mergeDecl('image', 'mock', 'm', adapterOf('mock')!.declare('image', 'm')).verified).toBe('live');
    expect(mergeDecl('image', 'dashscope', 'm', adapterOf('dashscope')!.declare('image', 'm')).verified).toBe('doc');
  });
});

describe('最小探测（5.5，Mock 全角色）', () => {
  it('11 个角色都有探测定义；会花钱的需要确认', async () => {
    expect(Object.keys(PROBES).sort()).toEqual([...ROLE_IDS].sort());
    const a = acct('mock', 'mock');
    const s = emptyModelsV3(); s.accounts.push(a);
    const e = addModelEntry(a, { model: 'mock-all', roles: [...ROLE_IDS] }); if (!e.ok) throw 0;
    const free = await probeEntry(a, e.entry, deps(s, fakeTransport(() => ok({}))));
    expect(free.filter((x) => x.result.kind === 'needs_confirm').map((x) => x.role).sort()).toEqual(['image', 'imageEdit', 'video']);
    expect(free.filter((x) => x.result.kind !== 'needs_confirm').every((x) => x.result.ok)).toBe(true);
    const paid = await probeEntry(a, e.entry, deps(s, fakeTransport(() => ok({}))), { allowPaid: true });
    expect(paid.every((x) => x.result.ok)).toBe(true);
    expect(statusFromProbes(paid)).toBe('ok');
  });
  it('错误模型名：探测得 not_found，不切别的', async () => {
    const a = acct('mock', 'mock'); const s = emptyModelsV3(); s.accounts.push(a);
    const e = addModelEntry(a, { model: 'qwen3.7-plsu-notfound', roles: ['chat'] }); if (!e.ok) throw 0;
    const r = await probeEntry(a, e.entry, deps(s, fakeTransport(() => ok({}))));
    expect(r[0]!.result.kind).toBe('model_not_found'); expect(statusFromProbes(r)).toBe('not_found');
  });
  it('探测请求体的 model 就是用户填的字符串', async () => {
    const a = acct('r', 'openai-compatible', { baseURL: 'https://r/v1' }); const s = emptyModelsV3(); s.accounts.push(a);
    const e = addModelEntry(a, { model: 'Org/Model:Tag.v1', roles: ['chat'] }); if (!e.ok) throw 0;
    const tr = fakeTransport(() => ok({ model: 'Org/Model:Tag.v1-2026', choices: [{ message: { content: '你好' } }] }));
    const r = await probeEntry(a, e.entry, deps(s, tr));
    expect(JSON.parse(tr.calls[0]!.body!).model).toBe('Org/Model:Tag.v1');
    expect(r[0]!.result.respondedModel).toBe('Org/Model:Tag.v1-2026');
  });
});

describe('获取模型列表（5.10.3）', () => {
  const a = acct('x', 'openai-compatible', { baseURL: 'https://x/v1' });
  it('成功 / 空列表', async () => {
    expect(await listModels(a, { transport: fakeTransport(() => ok({ data: [{ id: 'a' }, { id: 'b' }] })), apiKey: 'k' })).toEqual({ ok: true, models: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })] });
    expect(await listModels(a, { transport: fakeTransport(() => ok({ data: [] })), apiKey: 'k' })).toEqual({ ok: true, models: [] });
  });
  it('404 → 没有提供列表（不阻塞）', async () => { const r = await listModels(a, { transport: fakeTransport(() => ({ status: 404, text: '' })), apiKey: 'k' }); expect(!r.ok && r.unsupported).toBe(true); expect(!r.ok && r.error.reason).toContain('没有提供模型列表'); });
  it('401 → 先检查 Key', async () => { const r = await listModels(a, { transport: fakeTransport(() => ({ status: 401, text: '' })), apiKey: 'k' }); expect(!r.ok && r.error.reason).toBe('Key 不对或没有权限，先检查 Key'); });
  it('网络错误 → 白话', async () => { const r = await listModels(a, { transport: { async send() { throw new TypeError('x'); } }, apiKey: 'k', web: false }); expect(!r.ok && r.error.kind).toBe('network'); });
});
