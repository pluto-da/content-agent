/**
 * 0.10.0 界面与接线：@ 菜单（按能力分组、“显示名（模型名）· 服务商”、胶囊、只影响本轮、消息标注）、按任务路由页（封面 / 识字 / 压缩）、
 * 卡片预览（13 类 × 正常 / 失败）、诊断页（Key 存储 isInsideSecureHardware）。
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addModelEntry, bindRole, resolveTarget, type ModelsStateV3, type RoleId } from '@content-agent/shared';
import { App } from '../App';
import { db, resetLocalDb } from '../local/db';
import { resetSecureKey } from '../local/secure';
import { getModelsV3, saveModelsV3, saveModels, setPrefs, EMPTY_MODELS } from '../local/store';
import type { ProviderConfig } from '../local/llm';
import type { AgentMsg, AgentReply } from '../agent/model';
import type { AgentEvent } from '../agent/loop';
import { createConversation, listMessages } from '../agent/store';
import { runTurnV9 } from '../v9/engine';
import { resetVfsForTests } from '../v9/vfsBackend';
import { atOptions, atQuery, AtMenu, AtChips } from './AtMenu';
import { setTaskRoute, ROUTING_TASKS, RoutingPage } from './RoutingPage';
import { galleryItems, CardGallery } from './CardGallery';
import { KeyStorageSection } from './Diagnostics';

const mimo: ProviderConfig = { id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-test-v10-ABCDEFGH12345678', model: 'mimo-v2.6-flash', check: { ok: true, at: 'x' } };
beforeEach(() => {
  resetLocalDb(); resetSecureKey(); resetVfsForTests(); localStorage.clear(); sessionStorage.clear(); location.hash = '';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** 一个“模拟”账号，生图有两个模型名（默认 + 备选，带显示名），看图一个。 */
async function twoImageModels(): Promise<ModelsStateV3> {
  let s = await getModelsV3();
  s.accounts.push({ id: 'mock', vendor: 'mock', label: '模拟', baseURL: 'mock://local', region: 'test', models: [], hasKey: true });
  const a = s.accounts.find((x) => x.id === 'mock')!;
  const e1 = addModelEntry(a, { model: 'mock-image', roles: ['image'], label: '默认生图' });
  addModelEntry(a, { model: 'Mock/Image:v2.0', roles: ['image'], label: '高清生图' });
  const e3 = addModelEntry(a, { model: 'mock-vision', roles: ['vision'] });
  if (e1.ok) s = bindRole(s, 'image', 'primary', e1.entry);
  if (e3.ok) s = bindRole(s, 'vision', 'primary', e3.entry);
  await saveModelsV3(s);
  return getModelsV3();
}
function mockModel(script: ((msgs: AgentMsg[]) => Partial<AgentReply>)[]) {
  let i = 0;
  return vi.fn(async (_c: ProviderConfig, msgs: AgentMsg[], o: { onDelta?: (d: { content: string; reasoning: string }) => void } = {}) => {
    const step = script[Math.min(i++, script.length - 1)]!(msgs);
    if (step.content) o.onDelta?.({ content: step.content, reasoning: '' });
    return { content: '', toolCalls: [], usage: { input: 10, output: 5 }, ms: 5, model: 'mimo-v2.6-flash', streamed: true, chunks: 1, ...step } as AgentReply;
  });
}
const tc = (name: string, args: unknown) => ({ toolCalls: [{ id: `c_${name}_${Math.random()}`, name, arguments: JSON.stringify(args) }] });

describe('@ 菜单', () => {
  it('atQuery：只在 @ 词处触发（行首或空格后）；邮箱不触发', () => {
    expect(atQuery('@')).toEqual({ q: '', start: 0 });
    expect(atQuery('出图 @生')).toEqual({ q: '生', start: 3 });
    expect(atQuery('a@b.com')).toBeNull();
    expect(atQuery('写一篇')).toBeNull();
  });
  it('atOptions：按能力分组，每项“显示名（模型名）· 服务商”，可按能力名或模型名筛选', async () => {
    const s = await twoImageModels();
    const all = atOptions(s, '');
    expect(all.map((o) => o.text)).toEqual(['mock-vision · 模拟', '默认生图（mock-image） · 模拟', '高清生图（Mock/Image:v2.0） · 模拟']);
    expect(atOptions(s, '生图').every((o) => o.role === 'image')).toBe(true);
    expect(atOptions(s, 'v2.0').map((o) => o.target.model)).toEqual(['Mock/Image:v2.0']);
  });
  it('AtMenu / AtChips 渲染：分组标题、选项、胶囊与移除按钮', async () => {
    const s = await twoImageModels();
    const pick = vi.fn();
    render(<AtMenu state={s} q="" onPick={pick} onClose={() => undefined} />);
    expect(within(screen.getByTestId('at-menu')).getByRole('group', { name: '生图' })).toBeTruthy();
    fireEvent.click(screen.getAllByTestId('at-opt-image')[1]!);
    expect(pick.mock.calls[0]![0]).toMatchObject({ role: 'image', text: '高清生图（Mock/Image:v2.0） · 模拟', target: { model: 'Mock/Image:v2.0' } });
    cleanup();
    const rm = vi.fn();
    render(<AtChips picks={[pick.mock.calls[0]![0]]} onRemove={rm} />);
    expect(screen.getByTestId('at-chip-image').textContent).toContain('@生图：高清生图（Mock/Image:v2.0） · 模拟');
    fireEvent.click(screen.getByRole('button', { name: /移除/ }));
    expect(rm).toHaveBeenCalledWith('image');
  });
  it('@ 指定只影响本轮：本轮用指定模型出图并在消息上标注；下一轮回到默认', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu'], onboarded: true, flags: { 'agent.planner': false } });
    const s = await twoImageModels();
    const opt = atOptions(s, 'v2.0')[0]!;
    const c = await createConversation();
    const ev: AgentEvent[] = [];
    await runTurnV9({ conversationId: c.id, text: '出一张封面', cfg: mimo, onEvent: (e) => ev.push(e), call: mockModel([() => tc('image_generate', { prompt: '封面' }), () => ({ content: '好了' })]) as never, override: { image: opt.target }, overrideLabels: ['生图：高清生图（Mock/Image:v2.0） · 模拟'] });
    let media = await db.all('media');
    expect(media.at(-1)!.model).toBe('Mock/Image:v2.0');
    const msgs = await listMessages(c.id);
    expect(msgs.find((m) => m.role === 'user')!.meta?.atOverride).toEqual(['生图：高清生图（Mock/Image:v2.0） · 模拟']);
    await runTurnV9({ conversationId: c.id, text: '再来一张', cfg: mimo, onEvent: () => undefined, call: mockModel([() => tc('image_generate', { prompt: '再来' }), () => ({ content: '好了' })]) as never });
    media = await db.all('media');
    expect(media.at(-1)!.model).toBe('mock-image');
  }, 20000);
  it('首页输入框键入 @ 弹出菜单，选中后出现胶囊、@ 词被移除；头部胶囊显示“文本：”', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu'], onboarded: true });
    await twoImageModels();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    location.hash = '#agent';
    render(<App />);
    const input = await screen.findByTestId('agent-input', {}, { timeout: 8000 }) as HTMLTextAreaElement;
    expect(screen.getByTestId('model-pill-role').textContent).toBe('文本：');
    fireEvent.change(input, { target: { value: '出图 @高清', selectionStart: 6 } });
    const menu = await screen.findByTestId('at-menu');
    fireEvent.click(within(menu).getAllByTestId('at-opt-image')[0]!);
    expect(screen.getByTestId('at-chip-image').textContent).toContain('高清生图（Mock/Image:v2.0）');
    expect(input.value).toBe('出图 ');
    expect(screen.queryByTestId('at-menu')).toBeNull();
  }, 20000);
});

