import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyHttpError, classifyThrown } from '@content-agent/shared';
import { App } from './App';
import { LEGACY, normalize, normalizeV7, parseHash, SETTINGS_MAP, toHash, V5_MAP, V7_MAP } from './route';
import { AGENT_NAV, ME_GROUPS, NAV, SIDEBAR_ITEMS } from './nav';
import { nextStep, type Snapshot } from './state';
import { parseIntent } from './services';
import { CENTERS, detectPlatform, KNOWN_APPS } from './data/platforms';
import { resetLocalDb, db } from './local/db';
import { localApi } from './local/router';
import { chat, checkBaseURL, ModelError, testConnection, type ProviderConfig } from './local/llm';
import { generateDraft } from './local/generate';
import { getModels, upsertProvider, saveModels, EMPTY_MODELS } from './local/store';
import { AddAppFlow } from './components/AddAppSheet';
import { Topics } from './pages/topics';
import { Composer } from './components/Composer';
import { Problem } from './ui';

const mimo: ProviderConfig = { id: 'mimo', label: '小米 MiMo', protocol: 'openai', baseURL: 'https://api.xiaomimimo.com/v1', apiKey: 'sk-test-1234', model: 'mimo-v2.6-flash' };
const okJson = (content: string) => new Response(JSON.stringify({ model: 'mimo-v2.6-flash', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }), { status: 200 });

