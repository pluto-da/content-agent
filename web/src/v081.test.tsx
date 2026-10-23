/**
 * 0.8.1 热修 + 深度修复回归测试：
 * - 常驻 / 保活组件在本机数据被写入后不刷新页面也要更新（模型、平台列表、角标、会话、素材箱、总览卡、草稿、绑定开关）
 * - “是否已配置模型”判断全局一致：有 Key 即可用，未测试只提示不拦截
 * - 发送按钮在无模型 / 运行中 / 失败后的状态；错误白话展示
 * - 补齐 0.8.0 验收里 B3 / B6 / B13 缺的测试
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { db, onStoreChange, resetLocalDb } from './local/db';
import { activeProvider, checkState, EMPTY_MODELS, getModels, hasConfiguredModel, isConfigured, resolveProvider, saveModels, setPrefs, upsertProvider, getPrefs } from './local/store';
import type { ProviderConfig } from './local/llm';
import { useStoreChange, useStoreValue } from './local/useStore';
import { addInbox, createConversation, getProfile, listConversations, listMessages } from './agent/store';
import { getVfs, resetVfsForTests } from './v9/vfsBackend';
import { ToolCard, type CardActions } from './agent/cards';
import type { AgentEvent } from './agent/events';
import { runTurnV9 as runTurn } from './v9/engine';
import type { AgentReply } from './agent/model';
import { resetSecureKey } from './local/secure';
import { ModelPicker } from './components/ModelPicker';
import { nextStep } from './state';

const untested: ProviderConfig = { id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-test-0811', model: 'mimo-v2.6-flash' };
const tested: ProviderConfig = { ...untested, check: { ok: true, at: 'x' } };

beforeEach(() => {
  resetLocalDb(); resetSecureKey(); resetVfsForTests();
  localStorage.clear(); sessionStorage.clear();
  location.hash = '';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const onboarded = () => setPrefs({ platforms: ['xiaohongshu', 'douyin'], onboarded: true });
const blockNet = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));

/* ---------------- 根因：Agent 常驻面板只在挂载时读一次模型 ---------------- */
describe('0.8.1 根因回归：在“我的→模型”保存后，首页 Agent 不刷新即可用', () => {
  it('先渲染 Agent 首页（无模型）→ upsertProvider 保存一个服务（有 Key、未测试）→ 首页变为可用，模型胶囊显示该模型并提示“未测试”', async () => {
    await onboarded(); blockNet();
    location.hash = '#agent';
    render(<App />);
    expect(await screen.findByTestId('no-model', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('model-pill').textContent).toContain('未连接模型');
    await act(async () => { await upsertProvider(untested); });
    expect(await screen.findByTestId('hero-title')).toBeTruthy();
    expect(screen.queryByTestId('no-model')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('model-pill-label').textContent).toBe('小米 MiMo · mimo-v2.6-flash'));
    expect(screen.getByTestId('model-untested').textContent).toBe('未测试');
  }, 20000);

  it('saveModels 直接保存（测试通过）同样生效，且不显示“未测试”', async () => {
    await onboarded(); blockNet();
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('no-model', {}, { timeout: 8000 });
    await act(async () => { await saveModels({ ...EMPTY_MODELS, providers: [tested], defaultProvider: 'mimo' }); });
    await waitFor(() => expect(screen.getByTestId('model-pill-label').textContent).toBe('小米 MiMo · mimo-v2.6-flash'));
    expect(screen.queryByTestId('model-untested')).toBeNull();
  }, 20000);

  it('去连接 → 保存 → 返回：从 #me/models 保存后回到 #agent，首页已可用', async () => {
    await onboarded(); blockNet();
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('no-model', {}, { timeout: 8000 });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '去连接' })); });
    await waitFor(() => expect(location.hash).toBe('#me/models'));
    await act(async () => { await upsertProvider({ ...untested, check: { ok: false, at: 'x', reason: '超时' } }); });
    await act(async () => { location.hash = '#agent'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByTestId('hero-title', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('model-untested').textContent).toBe('测试未通过');
  }, 20000);

  it('删除最后一个服务后，首页回到“未连接”', async () => {
    await onboarded(); blockNet();
    await saveModels({ ...EMPTY_MODELS, providers: [tested], defaultProvider: 'mimo' });
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('hero-title', {}, { timeout: 8000 });
    await act(async () => { await saveModels({ ...EMPTY_MODELS }); });
    expect(await screen.findByTestId('no-model')).toBeTruthy();
  }, 20000);
});