describe('高级：按任务路由', () => {
  it('setTaskRoute 写入 / 清除；resolveTarget 走 task；@ 覆盖优先于任务', async () => {
    const s = await twoImageModels();
    const hd = s.accounts.find((x) => x.id === 'mock')!.models.find((m) => m.model === 'Mock/Image:v2.0')!;
    const s2 = setTaskRoute(s, 'image', 'cover', hd.id);
    expect(s2.roles.image.tasks?.cover?.model).toBe('Mock/Image:v2.0');
    expect(resolveTarget(s2, 'image', { task: 'cover' })!.via).toBe('task');
    expect(resolveTarget(s2, 'image', {})!.target.model).toBe('mock-image');
    expect(resolveTarget(s2, 'image', { task: 'cover', override: s.roles.image.primary! })!.via).toBe('override');
    expect(setTaskRoute(s2, 'image', 'cover', null).roles.image.tasks).toBeUndefined();
  });
  it('生图工具 purpose=cover 时按任务路由用“封面”模型', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [mimo], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu'], onboarded: true, flags: { 'agent.planner': false } });
    const s = await twoImageModels();
    await saveModelsV3(setTaskRoute(s, 'image', 'cover', s.accounts.find((x) => x.id === 'mock')!.models.find((m) => m.model === 'Mock/Image:v2.0')!.id));
    const c = await createConversation();
    await runTurnV9({ conversationId: c.id, text: '出封面', cfg: mimo, onEvent: () => undefined, call: mockModel([() => tc('image_generate', { prompt: '封面', purpose: 'cover' }), () => ({ content: '好了' })]) as never });
    expect((await db.all('media')).at(-1)!.model).toBe('Mock/Image:v2.0');
  }, 20000);
  it('页面：列出 6 个运行时会读取的任务，下拉里是“跟随默认”与勾了该能力的模型名；选择后保存', async () => {
    await twoImageModels();
    render(<RoutingPage go={() => undefined} />);
    await screen.findByTestId('routing-page');
    expect(ROUTING_TASKS).toHaveLength(6);
    const sel = within(await screen.findByTestId('route-image-cover')).getByRole('combobox') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['跟随默认（默认生图（mock-image））', '默认生图（mock-image） · 模拟', '高清生图（Mock/Image:v2.0） · 模拟']);
    await act(async () => { fireEvent.change(sel, { target: { value: sel.options[2]!.value } }); });
    await waitFor(async () => expect((await getModelsV3()).roles.image.tasks?.cover?.model).toBe('Mock/Image:v2.0'));
  });
});

describe('卡片预览与诊断', () => {
  it('卡片预览：13 类，每类正常 + 失败各一张（共 26 张），失败态都有原因与下一步', async () => {
    const items = galleryItems();
    expect(items.length).toBe(13);
    render(<CardGallery go={() => undefined} />);
    for (const it of items) {
      expect(screen.getByTestId(`gallery-${it.key}-ok`)).toBeTruthy();
      const fail = screen.getByTestId(`gallery-${it.key}-fail`);
      expect((within(fail).queryByRole('alert') ?? within(fail).getByTestId('not-configured')).textContent!.length).toBeGreaterThan(8);
    }
  });
  it('诊断页 Key 存储：网页版显示 WebCrypto 与“不适用”', async () => {
    render(<KeyStorageSection />);
    await waitFor(() => expect(screen.getByTestId('keystore-active').textContent).toBe('webcrypto'));
    expect(screen.getByTestId('keystore-hw').textContent).toMatch(/不适用/);
  });
});

export type { RoleId };