beforeEach(() => {
  resetLocalDb();
  localStorage.clear();
  location.hash = '';
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/* ---------------- A12 旧路由全部重定向 ---------------- */
describe('A12 / B14 路由重定向', () => {
  // 0.8.0：先按旧规则映射到 0.6.0/0.7.0 位置（normalizeV7，断言保持原样），再经 V7_MAP 到 0.8.0 位置
  const valid = /^(agent(\/(drafts(\/\d+)?|inbox))?(\?(ask|filter)=\w+)?|onboarding|p\/[a-z0-9_-]+|me(\/(models|platforms|sources|profile|agent|prefs|backup|logs|server))?)$/;
  it.each(Object.entries(V5_MAP))('0.5.0 %s → %s', (from, to) => { expect(normalizeV7(from)).toBe(to); expect(toHash(parseHash(from))).toMatch(valid); });
  it.each(Object.entries(SETTINGS_MAP))('#settings/%s → %s', (from, to) => { expect(normalize(`settings/${from}`.replace(/\/$/, ''))).toBe(to); });
  it.each(Object.entries(LEGACY))('0.2.x %s → %s', (from, to) => { expect(normalizeV7(from)).toBe(to); expect(toHash(parseHash(from))).toMatch(valid); });
  it.each(Object.entries(V7_MAP))('0.7.0 #%s → #%s', (from, to) => { expect(normalize(from)).toBe(to); expect(toHash(parseHash(from))).toMatch(valid); });
  it('草稿详情与未知地址', () => {
    expect(toHash(parseHash('#create/drafts/12'))).toBe('agent/drafts/12');
    expect(toHash(parseHash('#create/7'))).toBe('agent/drafts/7');
    expect(toHash(parseHash('#write/12'))).toBe('agent/drafts/12');
    expect(toHash(parseHash('#publish/3'))).toBe('agent/drafts?filter=approved');
    expect(toHash(parseHash('#nonsense'))).toBe('agent');
    expect(toHash(parseHash('#home'))).toBe('agent');
    expect(toHash(parseHash('#topics'))).toBe('agent?ask=hot');
    expect(toHash(parseHash('#agent/files'))).toBe('me/agent');
    expect(parseHash('#me/models/mimo')).toEqual({ space: 'me', sub: 'models', id: 'mimo' });
    expect(parseHash('#p/xiaohongshu')).toEqual({ space: 'p', sub: 'xiaohongshu', id: null });
    expect(toHash(parseHash('#write/pending'))).toBe('agent/drafts?filter=pending');
  });
  it('App 启动时把旧 hash 替换为新地址', async () => {
    location.hash = '#settings/secrets';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    render(<App />);
    await waitFor(() => expect(location.hash).toBe('#me/models'));
  });
});

/* ---------------- A9 导航为 5 个动作项 + 我的 ---------------- */
describe('A9 / B3 导航（0.8.0：首页即 Agent，平台在侧栏）', () => {
  it('侧栏底部固定 Agent / 我的；Agent 入口含草稿、待发布、素材箱等', () => {
    expect(SIDEBAR_ITEMS.map((n) => n.id)).toEqual(['agent', 'me']);
    expect(AGENT_NAV.map((n) => n.label)).toEqual(['Agent', '看热点', '草稿', '待发布', '数据复盘', '素材箱']);
  });
  it('“我的”是分组列表，包含模型、平台与软件、数据源、账号画像、规则、通用、备份、日志、连接服务器、重新开始引导', () => {
    // 0.9.0 改写断言（deviations-v9 T1）：新增 Agent 组（设定 / 记忆 / 技能 / 收益 / 成长记录 / 提醒）与运维项（花钱与实验、运行状态、审计）
    expect(ME_GROUPS.flatMap((g) => g.items.map((i) => i.id))).toEqual(['me/models', 'me/platforms', 'me/sources', 'me/profile', 'me/agent', 'me/files', 'me/memory', 'me/skills', 'me/revenue', 'me/growth', 'me/reminders', 'me/prefs', 'me/settings', 'me/status', 'me/audit', 'me/backup', 'me/storage', 'me/logs', 'me/server', 'onboarding']);
  });
  it('命令面板别名：旧名称都能搜到新位置', () => {
    const find = (q: string) => NAV.filter((n) => `${n.label}${n.desc}${n.keywords ?? ''}`.toLowerCase().includes(q)).map((n) => n.id);
    expect(find('灵感')).toContain('agent?ask=hot'); expect(find('找选题')).toContain('agent?ask=hot'); expect(find('创作')).toContain('agent/drafts');
    expect(find('去发布')).toContain('agent/drafts?filter=approved'); expect(find('复盘')).toContain('agent?ask=metrics'); expect(find('首页')).toContain('agent');
    expect(find('密钥')).toContain('me/models'); expect(find('插件')).toContain('me/platforms'); expect(find('偏好')).toContain('me/prefs');
  });
  it('首页主按钮与卡片文字都是动作', () => {
    const s: Snapshot = { hasModel: false, hotCount: 0, pending: 0, approved: 0, published: 0, drafts: 0 };
    expect(nextStep(s).action).toMatch(/^去/);
  });
});

/* ---------------- A10 下一步卡片 ---------------- */
describe('A10 首页“下一步”随状态变化', () => {
  const base: Snapshot = { hasModel: true, hotCount: 0, pending: 0, approved: 0, published: 0, drafts: 0 };
  it('未连模型 → 去连接', () => expect(nextStep({ ...base, hasModel: false, pending: 3 }).id).toBe('connect'));
  it('有待审 → 去审核（优先于待发布）', () => { const n = nextStep({ ...base, pending: 2, approved: 1 }); expect(n.id).toBe('review'); expect(n.title).toContain('2'); expect(n.to).toBe('write/pending'); });
  it('有待发布 → 去发布', () => expect(nextStep({ ...base, approved: 1 }).to).toBe('publish'));
  it('有新热点 → 挑一条写', () => expect(nextStep({ ...base, hotCount: 3 }).title).toBe('有 3 条新热点，挑一条写吧'));
  it('无选题 → 去找选题', () => { const n = nextStep(base); expect(n.id).toBe('write'); expect(n.title).toBe('还没有选题'); expect(n.to).toBe('topics'); });
});

/* ---------------- 一句话驱动主线 ---------------- */
describe('一句话意图', () => {
  it('找选题 / 写一篇 / 改写', () => {
    expect(parseIntent('帮我找今天的选题', detectPlatform)).toEqual({ kind: 'topics' });
    expect(parseIntent('写一篇小红书：通勤时间怎么利用', detectPlatform)).toEqual({ kind: 'write', idea: '通勤时间怎么利用', platform: 'xiaohongshu' });
    expect(parseIntent('抖音口播：早睡计划', detectPlatform)).toMatchObject({ kind: 'write', platform: 'douyin_script' });
    expect(parseIntent('把这篇改得更口语一点', detectPlatform)).toMatchObject({ kind: 'revise' });
    expect(parseIntent('通勤时间怎么利用', detectPlatform)).toEqual({ kind: 'write', idea: '通勤时间怎么利用', platform: null });
  });
});

/* ---------------- A6 添加软件：无服务端时显示全部平台，三步内完成，刷新后仍在 ---------------- */
describe('A6 添加软件', () => {
  it('静态平台数据：9 个平台（0.7.0 加 B站、快手），带官方包名与 Scheme', () => {
    expect(CENTERS).toHaveLength(9);
    expect(KNOWN_APPS.find((k) => k.platform === 'xiaohongshu')).toMatchObject({ android: 'com.xingin.xhs', ios: 'xhsdiscover://' });
  });
  it('接口全部失败（data=null）时第一步仍有 9 个平台；点平台 → 点添加 → 完成，并写入本机库', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    const saved = vi.fn();
    render(<AddAppFlow data={null} onSaved={saved} onClose={() => {}} />);
    const grid = screen.getByRole('list', { name: '平台' });
    expect(within(grid).getAllByRole('button')).toHaveLength(9);
    fireEvent.click(within(grid).getByRole('button', { name: '小红书' }));
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await screen.findByTestId('addapp-done');
    expect(saved).toHaveBeenCalled();
    const apps = (await localApi('/api/local-apps', 'GET', undefined)) as { apps: { platform: string; package_name: string }[] };
    expect(apps.apps).toEqual([expect.objectContaining({ platform: 'xiaohongshu', package_name: 'com.xingin.xhs' })]);
  });
  it('“刷新”（重新读取本机库）后仍在；同平台同系统重复添加不会重复', async () => {
    await localApi('/api/local-apps', 'PUT', { platform: 'douyin', os: 'android', label: '抖音', package_name: 'com.ss.android.ugc.aweme' });
    await localApi('/api/local-apps', 'PUT', { platform: 'douyin', os: 'android', label: '抖音', package_name: 'com.ss.android.ugc.aweme' });
    const r = (await localApi('/api/local-apps', 'GET', undefined)) as { apps: unknown[]; known: unknown[] };
    expect(r.apps).toHaveLength(1);
    expect(r.known).toHaveLength(9);
  });
});

/* ---------------- 模型直连 ---------------- */
describe('本机模型直连', () => {
  it('MiMo：max_completion_tokens + thinking 关闭 + json_object', async () => {
    const f = vi.fn().mockResolvedValue(okJson('{"title":"t","body":"b"}'));
    vi.stubGlobal('fetch', f);
    await chat(mimo, [{ role: 'user', content: 'hi' }], { maxTokens: 64, json: true });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('https://api.xiaomimimo.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'mimo-v2.6-flash', max_completion_tokens: 64, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(init.headers.authorization).toBe('Bearer sk-test-1234');
  });
  it('测试连接返回用时', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okJson('你好')));
    const r = await testConnection(mimo);
    expect(r.model).toBe('mimo-v2.6-flash');
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });
  it('Anthropic 兼容：/messages + x-api-key', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await chat({ ...mimo, id: 'custom-x', custom: true, protocol: 'anthropic', baseURL: 'https://api.example.com/v1' }, [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]);
    expect(r.content).toBe('ok');
    expect(f.mock.calls[0]![0]).toBe('https://api.example.com/v1/messages');
    expect(f.mock.calls[0]![1].headers['x-api-key']).toBe('sk-test-1234');
  });
});