/* ---------------- 统一的“是否已配置”判断 ---------------- */
describe('0.8.1 已配置判断全局一致（有 Key 即可用）', () => {
  it('isConfigured / checkState / hasConfiguredModel', () => {
    expect(isConfigured(untested)).toBe(true);
    expect(isConfigured({ ...untested, apiKey: '  ' })).toBe(false);
    expect(isConfigured({ id: 'ollama', label: 'Ollama', protocol: 'openai', baseURL: 'http://192.168.1.2:11434/v1', apiKey: '', model: 'qwen' })).toBe(true);
    expect(checkState(untested)).toBe('untested');
    expect(checkState(tested)).toBe('ok');
    expect(checkState({ ...untested, check: { ok: false, at: 'x' } })).toBe('failed');
    expect(hasConfiguredModel({ providers: [{ ...untested, apiKey: '' }] })).toBe(false);
    expect(hasConfiguredModel(null)).toBe(false);
  });
  it('resolveProvider：默认服务没填 Key 时跳过；优先已连通；指定的模型名只用于它所属的服务', () => {
    const empty: ProviderConfig = { ...untested, id: 'deepseek', label: 'DeepSeek', apiKey: '', model: 'deepseek-chat' };
    const m = { ...EMPTY_MODELS, providers: [empty, untested], defaultProvider: 'deepseek' };
    expect(resolveProvider(m)?.id).toBe('mimo');
    const m2 = { ...m, providers: [untested, { ...tested, id: 'qwen', label: '通义', model: 'qwen-plus' }] };
    expect(resolveProvider(m2)?.id).toBe('qwen');
    expect(resolveProvider(m2, { providerId: 'mimo', model: 'mimo-v2.6-pro' })?.model).toBe('mimo-v2.6-pro');
    expect(resolveProvider(m2, { providerId: 'deepseek', model: 'deepseek-chat' })?.model).toBe('qwen-plus');
    expect(resolveProvider({ ...EMPTY_MODELS, providers: [empty] })).toBeNull();
  });
  it('写作生成（activeProvider）也接受未测试的服务——不再一边能发一边说“没有连接模型”', async () => {
    await upsertProvider(untested);
    expect((await activeProvider())?.id).toBe('mimo');
  });
  it('首页“下一步”：有 Key 就不再提示去连接', async () => {
    await upsertProvider(untested);
    const hasModel = hasConfiguredModel(await getModels());
    expect(nextStep({ hasModel, hotCount: 0, pending: 0, approved: 0, published: 0, drafts: 0 }).id).not.toBe('connect');
  });
  it('ModelPicker（写作页 / 助手设置）列出未测试的服务并标注，保存后不刷新即出现', async () => {
    render(<ModelPicker value={{ providerId: null, model: null }} onChange={() => {}} go={() => {}} />);
    expect(await screen.findByRole('button', { name: '先连接一个模型' })).toBeTruthy();
    await act(async () => { await upsertProvider(untested); });
    const sel = await screen.findByRole('combobox', { name: '用哪个模型服务' });
    expect(sel.textContent).toContain('小米 MiMo（未测试）');
  });
});

/* ---------------- 订阅机制 ---------------- */
describe('0.8.1 统一订阅机制（useStoreValue / useStoreChange）', () => {
  it('db 每次写入都派发对应的变更键', async () => {
    const seen: string[] = [];
    const off = onStoreChange((k) => seen.push(k));
    const d = await db.insert('drafts', { title: 'a' });
    await db.update('drafts', d.id, { title: 'b' });
    await db.del('drafts', d.id);
    await db.setKV('prefs', {});
    await db.clear('inbox');
    off();
    expect(seen).toEqual(['drafts', 'drafts', 'drafts', 'kv:prefs', 'inbox']);
  });
  it('同一轮的多次写入合并成一次回调；无关键不触发', async () => {
    const cb = vi.fn();
    function Probe() { useStoreChange(['drafts'], cb); return null; }
    render(<Probe />);
    await act(async () => { await Promise.all([db.insert('drafts', { a: 1 }), db.insert('drafts', { a: 2 }), db.insert('drafts', { a: 3 })]); });
    await act(async () => { await db.insert('inbox', { a: 1 }); });
    expect(cb.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(cb.mock.calls.length).toBeLessThan(3);
  });
  it('读失败给白话错误，不静默', async () => {
    function Probe() { const { error } = useStoreValue(() => Promise.reject(new Error('磁盘已满')), ['drafts']); return <p data-testid="err">{error}</p>; }
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('读取本机数据失败：磁盘已满'));
  });
});

