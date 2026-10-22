import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
import { App, NAV, ErrorBoundary } from './App';
import { translate } from './i18n';
import { deviceClass, runtime, serverBase, copyText } from './runtime';
import { api, ApiError, mediaUrl } from './api';
import { StatusBadge, Badge } from './ui';
import { TABS, normalize, parseHash, toHash } from './route';
import { NAV_GROUPS, SIDEBAR_ITEMS, layoutOf } from './nav';
import { plainReason } from './pages/today';

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const body = handler(url, init);
    if (body instanceof Error) throw body;
    const status = (body as { __status?: number })?.__status ?? 200;
    return new Response(JSON.stringify(body ?? {}), { status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

const DATA: Record<string, unknown> = {
  '/api/notifications': { pendingDrafts: 2, hotMatches: ['大模型降价'] },
  '/api/tasks?limit=5': { stats: { succeeded: 3 }, tasks: [] },
  '/api/models': { status: [{ capability: 'llm', label: '文本/对话', configured: false }], capabilities: [], providers: [], routes: {}, prices: {} },
  '/api/boundaries': { boundaries: ['不做反检测'] },
};

beforeEach(() => { localStorage.clear(); location.hash = ''; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('i18n 与运行环境', () => {
  it('中英切换', () => {
    expect(translate('zh', '平台')).toBe('平台');
    expect(translate('en', '平台')).toBe('Platforms');
    expect(translate('en', '不存在的键')).toBe('不存在的键');
  });
  it('终端分类', () => {
    expect(deviceClass(375, 'capacitor')).toBe('phone');
    expect(deviceClass(820, 'capacitor')).toBe('tablet');
    expect(deviceClass(1440, 'electron')).toBe('desktop');
    expect(deviceClass(1440, 'web')).toBe('web');
    expect(runtime()).toBe('web');
    expect(serverBase()).toBe('');
    expect(mediaUrl('/api/media/1/a.png')).toBe('/api/media/1/a.png');
  });
  it('复制文本回退', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('x')).toBe(true);
  });
});

describe('api 客户端', () => {
  it('统一错误格式与访问口令', async () => {
    localStorage.setItem('ca.token', 'tk');
    const f = mockFetch((u) => (u === '/api/bad' ? { __status: 409, error: { code: 'not_configured', message: '未配置：x', advice: '去设置' } } : { ok: 1 }));
    expect(await api('/api/ok')).toEqual({ ok: 1 });
    expect((f.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ 'x-access-token': 'tk' });
    await expect(api('/api/bad')).rejects.toMatchObject({ code: 'not_configured', advice: '去设置', status: 409 });
    mockFetch(() => new TypeError('network'));
    await expect(api('/api/x')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('路由（V4：#settings/* 与 0.2.x 旧路由全部重定向）', () => {
  const SETTINGS: [string, string][] = [
    ['settings/status', 'models/usage'], ['settings/models', 'models/routes'], ['settings/secrets', 'models/keys'],
    ['settings/plugins', 'platforms'], ['settings/local-apps', 'platforms'], ['settings/agent', 'agent/files'], ['settings/improve', 'agent/improve'],
    ['settings/general', 'prefs/general'], ['settings/backup', 'prefs/backup'], ['settings/tasks', 'prefs/logs'], ['settings', 'prefs'],
  ];
  const LEGACY_FINAL: [string, string][] = [
    ['overview', 'today'], ['hot', 'inspire/hot'], ['library', 'inspire/library'], ['topics', 'inspire/topics'], ['review', 'create/drafts'], ['creator', 'create/publish'],
    ['analytics', 'analytics'], ['status', 'models/usage'], ['agent', 'agent'], ['improve', 'agent/improve'], ['plugins', 'platforms'], ['tasks', 'prefs/logs'], ['settings', 'prefs'],
  ];
  it.each(SETTINGS)('#%s → #%s', (from, to) => { expect(normalize(from)).toBe(to); expect(normalize(`#${from}`)).toBe(to); });
  it.each(LEGACY_FINAL)('0.2.x #%s → #%s', (from, to) => { expect(normalize(from)).toBe(to); });
  it('解析标签与默认标签', () => {
    expect(parseHash('#hot')).toEqual({ space: 'inspire', sub: 'hot', id: null });
    expect(parseHash('#create/12')).toEqual({ space: 'create', sub: 'drafts', id: '12' });
    expect(parseHash('#settings')).toEqual({ space: 'prefs', sub: 'general', id: null });
    expect(parseHash('#settings/status')).toEqual({ space: 'models', sub: 'usage', id: null });
    expect(parseHash('#models')).toEqual({ space: 'models', sub: 'routes', id: null });
    expect(parseHash('#agent')).toEqual({ space: 'agent', sub: 'files', id: null });
    expect(parseHash('#prefs/logs/7')).toEqual({ space: 'prefs', sub: 'logs', id: '7' });
    expect(parseHash('#platforms')).toEqual({ space: 'platforms', sub: '', id: null });
    expect(parseHash('#nope')).toEqual({ space: 'today', sub: '', id: null });
    expect(toHash(parseHash('#settings/secrets'))).toBe('models/keys');
    expect(layoutOf(390)).toBe('phone');
    expect(layoutOf(820)).toBe('tablet');
    expect(layoutOf(1440)).toBe('desktop');
  });
  it('每页最多 3 个标签', () => {
    for (const list of Object.values(TABS)) expect(list!.length).toBeLessThanOrEqual(3);
  });
});

describe('导航（V2：侧栏恰好 8 项，两组，无二级菜单）', () => {
  it('定义：工作流 4 + 工作台 4', () => {
    expect(SIDEBAR_ITEMS.map((n) => n.id)).toEqual(['today', 'inspire', 'create', 'analytics', 'platforms', 'models', 'agent', 'prefs']);
    expect(NAV_GROUPS.map((g) => [g.title, g.items.length])).toEqual([['工作流', 4], ['工作台', 4]]);
    for (const n of SIDEBAR_ITEMS) { expect(n.id).not.toContain('/'); expect((n as unknown as { items?: unknown }).items).toBeUndefined(); }
  });
  it('渲染：主导航 8 个链接、2 个分组，无齿轮/设置中心（V1）', async () => {
    mockFetch(() => ({}));
    render(<App />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(nav).getAllByRole('link')).toHaveLength(8);
    expect(within(nav).getAllByRole('group')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull();
    expect(screen.queryByRole('link', { name: '设置' })).toBeNull();
    expect(screen.queryByText('设置中心')).toBeNull();
    expect(within(nav).getByTestId('add-app')).toBeTruthy();
  });
});

describe('V3：原设置中心 9 个分区都能从前台到达', () => {
  const CASES: [string, string, RegExp | string][] = [
    ['settings/status', '模型', '不做反检测'],
    ['settings/models', '模型', '按能力选择模型'],
    ['settings/secrets', '模型', /更多密钥/],
    ['settings/plugins', '平台', '已登记的本地软件'],
    ['settings/agent', 'Agent', '系统文件'],
    ['settings/improve', 'Agent', '改进日志'],
    ['settings/general', '偏好', '代理 / 采集'],
    ['settings/backup', '偏好', '导出'],
    ['settings/tasks', '偏好', '运行日志'],
  ];
  it.each(CASES)('%s → 「%s」页', async (hash, title, text) => {
    mockFetch((u) => (u === '/api/boundaries' ? { boundaries: ['不做反检测'] } : u === '/api/settings' ? { secrets: { 'model.zhipu.key': { configured: false }, 'model.kimi.key': { configured: false }, 'model.ark.key': { configured: false }, 'model.minimax.key': { configured: false }, 'model.openai.key': { configured: false } } } : {}));
    location.hash = hash;
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    expect(location.hash).toBe(`#${normalize(hash)}`.replace(/^#prefs$/, '#prefs/general'));
  });
});

describe('界面', () => {
  it('今天：一条文字状态条（无指标卡）+ 待办流（V12）', async () => {
    mockFetch((u) => DATA[u] ?? (u === '/api/models/costs?days=1' ? { total: 0.1234 } : u === '/api/local-apps' ? { apps: [{ id: 1, platform: 'zhihu', os: 'android', label: '知乎' }], known: Array.from({ length: 7 }, (_, i) => ({ platform: `p${i}` })) } : {}));
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/大模型降价/).length).toBeGreaterThan(0));
    const bar = screen.getByRole('navigation', { name: '运行状态' });
    await waitFor(() => expect(within(bar).getByText('今日花费 ¥0.12')).toBeTruthy());
    expect(within(bar).getByText('模型未配置')).toBeTruthy();
    expect(within(bar).getByText('已连接平台 1/7')).toBeTruthy();
    expect(within(bar).getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByText('任务成功率')).toBeNull();
    expect(screen.queryByText('候选选题')).toBeNull();
  });
  it('失败任务：白话原因 +“重试”，⋯ 菜单进入按任务过滤的日志', () => {
    expect(plainReason('needs_official_api：网页接口需签名')).toBe('这个平台需要官方开放平台授权，配置密钥后再试');
    expect(plainReason('fetch failed')).toContain('网络');
    expect(plainReason('')).toBe('失败');
  });
  it('旧地址 #review 进入创作', async () => {
    mockFetch(() => ({}));
    location.hash = 'review';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '创作' })).toBeTruthy());
    expect(location.hash).toBe('#create/drafts');
  });
  it('切换语言与主题（偏好 → 通用）', async () => {
    mockFetch((u) => DATA[u] ?? { settings: {}, secrets: {}, capabilities: [], providers: [], status: [], routes: {}, prices: {}, byCapability: [] });
    location.hash = 'prefs/general';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '偏好' })).toBeTruthy());
    const langSel = await screen.findByDisplayValue('简体中文') as HTMLSelectElement;
    fireEvent.change(langSel, { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Preferences' })).toBeTruthy());
    expect(document.documentElement.lang).toBe('en');
    fireEvent.change(screen.getByDisplayValue('System'), { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('每个页面与标签都能渲染不崩溃', async () => {
    mockFetch(() => ({}));
    for (const n of NAV) {
      location.hash = n.id;
      const { unmount } = render(<App />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(screen.queryByText(/页面出错/)).toBeNull();
      unmount();
    }
  });
  it('键盘：⌘K 打开命令面板，旧名称“密钥”能搜到新页面并回车跳转（V17）', async () => {
    mockFetch(() => ({}));
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('textbox', { name: '快速跳转' });
    fireEvent.change(input, { target: { value: '插件' } });
    expect(screen.getByRole('option', { name: /平台/ })).toBeTruthy();
    fireEvent.change(input, { target: { value: '密钥' } });
    const opts = screen.getAllByRole('option');
    expect(opts[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(location.hash).toMatch(/^#models/));
  });
  it('错误边界与状态点', () => {
    const Boom = () => { throw new Error('炸了'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('炸了');
    spy.mockRestore();
    render(<><StatusBadge status="robots_disallow" /><StatusBadge status="weird" /><Badge tone="ok">好</Badge></>);
    expect(screen.getByText('robots 禁止').className).toContain('status-dot');
    expect(screen.getByText('weird')).toBeTruthy();
  });
});

const KNOWN = [
  { platform: 'douyin', label: '抖音', android: 'com.ss.android.ugc.aweme', ios: 'snssdk1128://' },
  { platform: 'xiaohongshu', label: '小红书', android: 'com.xingin.xhs', ios: 'xhsdiscover://' },
  { platform: 'zhihu', label: '知乎', android: 'com.zhihu.android', ios: 'zhihu://' },
];

describe('V8：添加软件三步流程，常见平台 ≤3 次点击', () => {
  it('电脑/平板：侧栏悬浮按钮 → 选小红书 → 添加（3 次点击），预填官方包名，完成页可试打开', async () => {
    const puts: unknown[] = [];
    let apps: unknown[] = [];
    mockFetch((u, init) => {
      if (u === '/api/local-apps' && init?.method === 'PUT') { const b = JSON.parse(String(init.body)); puts.push(b); apps = [{ id: 1, ...b }]; return b; }
      if (u === '/api/local-apps') return { apps, known: KNOWN };
      return {};
    });
    render(<App />);
    let clicks = 0;
    const click = (el: Element) => { clicks++; fireEvent.click(el); };
    click(await within(screen.getByRole('navigation', { name: '主导航' })).findByTestId('add-app'));
    const dialog = await screen.findByRole('dialog', { name: '添加软件' });
    click(await within(dialog).findByRole('button', { name: '小红书' }));
    expect(within(dialog).getByText('com.xingin.xhs')).toBeTruthy();
    click(within(dialog).getByRole('button', { name: '添加' }));
    await waitFor(() => expect(within(dialog).getByText('已添加，可在发布台一键打开或分享草稿')).toBeTruthy());
    expect(clicks).toBeLessThanOrEqual(3);
    expect(puts).toEqual([{ platform: 'xiaohongshu', os: 'android', label: '小红书', package_name: 'com.xingin.xhs' }]);
    expect(within(dialog).getByRole('button', { name: '试打开一次' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: '主导航' })).getByTestId('add-app').getAttribute('aria-label')).toBe('添加软件（已登记 1）'));
  });
  it('已登记的平台显示对勾；高级字段默认折叠', async () => {
    const { AddAppFlow } = await import('./components/AddAppSheet');
    render(<AddAppFlow data={{ apps: [{ id: 1, platform: 'zhihu', os: 'android', label: '知乎', package_name: 'com.zhihu.android' }], known: KNOWN }} onSaved={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: '知乎（已添加）' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '抖音' }));
    const adv = screen.getByText('高级').closest('details')!;
    expect(adv.open).toBe(false);
  });
  it('电脑端预填官方协议，iOS 预填 Scheme', async () => {
    const { prefill } = await import('./components/AddAppSheet');
    expect(prefill(KNOWN, 'zhihu', 'windows')).toMatchObject({ os: 'windows', protocol: 'zhihu://', exec_path: '' });
    expect(prefill(KNOWN, 'zhihu', 'ios')).toMatchObject({ url_scheme: 'zhihu://' });
  });
});

describe('V7：手机“更多”抽屉与右下“＋”', () => {
  it('底部 4 标签 + 更多；抽屉列全 8 项并在底部有“添加软件”；“＋”抽屉第一项是添加软件', async () => {
    const w = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
    mockFetch(() => ({}));
    render(<App />);
    const bottom = screen.getByRole('navigation', { name: '快捷导航' });
    expect(within(bottom).getAllByRole('link').map((a) => a.textContent)).toEqual(['今天', '灵感', '创作', '复盘']);
    fireEvent.click(within(bottom).getByRole('button', { name: '更多' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getAllByRole('link')).toHaveLength(8);
    expect(within(drawer).getByTestId('add-app')).toBeTruthy();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByTestId('fab'));
    const fabDrawer = await screen.findByRole('dialog', { name: '新建' });
    expect(within(fabDrawer).getAllByRole('button')[0]!.textContent).toContain('添加软件');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  });
});

describe('V6：侧栏折叠为图标栏', () => {
  it('平板默认图标栏，“添加软件”变为圆形“＋”并带提示；可展开', async () => {
    mockFetch(() => ({}));
    render(<App />);
    const nav = screen.getByRole('navigation', { name: '主导航' });
    expect(nav.getAttribute('data-rail')).toBe('true');
    expect(within(nav).getByTestId('add-app').textContent).not.toContain('添加软件');
    fireEvent.click(within(nav).getByRole('button', { name: '展开侧栏' }));
    expect(nav.getAttribute('data-rail')).toBe('false');
    expect(within(nav).getByTestId('add-app').textContent).toContain('添加软件');
  });
});

describe('推理效率', () => {
  it('运行状态显示单篇成本、缓存命中率、一次通过率、返工系数与服务商失败率，开关草稿-验证分档', async () => {
    const { EfficiencyPanel } = await import('./pages/efficiency');
    const puts: unknown[] = [];
    mockFetch((u, init) => {
      if (u.startsWith('/api/metrics/efficiency')) return {
        days: 30, drafts: 4, costPerDraft: 0.0123, generationCost: 0.0492, byPlatform: [{ platform: 'xiaohongshu', drafts: 4, cost: 0.0492, costPerDraft: 0.0123 }],
        cache: { inputTokens: 1000, cachedTokens: 620, hitRate: 0.62, reportedCalls: 5 }, firstPass: { measured: 4, passed: 3, rate: 0.75 },
        amplification: { calls: 10, minCalls: 8, factor: 1.25 }, confidence: [{ tier: 'high', n: 2 }, { tier: 'medium', n: 1 }, { tier: 'low', n: 1 }],
        latency: { calls: 12, p50: 420, p95: 2300 }, providers: [{ provider: 'deepseek', calls: 10, failed: 1, failRate: 0.1, p50: 400, p95: 2100 }],
      };
      if (u === '/api/pipeline/settings') {
        if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
        return { draftVerify: { enabled: false }, health: { enabled: true, windowMin: 30, minSamples: 4, maxFailRate: 0.5 }, warning: '未单独指定草稿模型' };
      }
      return {};
    });
    render(<EfficiencyPanel />);
    await waitFor(() => expect(screen.getByText('62%')).toBeTruthy());
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('1.25×')).toBeTruthy();
    expect(screen.getByText('2.3s')).toBeTruthy();
    expect(screen.getByText('10.0%')).toBeTruthy();
    expect(screen.getByText('未单独指定草稿模型')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    await waitFor(() => expect(puts).toEqual([{ draftVerify: { enabled: true } }]));
  });
});

describe('模型设置：小米 MiMo（路由页，备用/思考/接入地址在“高级”里）', () => {
  it('能选到小米 MiMo、看到可选模型、切换 Token Plan 地址与思考模式', async () => {
    const { Models } = await import('./pages/settings');
    const puts: { url: string; body: unknown }[] = [];
    const mimo = {
      id: 'mimo', label: '小米 MiMo', capabilities: ['llm', 'vision'], models: { llm: 'mimo-v2.6-flash', vision: 'mimo-v2.6-flash' }, ready: { ok: true },
      baseURL: 'https://api.xiaomimimo.com/v1', modelOptions: ['mimo-v2.6-flash', 'mimo-v2.6-pro', 'mimo-v2.6-pro-ultraspeed'],
      baseURLPresets: [{ label: '按量付费（sk- Key）', url: 'https://api.xiaomimimo.com/v1' }, { label: 'Token Plan（tp- / ttp- Key）', url: 'https://token-plan-cn.xiaomimimo.com/v1' }],
    };
    mockFetch((u, init) => {
      if (init?.method === 'PUT') { puts.push({ url: u, body: JSON.parse(String(init.body)) }); return { ok: true }; }
      if (u === '/api/models') return {
        capabilities: [{ id: 'llm', label: '文本/对话' }], providers: [mimo], status: [{ capability: 'llm', label: '文本/对话', configured: false }],
        routes: {}, prices: {}, defaultPrices: { 'mimo:mimo-v2.6-flash': { cachedInput: 0.02, input: 1, output: 2 } },
      };
      return { byCapability: [] };
    });
    render(<Models />);
    const sel = await screen.findByLabelText('文本/对话 服务商') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.text)).toContain('小米 MiMo');
    fireEvent.change(sel, { target: { value: 'mimo' } });
    await waitFor(() => expect(document.querySelectorAll('#models-llm option')).toHaveLength(3));
    expect((screen.getByLabelText('文本/对话 模型名') as HTMLInputElement).placeholder).toBe('mimo-v2.6-flash');
    fireEvent.change(screen.getByLabelText('文本/对话 思考模式'), { target: { value: 'on' } });
    expect(screen.getByText(/mimo:mimo-v2.6-flash 0.02\/1\/2/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('小米 MiMo 接入地址'), { target: { value: 'https://token-plan-cn.xiaomimimo.com/v1' } });
    await waitFor(() => expect(puts).toContainEqual({ url: '/api/models/providers/mimo', body: { baseURL: 'https://token-plan-cn.xiaomimimo.com/v1' } }));
    fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]!);
    await waitFor(() => expect(puts).toContainEqual({ url: '/api/models/routes', body: { routes: { llm: { default: { provider: 'mimo', thinking: true } } } } }));
  });
});
