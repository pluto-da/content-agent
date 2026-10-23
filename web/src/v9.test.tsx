/** 0.9.0 本机接线测试：Key 迁移进加密存储、能力层 Mock 全角色、新 Agent 运行时（工具 / 审批 / 未配置 / AIGC 标识 / 审计 / 用量）、VFS 首启与系统文件即时生效、备份不含 Key。 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ROLE_IDS, addModelEntry, bindRole, emptyModelsV3, findSecrets, unzip, type ModelsStateV3, type RoleId } from '@content-agent/shared';
import { resetLocalDb, db } from './local/db';
import { resetSecureKey } from './local/secure';
import { getModels, getModelsV3, saveModels, saveModelsV3, EMPTY_MODELS, setPrefs } from './local/store';
import { getSecret } from './local/secrets';
import type { ProviderConfig } from './local/llm';
import type { AgentMsg, AgentReply } from './agent/model';
import type { AgentEvent } from './agent/events';
import { createConversation, listMessages } from './agent/store';
import { runTurnV9 } from './v9/engine';
import { getVfs, resetVfsForTests, vfsFiles } from './v9/vfsBackend';
import { call, probe } from './v9/models';
import { listAudit, modelStats } from './v9/ops';
import { pngReadText } from './v9/aigc';
import { exportBackup, restoreBackup } from './v9/backup';
import { base64ToBytes } from '@content-agent/shared';

const mimo: ProviderConfig = { id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-test-v9-ABCDEFGH12345678', model: 'mimo-v2.6-flash', check: { ok: true, at: 'x' } };
beforeEach(() => { resetLocalDb(); resetSecureKey(); resetVfsForTests(); vi.unstubAllGlobals(); });

async function mockRoles(roles: RoleId[] = [...ROLE_IDS].filter((r) => r !== 'chat')): Promise<ModelsStateV3> {
  let s = await getModelsV3();
  if (!s.accounts.some((a) => a.id === 'mock')) s.accounts.push({ id: 'mock', vendor: 'mock', label: '模拟', baseURL: 'mock://local', region: 'test', models: [], hasKey: true });
  for (const r of roles) { const a = s.accounts.find((x) => x.id === 'mock')!; const e = addModelEntry(a, { model: `mock-${r}`, roles: [r] }); if (e.ok) s = bindRole(s, r, 'primary', e.entry); }
  await saveModelsV3(s);
  return s;
}
function mockModel(script: ((msgs: AgentMsg[]) => Partial<AgentReply>)[]) {
  let i = 0; const calls: AgentMsg[][] = [];
  const fn = vi.fn(async (_c: ProviderConfig, msgs: AgentMsg[], o: { onDelta?: (d: { content: string; reasoning: string }) => void } = {}) => {
    calls.push(msgs);
    const step = script[Math.min(i++, script.length - 1)]!(msgs);
    if (step.content) o.onDelta?.({ content: step.content, reasoning: '' });
    return { content: '', toolCalls: [], usage: { input: 100, output: 20 }, ms: 5, model: 'mimo-v2.6-flash', streamed: true, chunks: 1, ...step } as AgentReply;
  });
  return { fn, calls };
}
const tc = (name: string, args: unknown) => ({ toolCalls: [{ id: `c_${name}`, name, arguments: JSON.stringify(args) }] });

describe('Key 安全存储与模型配置迁移（ADR-003 / ADR-004）', () => {
  it('旧 kv models（含明文 Key）→ v3 + 加密 secrets；任何 kv 里都找不到明文 Key；getModels 仍能拿到 Key', async () => {
    await db.setKV('models', { providers: [mimo], defaultProvider: 'mimo', advanced: { thinking: 'off', temperature: null, fallbackProvider: null } });
    const m = await getModels();
    expect(m.providers[0]!.apiKey).toBe(mimo.apiKey);
    expect(m.defaultProvider).toBe('mimo');
    for (const k of ['models', 'models_v3', 'models_v2_backup', 'secrets']) expect(JSON.stringify(await db.getKV(k))).not.toContain(mimo.apiKey);
    expect(await getSecret('secret:mimo')).toBe(mimo.apiKey);
    expect((await db.getKV<Record<string, number>>('schema'))!.models).toBe(4);   // 1.1.0：v2 → v3 → v4 一次走完
    expect((await getModelsV3()).main!.model).toBe('mimo-v2.6-flash');
  });
  it('saveModels（0.8 接口）写入 v3：账号 Key 共用；删除账号同时删 Key', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    const v3 = await getModelsV3();
    expect(v3.main!.model).toBe('mimo-v2.6-flash');   // 1.1.0：默认服务商 = 主模型
    expect(v3.accounts[0]!.hasKey).toBe(true);
    expect(JSON.stringify(v3)).not.toContain(mimo.apiKey);
    await saveModels({ ...EMPTY_MODELS, providers: [], defaultProvider: null });
    expect(await getSecret('secret:mimo')).toBe('');
  });
  it('saveModelsV3 拒绝含 Key 的配置', async () => {
    const s = emptyModelsV3(); s.accounts.push({ id: 'x', vendor: 'openai-compatible', label: `sk-${'Z'.repeat(30)}`, baseURL: '', region: 'cn', models: [], hasKey: false });
    await expect(saveModelsV3(s)).rejects.toThrow(/疑似 Key/);
  });
});

describe('统一能力层（Mock 全角色，C4 / C7）', () => {
  it('11 个角色经统一函数各跑通一次，用量落库，运行状态可聚合', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await mockRoles();
    const reqs: Record<string, unknown> = { reason: { role: 'reason', messages: [{ role: 'user', content: '1+1' }] }, fast: { role: 'fast', messages: [{ role: 'user', content: 'x' }] }, vision: { role: 'vision', image: 'data:image/png;base64,AA', question: '颜色' }, image: { role: 'image', prompt: '猫' }, imageEdit: { role: 'imageEdit', images: ['data:image/png;base64,AA'], instruction: '白底' }, tts: { role: 'tts', text: '你好' }, asr: { role: 'asr', audio: { base64: 'UklGRg==', format: 'wav', mime: 'audio/wav' } }, video: { role: 'video', prompt: '猫' }, embed: { role: 'embed', input: ['测试'] }, rerank: { role: 'rerank', query: '猫', documents: ['猫咪', '汽车'] } };
    for (const [role, req] of Object.entries(reqs)) { const r = await call(role as RoleId, req as never); expect(r.ok, role).toBe(true); }
    const st = await modelStats();
    expect(st.totals.calls).toBeGreaterThanOrEqual(10);
    expect(st.stats.every((x) => x.errorRate === 0)).toBe(true);
  });
  it('探测写回状态；错误模型名 → not_found 且不切别的', async () => {
    const s = await mockRoles(['image']);
    const a = s.accounts.find((x) => x.id === 'mock')!;
    const bad = addModelEntry(a, { model: 'qwen3.7-plsu-notfound', roles: ['chat'] }); if (!bad.ok) throw 0;
    await saveModelsV3(s);
    const r = await probe('mock', bad.entry.id);
    expect(r[0]!.result.kind).toBe('model_not_found');
    expect((await getModelsV3()).accounts.find((x) => x.id === 'mock')!.models.find((m) => m.id === bad.entry.id)!.status).toBe('not_found');
  });
});

describe('新 Agent 运行时（本机接线）', () => {
  it('写稿后配图：媒体入库带 AIGC 隐式标识、卡片、审计、用量；最终回复如实', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu'], onboarded: true, flags: { 'agent.planner': false } });
    await mockRoles(['image']);
    const c = await createConversation();
    const m = mockModel([() => tc('image_generate', { prompt: '馆陶小米粥，竖版' }), () => ({ content: '已生成 1 张图，在上面。' })]);
    const ev: AgentEvent[] = [];
    await runTurnV9({ conversationId: c.id, text: '出一张配图', cfg: mimo, onEvent: (e) => ev.push(e), call: m.fn as never });
    expect(ev.at(-1)).toEqual({ type: 'done', stopped: false, error: undefined });
    const media = await db.all('media');
    expect(media).toHaveLength(1);
    const meta = pngReadText(base64ToBytes(String(media[0]!.dataUrl).split(',')[1]!));
    expect(JSON.parse(meta.AIGC!)).toMatchObject({ Label: '1', LabelText: 'AI 生成' });   // 0.10.0：字段对齐 GB 45438 结构（Label 为代码，文字在 LabelText），见 deviations-v10 T1
    const msgs = await listMessages(c.id);
    expect(msgs.some((x) => x.cards?.some((k) => k.type === 'image' && k.status === 'done'))).toBe(true);
    expect(msgs.at(-1)!.content).toContain('已生成 1 张图');
    expect((await listAudit({ kinds: ['tool_call'] })).some((a) => a.tool === 'image_generate')).toBe(true);
    expect((await db.all('usage_log')).some((u) => u.role === 'image')).toBe(true);
    // 系统提示来自 VFS（SYSTEM.md 在最前）
    expect(String(m.calls[0]![0]!.content)).toContain('<!-- SYSTEM.md -->');
  });
  it('未接生图：出未配置卡（深链），不调用生图', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ onboarded: true, flags: { 'agent.planner': false } });
    const c = await createConversation();
    const m = mockModel([() => tc('image_generate', { prompt: '猫' }), () => ({ content: '还没接生图模型，文字先写好了。' })]);
    await runTurnV9({ conversationId: c.id, text: '出一张图', cfg: mimo, onEvent: () => {}, call: m.fn as never });
    const msgs = await listMessages(c.id);
    expect(msgs.some((x) => x.cards?.some((k) => k.type === 'not_configured' && k.data.deepLink === '#me/models/image'))).toBe(true);
    expect((await db.all('usage_log')).some((u) => u.role === 'image')).toBe(false);
  });
  it('视频生成每次都先确认；拒绝则不提交、审计记“拒绝”', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ onboarded: true, flags: { 'agent.planner': false } });
    await mockRoles(['video']);
    const c = await createConversation();
    const m = mockModel([() => tc('video_generate', { prompt: '秋收 5 秒', duration: 5 }), () => ({ content: '好，不生成了。' })]);
    const seen: string[] = [];
    await runTurnV9({ conversationId: c.id, text: '做个视频', cfg: mimo, call: m.fn as never, onEvent: (e) => { if (e.type === 'confirm') { seen.push(e.label); e.resolve('deny'); } } });
    expect(seen[0]).toContain('视频生成每次都要确认');
    expect((await db.all('usage_log')).some((u) => u.role === 'video')).toBe(false);
    expect((await listAudit({ kinds: ['approval'] }))[0]!.outcome).toBe('denied');
  });
  it('越界请求：不调用模型、不调用工具', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    const c = await createConversation();
    const m = mockModel([() => ({ content: 'x' })]);
    await runTurnV9({ conversationId: c.id, text: '帮我自动去小红书点赞', cfg: mimo, onEvent: () => {}, call: m.fn as never });
    expect(m.fn).not.toHaveBeenCalled();
    expect((await listMessages(c.id)).at(-1)!.content).toMatch(/这个我不做/);
  });
  it('编辑 SYSTEM.md 后下一轮立即生效（G24 本机）', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    const v = await getVfs();
    const f = (await v.read('SYSTEM.md'))!;
    await v.write('SYSTEM.md', f.content.replace('## 核心原则（按重要性）', '## 核心原则（按重要性）\n0. 标题不要用问号。'), { author: 'user', expectedVersion: f.version });
    const c = await createConversation();
    const m = mockModel([() => ({ content: '好' })]);
    await runTurnV9({ conversationId: c.id, text: '写个标题', cfg: mimo, onEvent: () => {}, call: m.fn as never });
    expect(String(m.calls[0]![0]!.content)).toContain('标题不要用问号');
  });
});

describe('VFS 首启与备份（C31 / C36 / 企业级备份恢复）', () => {
  it('首启生成默认文件，目录守护器 0 问题（除 front matter 选填字段）', async () => {
    const files = await vfsFiles();
    expect(Object.keys(files).length).toBeGreaterThan(100);
    expect(files['BOUNDARIES.md']).toContain('BOUNDARIES');
  });
  it('一键备份不含 Key；恢复后数据回来、Key 需要重填', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await db.insert('drafts', { title: '备份测试', body: '正文', platform: 'xiaohongshu' });
    await getVfs();
    const z = await exportBackup({ includeMedia: false });
    const text = new TextDecoder().decode(z);
    expect(text).not.toContain(mimo.apiKey);
    expect(findSecrets(text)).toHaveLength(0);
    expect(unzip(z).some((e) => e.path === 'manifest.json')).toBe(true);
    resetLocalDb(); resetSecureKey(); resetVfsForTests();
    const r = await restoreBackup(z, { conflict: 'incoming' });
    expect(r.errors).toEqual([]);
    expect((await db.all('drafts')).some((d) => d.title === '备份测试')).toBe(true);
    const m = await getModels();
    expect(m.providers[0]!.id).toBe('mimo');
    expect(m.providers[0]!.apiKey).toBe('');
  });
});