/* ---------------- 常驻组件同类问题 ---------------- */
describe('0.8.1 常驻组件同类问题（侧栏、角标、会话、素材箱、总览卡、绑定）', () => {
  async function home() {
    await saveModels({ ...EMPTY_MODELS, providers: [tested], defaultProvider: 'mimo' });
    await onboarded(); blockNet();
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('hero-title', {}, { timeout: 8000 });
    return screen.findByRole('navigation', { name: '平台侧栏' });
  }
  it('侧栏平台列表：在“我的→平台”里改了（setPrefs）立刻反映，不用刷新', async () => {
    const nav = await home();
    await waitFor(() => expect(within(nav).getByTestId('side-douyin')).toBeTruthy());
    await act(async () => { await setPrefs({ platforms: ['xiaohongshu', 'douyin', 'zhihu'] }); });
    await waitFor(() => expect(within(nav).getByTestId('side-zhihu')).toBeTruthy());
    await act(async () => { await setPrefs({ platforms: ['xiaohongshu'] }); });
    await waitFor(() => expect(within(nav).queryByTestId('side-douyin')).toBeNull());
  }, 20000);
  it('角标：写作页 / 草稿卡直接改库（不走事件总线）后数字角标立即出现', async () => {
    const nav = await home();
    await waitFor(() => expect(within(nav).getByTestId('side-xiaohongshu')).toBeTruthy());
    expect(within(nav).queryByTestId('badge-xiaohongshu')).toBeNull();
    await act(async () => { await db.insert('drafts', { platform: 'xiaohongshu', title: '通勤', body: '正文', status: 'approved', tags: [] }); });
    await waitFor(() => expect(within(nav).getByTestId('badge-xiaohongshu').textContent).toBe('1'));
    expect(within(nav).getByTestId('badge-xiaohongshu').className).toContain('anim-pop');
  }, 20000);
  it('总览卡：草稿通过后“待发布”数字更新', async () => {
    await home();
    await waitFor(() => expect(screen.getByTestId('overview').textContent).toContain('待发布 0'));
    await act(async () => { await db.insert('drafts', { platform: 'douyin_script', title: '口播', body: 'x', status: 'approved', tags: [] }); });
    await waitFor(() => expect(screen.getByTestId('overview').textContent).toContain('待发布 1'));
  }, 20000);
  it('会话列表：在别处新建的会话（分享 / 绑定）立刻出现在“会话列表”里', async () => {
    await home();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: '会话列表' })[0]!); });
    await screen.findByText('还没有会话');
    await act(async () => { await createConversation('外部新建的会话'); });
    expect(await screen.findByText('外部新建的会话')).toBeTruthy();
  }, 20000);
  it('素材箱 Tab：直接写库的素材立即显示', async () => {
    await home();
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '素材' })); });
    await screen.findByTestId('inbox-tab');
    await act(async () => { await db.insert('inbox', { kind: 'text', text: '直接写库的素材', channel: 'paste', used: false }); });
    expect(await screen.findByText('直接写库的素材')).toBeTruthy();
  }, 20000);
  it('B13 平台↔会话绑定：在“我的”里打开开关后（不刷新），打开平台即切到该平台的会话', async () => {
    await home();
    await act(async () => { await setPrefs({ bindSessions: true }); });
    await act(async () => { location.hash = '#p/xiaohongshu'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(async () => expect((await listConversations()).map((c) => c.title)).toContain('小红书 会话'));
    await waitFor(async () => expect((await getPrefs()).sessionBindings?.xiaohongshu).toBeTruthy());
  }, 20000);
  it('首启引导完成后进入首页：状态已是“可用”（不需要再刷新）', async () => {
    blockNet();
    render(<App />);
    expect(await screen.findByTestId('onboarding', {}, { timeout: 8000 })).toBeTruthy();
    await act(async () => { await upsertProvider(tested); await setPrefs({ onboarded: true, platforms: ['xiaohongshu'] }); location.hash = '#agent'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    expect(await screen.findByTestId('hero-title', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('no-model')).toBeNull();
  }, 20000);
});

/* ---------------- 发送按钮状态与错误白话 ---------------- */
describe('0.8.1 发送按钮：无模型 / 运行中 / 失败后', () => {
  it('无模型：点发送给出白话提示，不新建会话', async () => {
    await onboarded(); blockNet();
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('no-model', {}, { timeout: 8000 });
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: '你好' } });
    await act(async () => { fireEvent.click(screen.getByTestId('send')); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('先连接一个模型，Agent 才能工作'));
    expect(await listConversations()).toEqual([]);
  }, 20000);
  it('未测试的服务可以发送；网络失败后“停止”复位为“发送”，失败原因白话显示在对话里并提示去测试', async () => {
    await onboarded(); blockNet();
    await upsertProvider(untested);
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('hero-title', {}, { timeout: 8000 });
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: '看看热点' } });
    await act(async () => { fireEvent.click(screen.getByTestId('send')); });
    await waitFor(() => expect(screen.getByTestId('send')).toBeTruthy(), { timeout: 8000 });
    expect(screen.queryByTestId('stop')).toBeNull();
    const err = await screen.findAllByTestId('msg-agent');
    const text = err.map((e) => e.textContent).join(' ');
    expect(text).not.toMatch(/TypeError|undefined|\[object/);
    expect(text.length).toBeGreaterThan(4);
    expect(await screen.findByText(/还没测试通过/)).toBeTruthy();
  }, 20000);
  it('运行中：发送按钮变为“停止”，不能重复发送', async () => {
    await onboarded(); blockNet();
    await upsertProvider(tested);
    let release: () => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise((_r, rej) => { release = () => rej(new TypeError('blocked')); })));
    location.hash = '#agent';
    render(<App />);
    await screen.findByTestId('hero-title', {}, { timeout: 8000 });
    fireEvent.change(screen.getByTestId('agent-input'), { target: { value: '第一句' } });
    await act(async () => { fireEvent.click(screen.getByTestId('send')); });
    expect(await screen.findByTestId('stop')).toBeTruthy();
    expect(screen.queryByTestId('send')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('stop')); release(); });
    await waitFor(() => expect(screen.getByTestId('send')).toBeTruthy(), { timeout: 8000 });
  }, 20000);
});