/* ---------------- A11 失败路径：原因 + 下一步（抽查 12 个） ---------------- */
describe('A11 失败路径都有白话原因与下一步', () => {
  it('1–5 模型 HTTP 错误白话化', () => {
    expect(classifyHttpError(401, 'invalid api key')).toMatchObject({ kind: 'key', reason: 'Key 不对' });
    expect(classifyHttpError(402, '')).toMatchObject({ kind: 'quota', reason: '额度不足' });
    expect(classifyHttpError(429, '')).toMatchObject({ kind: 'rate' });
    expect(classifyHttpError(404, 'not found')).toMatchObject({ kind: 'address', reason: '地址不对' });
    expect(classifyHttpError(404, 'model not exist')).toMatchObject({ kind: 'model' });
    for (const s of [401, 402, 404, 429, 500]) expect(classifyHttpError(s, '').advice.length).toBeGreaterThan(4);
  });
  it('6–7 网络：网页跨域 / 超时', () => {
    expect(classifyThrown(new TypeError('Failed to fetch'), { web: true })).toMatchObject({ kind: 'cors', advice: expect.stringContaining('请用 App 或连接服务端') });
    expect(classifyThrown(new Error('x'), { web: false, timedOut: true })).toMatchObject({ kind: 'timeout', reason: '连接超时' });
  });
  it('8 地址自检：多写 /chat/completions、缺协议、没填', () => {
    expect(checkBaseURL('https://api.x.com/v1/chat/completions')?.reason).toBe('地址多写了一段');
    expect(checkBaseURL('api.x.com')?.reason).toBe('地址不对');
    expect(checkBaseURL('')?.reason).toBe('地址没填');
    expect(checkBaseURL('https://api.xiaomimimo.com/v1')).toBeNull();
  });
  it('9 填错 Key → ModelError(key)，错误信息里不含 Key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"Invalid API Key sk-test-1234"}}', { status: 401 })));
    const e = await testConnection(mimo).catch((x) => x);
    expect(e).toBeInstanceOf(ModelError);
    expect(e.reason).toBe('Key 不对');
    expect(JSON.stringify(e)).not.toContain('sk-test-1234');
  });
  it('10 本机接口：草稿不存在 / 状态不能跳 / 需要服务器的功能 / 备份文件不对 / 正文为空', async () => {
    await expect(localApi('/api/drafts/999', 'GET', undefined)).rejects.toMatchObject({ message: '这篇草稿不存在了', advice: expect.any(String) });
    const d = await db.insert('drafts', { platform: 'xiaohongshu', title: 't', body: 'b', status: 'pending' });
    await expect(localApi(`/api/drafts/${d.id}/handoff/copy`, 'POST', {})).rejects.toMatchObject({ message: '还没审核通过', advice: expect.stringContaining('通过') });
    await expect(localApi('/api/drafts/1/video', 'POST', {})).rejects.toMatchObject({ code: 'needs_server', advice: expect.stringContaining('连接服务器') });
    await expect(localApi('/api/backup/import', 'POST', { foo: 1 })).rejects.toMatchObject({ code: 'import_failed' });
    await expect(localApi(`/api/drafts/${d.id}`, 'PUT', { body: '  ' })).rejects.toMatchObject({ message: '正文不能为空' });
  });
  it('11 没连模型就生成 → “还没有连接模型”+“去检查模型”按钮', async () => {
    const go = vi.fn();
    render(<Composer go={go} />);
    fireEvent.change(screen.getByTestId('ask-input'), { target: { value: '通勤时间怎么利用' } });
    fireEvent.click(screen.getByTestId('ask-send'));
    expect(await screen.findByText('还没有连接模型')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '去检查模型' }));
    expect(go).toHaveBeenCalledWith('me/models');
  });
  it('12 热点全部读不到 → 原因 + “再读一次” + 手动输入入口与示例想法', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    render(<Topics go={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: '刷新热点' }));
    const p = await screen.findByTestId('hot-error', {}, { timeout: 4000 });
    expect(p.textContent).toContain('热点源暂时连不上');
    expect(within(p).getByRole('button', { name: '再读一次' })).toBeTruthy();
    expect(screen.getByTestId('ask-input')).toBeTruthy();
    expect(screen.getByText(/示例：通勤时间怎么利用/)).toBeTruthy();
  });
  it('Problem 组件只有一个主按钮', () => {
    render(<Problem title="出错" advice="建议" action="重试" onAction={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

/* ---------------- A14 本机生成走共用模块 ---------------- */
describe('A14 本机生成（共用提示词 + Schema 修复）', () => {
  it('第一次超长 → 带错误信息修复一次 → 保存为待审草稿', async () => {
    await upsertProvider({ ...mimo, check: { ok: true, at: 'x' } });
    const long = 'x'.repeat(30);
    const f = vi.fn()
      .mockResolvedValueOnce(okJson(JSON.stringify({ title: long, body: '正文' })))
      .mockResolvedValueOnce(okJson(JSON.stringify({ title: '通勤 1 小时的用法', body: '正文', tags: ['通勤'] })));
    vi.stubGlobal('fetch', f);
    const r = await generateDraft('通勤时间怎么利用', 'xiaohongshu');
    expect(r.firstPass).toBe(false);
    expect(r.draft).toMatchObject({ title: '通勤 1 小时的用法', status: 'pending', platform: 'xiaohongshu' });
    const sys = JSON.parse(f.mock.calls[0]![1].body).messages[0].content as string;
    expect(sys.startsWith('【硬边界')).toBe(true);
    expect(sys).toContain('【skill：xiaohongshu-note】');
    expect(sys).toContain('标题不超过 20 字');
    const repair = JSON.parse(f.mock.calls[1]![1].body).messages.at(-1).content as string;
    expect(repair).toContain('[TASK:repair]');
  });
});

/* ---------------- A1 无服务端打开不出错 ---------------- */
describe('A1 无服务端', () => {
  it('首次打开（无模型配置）进入首启引导，不白屏', async () => {
    expect((await getModels()).providers).toEqual([]);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    render(<App />);
    expect(await screen.findByTestId('onboarding', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('超级工作台——一个 Agent 帮你管理各大平台：找热点、写内容、准备发布、记录效果；发布由你本人点击。')).toBeTruthy();
  }, 20000);
  it('已有模型 → 首页即 Agent：“超级工作台”一句话定义、起手式与输入框（B1）', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [{ ...mimo, check: { ok: true, at: 'x' } }], defaultProvider: 'mimo' });
    location.hash = '#home';
    render(<App />);
    expect(await screen.findByTestId('hero-title', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('definition').textContent).toBe('一个 Agent 帮你管理各大平台：找热点、写内容、准备发布、记录效果。发布由你本人点击。');
    expect(screen.getAllByTestId('starter').map((b) => b.textContent)).toEqual(['看看今天各平台热点', '把一个想法写成小红书笔记', '这周数据怎么样']);
    expect(screen.getByTestId('agent-input')).toBeTruthy();
    await waitFor(() => expect(location.hash).toBe('#agent'));
  }, 20000);
  it('导航：侧栏有已登记平台 + 添加 + Agent + 我的，点击跳转', async () => {
    await saveModels({ ...EMPTY_MODELS, providers: [{ ...mimo, check: { ok: true, at: 'x' } }] });
    await db.setKV('prefs', { platforms: ['xiaohongshu', 'douyin'], onboarded: true, backupHinted: false, hotSources: [] });
    location.hash = '#agent';
    render(<App />);
    const nav = await screen.findByRole('navigation', { name: '平台侧栏' });
    await waitFor(() => expect(within(nav).getByTestId('side-xiaohongshu')).toBeTruthy());
    expect(within(nav).getByTestId('side-douyin').textContent).toContain('抖音');
    expect(within(nav).getByTestId('side-add')).toBeTruthy();
    await act(async () => { fireEvent.click(within(nav).getByTestId('side-me')); });
    expect(location.hash).toBe('#me');
    await act(async () => { fireEvent.click(within(nav).getByTestId('side-xiaohongshu')); });
    expect(location.hash).toBe('#p/xiaohongshu');
    expect(await screen.findByTestId('web-fallback')).toBeTruthy();
  });
});
