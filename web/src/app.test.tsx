import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { App, NAV, ErrorBoundary } from './App';
import { translate } from './i18n';
import { deviceClass, runtime, serverBase, copyText } from './runtime';
import { api, ApiError, mediaUrl } from './api';
import { StatusBadge, Badge } from './ui';
import { normalize, parseHash } from './route';
import { layoutOf } from './nav';

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
    expect(translate('zh', '设置')).toBe('设置');
    expect(translate('en', '设置')).toBe('Settings');
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

describe('路由', () => {
  it('旧 hash 重定向到新信息架构', () => {
    expect(normalize('review')).toBe('create/drafts');
    expect(normalize('status')).toBe('settings/status');
    expect(normalize('overview')).toBe('today');
    expect(normalize('creator')).toBe('create/publish');
    expect(parseHash('#hot')).toEqual({ space: 'inspire', sub: 'hot', id: null });
    expect(parseHash('#create/12')).toEqual({ space: 'create', sub: 'drafts', id: '12' });
    expect(parseHash('#settings')).toEqual({ space: 'settings', sub: '', id: null });
    expect(layoutOf(390)).toBe('phone');
    expect(layoutOf(820)).toBe('tablet');
    expect(layoutOf(1440)).toBe('desktop');
  });
});

describe('界面', () => {
  it('渲染导航与今天待办流；硬边界与模型状态在设置中心的运行状态', async () => {
    mockFetch((u) => DATA[u] ?? {});
    render(<App />);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
    expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(5);
    await waitFor(() => expect(screen.getAllByText(/大模型降价/).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole('link', { name: /设置/ })[0]!);
    await waitFor(() => expect(screen.getByRole('link', { name: /运行状态/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('link', { name: /运行状态/ }));
    await waitFor(() => expect(screen.getByText('不做反检测')).toBeTruthy());
    expect(screen.getAllByText('未配置').length).toBeGreaterThan(0);
  });
  it('旧地址 #review 进入创作', async () => {
    mockFetch(() => ({}));
    location.hash = 'review';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '创作' })).toBeTruthy());
    expect(location.hash).toBe('#create/drafts');
  });
  it('切换语言与页面', async () => {
    mockFetch((u) => DATA[u] ?? { settings: {}, secrets: {}, capabilities: [], providers: [], status: [], routes: {}, prices: {}, byCapability: [] });
    render(<App />);
    fireEvent.click(screen.getAllByRole('link', { name: /设置/ })[0]!);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: '设置' })).toBeTruthy());
    const langSel = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    fireEvent.change(langSel, { target: { value: 'en' } });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy());
    expect(document.documentElement.lang).toBe('en');
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'dark' } });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('每个页面都能渲染不崩溃', async () => {
    mockFetch(() => ({}));
    for (const n of NAV) {
      location.hash = n.id;
      const { unmount } = render(<App />);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeTruthy());
      expect(screen.queryByText(/页面出错/)).toBeNull();
      unmount();
    }
  });
  it('错误边界与徽章', () => {
    const Boom = () => { throw new Error('炸了'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('炸了');
    spy.mockRestore();
    render(<><StatusBadge status="robots_disallow" /><StatusBadge status="weird" /><Badge tone="ok">好</Badge></>);
    expect(screen.getByText('robots 禁止')).toBeTruthy();
    expect(screen.getByText('weird')).toBeTruthy();
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

describe('模型设置：小米 MiMo', () => {
  it('能选到小米 MiMo、看到可选模型、切换 Token Plan 地址与思考模式', async () => {
    const { SettingsSection } = await import('./pages/settings');
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
    render(<SettingsSection section="models" theme="light" setTheme={() => {}} lang="zh" setLang={() => {}} />);
    const sel = await screen.findByLabelText('文本/对话 提供方') as HTMLSelectElement;
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