/* ---------------- B3 侧栏补测 ---------------- */
describe('B3 侧栏补测：排序保持、角标两种形态', () => {
  it('排序写入 platformOrder 后立即生效，重新打开（刷新）仍保持', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [tested], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu', 'douyin', 'zhihu'], onboarded: true }); blockNet();
    location.hash = '#agent';
    const order = (nav: HTMLElement) => within(nav).queryAllByTestId(/^side-(xiaohongshu|douyin|zhihu)$/).map((e) => e.getAttribute('data-testid'));
    const r = render(<App />);
    let nav = await screen.findByRole('navigation', { name: '平台侧栏' });
    await waitFor(() => expect(order(nav)).toEqual(['side-xiaohongshu', 'side-douyin', 'side-zhihu']));
    await act(async () => { await setPrefs({ platformOrder: ['zhihu', 'xiaohongshu', 'douyin'] }); });
    await waitFor(() => expect(order(nav)).toEqual(['side-zhihu', 'side-xiaohongshu', 'side-douyin']));
    r.unmount();
    render(<App />);
    nav = await screen.findByRole('navigation', { name: '平台侧栏' });
    await waitFor(() => expect(order(nav)).toEqual(['side-zhihu', 'side-xiaohongshu', 'side-douyin']));
  }, 20000);
  it('角标两种形态：数字（待发布草稿）与圆点（未处理素材）；关闭角标后都不显示', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [tested], defaultProvider: 'mimo' });
    await setPrefs({ platforms: ['xiaohongshu', 'douyin'], onboarded: true }); blockNet();
    await db.insert('drafts', { platform: 'xiaohongshu', title: 't', body: 'b', status: 'approved', tags: [] });
    await addInbox({ kind: 'share', channel: 'share', platform: 'douyin', text: 'x' });
    location.hash = '#agent';
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: '平台侧栏' });
    await waitFor(() => expect(within(nav).getByTestId('badge-xiaohongshu').textContent).toBe('1'));
    expect(within(nav).getByTestId('dot-douyin').getAttribute('aria-label')).toBe('有新热点或素材');
    expect(within(nav).queryByTestId('badge-douyin')).toBeNull();
    await act(async () => { await setPrefs({ badgeOff: ['xiaohongshu', 'douyin'] }); });
    await waitFor(() => expect(within(nav).queryByTestId('badge-xiaohongshu')).toBeNull());
    expect(within(nav).queryByTestId('dot-douyin')).toBeNull();
  }, 20000);
});

/* ---------------- B6 工具卡片补测（逐张渲染 + 失败态 + 详情展开） ---------------- */
describe('B6 工具卡片补测', () => {
  const actions = (): CardActions & { ask: ReturnType<typeof vi.fn>; userTool: ReturnType<typeof vi.fn> } => ({ ask: vi.fn(), userTool: vi.fn().mockResolvedValue(null), openDraft: vi.fn() }) as never;
  it('检查卡：阻断时只给“按建议修改”，不出“去发布”；通过时给“去发布”', () => {
    const a = actions();
    const checks = [{ id: 'title', label: '标题长度', pass: false, detail: '24/20', fix: '缩短到 20 字', blocking: true }, { id: 'tags', label: '话题', pass: true, detail: '2 个', blocking: false }];
    const { rerender } = render(<ToolCard card={{ type: 'check', tool: 'publish_check', status: 'done', data: { draftId: 7, blocking: true, checks } }} actions={a} />);
    expect(screen.getByTestId('check-title').getAttribute('data-pass')).toBe('false');
    expect(screen.queryByTestId('go-publish')).toBeNull();
    fireEvent.click(screen.getByTestId('fix-by-advice'));
    expect(a.ask).toHaveBeenCalledWith(expect.stringContaining('缩短到 20 字'));
    rerender(<ToolCard card={{ type: 'check', tool: 'publish_check', status: 'done', data: { draftId: 7, blocking: false, checks: [checks[1]] } }} actions={a} />);
    fireEvent.click(screen.getByTestId('go-publish'));
    expect(a.ask).toHaveBeenLastCalledWith('准备发布草稿 #7');
  });
  it('发布卡：“我已发布”只由用户点击触发 publish_mark；“还没发”保留草稿', async () => {
    const a = actions();
    const card = { type: 'publish', tool: 'publish_prepare', status: 'done' as const, data: { draftId: 3, platform: 'xiaohongshu', label: '小红书', copied: true, steps: ['在发布框里长按粘贴', '由你本人点击发布'] } };
    const { unmount } = render(<ToolCard card={card} actions={a} />);
    expect(screen.getByText(/文案已复制/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('published')); });
    expect(a.userTool).toHaveBeenCalledWith('publish_mark', { draftId: 3, platform: 'xiaohongshu' });
    expect(screen.getByText(/已记为“已发布”/)).toBeTruthy();
    unmount();
    render(<ToolCard card={card} actions={a} />);
    fireEvent.click(screen.getByRole('button', { name: '还没发' }));
    expect(screen.getByText(/草稿保留在“待发布”/)).toBeTruthy();
  });
  it('数据卡：汇总、趋势图、最好的一篇与建议', () => {
    render(<ToolCard card={{ type: 'metrics', tool: 'metrics_summary', status: 'done', data: { totals: { posts: 2, views: 1200, likes: 80, collects: 10, comments: 5 }, series: [{ v: 100 }, { v: 1100 }], best: [{ title: '通勤', views: 1100 }], tips: ['多写通勤话题'] } }} actions={actions()} />);
    expect(screen.getByText(/2 篇 · 阅读 1200/)).toBeTruthy();
    expect(screen.getByRole('img', { name: '阅读趋势' })).toBeTruthy();
    expect(screen.getByText('多写通勤话题')).toBeTruthy();
  });
  it('画像更新卡：先展示差异，采纳后才写入画像', async () => {
    render(<ToolCard card={{ type: 'profile', tool: 'profile_update', status: 'done', data: { reason: '最近常写通勤', diff: [{ field: 'positioning', before: '', after: '通勤效率' }], next: { positioning: '通勤效率' } } }} actions={actions()} />);
    expect(screen.getByText(/理由：最近常写通勤/)).toBeTruthy();
    expect((await getProfile()).positioning).toBe('');
    await act(async () => { fireEvent.click(screen.getByTestId('profile-adopt')); });
    await waitFor(async () => expect((await getProfile()).positioning).toBe('通勤效率'));   // 1.1.0：写入 user/profile.md（与 USER 同源）
    expect(await (await getVfs()).text('user/profile.md')).toContain('通勤效率');
    expect(screen.getByText('已采纳，写入画像')).toBeTruthy();
  });
  it('进度卡：列出已完成 / 失败的步骤，未完成时可“继续”；没有任务时给白话', () => {
    const a = actions();
    const { rerender } = render(<ToolCard card={{ type: 'progress', tool: 'task_resume', status: 'done', data: { goal: '写一篇小红书', status: 'running', steps: [{ name: '看热点', status: 'done', summary: '' }, { name: '写草稿', status: 'error', summary: '模型超时' }] } }} actions={a} />);
    expect(screen.getByText('写草稿：模型超时')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '继续' }));
    expect(a.ask).toHaveBeenCalledWith('接着上次继续');
    rerender(<ToolCard card={{ type: 'progress', tool: 'task_resume', status: 'done', data: { none: true } }} actions={a} />);
    expect(screen.getByText('没有未完成的任务。')).toBeTruthy();
  });
  it('失败态：原因 + 建议 + 重试 + 手动补充（白话，不显示异常对象）', () => {
    const a = { ...actions(), retry: vi.fn() };
    render(<ToolCard card={{ type: 'tool', tool: 'draft_write', status: 'error', error: { reason: '模型服务暂时没有响应', advice: '稍后重试或换一个模型' } }} actions={a} />);
    expect(screen.getByRole('alert').textContent).toContain('模型服务暂时没有响应');
    expect(screen.getByRole('alert').textContent).toContain('稍后重试或换一个模型');
    fireEvent.click(screen.getByTestId('card-retry'));
    expect(a.retry).toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('manual-input'), { target: { value: '更口语' } });
    fireEvent.click(screen.getByRole('button', { name: '手动补充' }));
    expect(a.ask).toHaveBeenCalledWith('更口语');
  });
  it('详情展开 / 收起：高度过渡容器切换 data-open，收起时对读屏隐藏', () => {
    const { container } = render(<ToolCard card={{ type: 'note', tool: 'skill_route', status: 'done', data: { text: '用小红书助手' } }} actions={actions()} />);
    const box = container.querySelector('.card-details')!;
    expect(box.getAttribute('data-open')).toBe('false');
    expect(box.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(box.getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('card-debug')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(box.getAttribute('data-open')).toBe('false');
  });
});

/* ---------------- B13 会话补测 ---------------- */
describe('B13 会话补测：切模型后标注、草稿卡头部显示写作助手', () => {
  it('会话内切换模型后，之后的回复标注新模型', async () => {
    const c = await createConversation();
    const call = vi.fn(async () => ({ content: '好的', toolCalls: [], usage: { input: 1, output: 1 }, ms: 1, model: 'mock-model', streamed: true, chunks: 1 }) as AgentReply);
    const ev: AgentEvent[] = [];
    await runTurn({ conversationId: c.id, text: '第一句', cfg: tested, call, onEvent: (e) => ev.push(e) });
    await runTurn({ conversationId: c.id, text: '第二句', cfg: { ...tested, id: 'qwen', label: '通义千问', model: 'qwen-plus' }, call, onEvent: (e) => ev.push(e) });
    const replies = (await listMessages(c.id)).filter((m) => m.role === 'assistant');
    expect(replies.map((m) => m.model)).toEqual(['小米 MiMo · mock-model', '通义千问 · mock-model']);
  });
  it('草稿卡头部显示所用写作助手（技能路由结果）', () => {
    render(<ToolCard card={{ type: 'draft', tool: 'draft_write', status: 'done', data: { id: 1, title: '通勤 40 分钟', body: '正文', status: 'pending', platformLabel: '小红书', assistant: '小红书助手', assistantNote: '用户自定义优先' } }} actions={{ ask: vi.fn(), userTool: vi.fn() } as never} />);
    expect(screen.getByTestId('draft-assistant').textContent).toBe('使用：小红书助手 · 用户自定义优先');
  });
  it('草稿卡“通过”直接改库后，草稿列表 / 角标订阅者收到变更（不依赖事件总线）', async () => {
    const d = await db.insert('drafts', { platform: 'xiaohongshu', title: 't', body: 'b', status: 'pending', tags: [] });
    const seen: string[] = [];
    const off = onStoreChange((k) => seen.push(k));
    render(<ToolCard card={{ type: 'draft', tool: 'draft_write', status: 'done', data: { id: d.id, title: 't', body: 'b', status: 'pending', platformLabel: '小红书' } }} actions={{ ask: vi.fn(), userTool: vi.fn() } as never} />);
    await act(async () => { fireEvent.click(screen.getByTestId('draft-approve')); });
    off();
    expect(seen).toContain('drafts');
    expect((await db.get('drafts', d.id))!.status).toBe('approved');
  });
});
