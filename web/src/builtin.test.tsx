/**
 * 0.7.0 内置平台：按钮出现条件、复制 + 打开流程、不支持时降级。
 * 原生插件（BuiltinWeb / SplitScreen / LocalApps）用 vi.mock 替身，验证网页层发出的调用与给用户的提示。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const plugins = vi.hoisted(() => {
  const make = () => ({
    isAvailable: vi.fn(), open: vi.fn(), clearData: vi.fn(), clearAll: vi.fn(),
    info: vi.fn(), openAdjacent: vi.fn(),
    launch: vi.fn(), listLaunchable: vi.fn(), isInstalled: vi.fn(), share: vi.fn(), canOpen: vi.fn(),
  });
  return { BuiltinWeb: make(), SplitScreen: make(), LocalApps: make() } as Record<string, ReturnType<typeof make>>;
});
vi.mock('@capacitor/core', () => ({ registerPlugin: (name: string) => plugins[name] }));

import {
  builtinMode, builtinOpenLabel, builtinPublishLabel, canClearBuiltin, canSplitScreen, clearBuiltin, copyAndOpenBuiltin, isLargeScreen, openBuiltin, openSplit, PASTE_HINT, splitLabel, type Env,
} from './builtin';
import { center, publishUrlOfWrite } from './data/platforms';
import { db, resetLocalDb } from './local/db';
import { localApi } from './local/router';
import { draftText, Publish } from './pages/publish';
import { Home } from './pages/home';

const xhs = center('xiaohongshu')!;
const phone: Env = { rt: 'capacitor', os: 'android', large: false };
const tablet: Env = { rt: 'capacitor', os: 'android', large: true };
const web: Env = { rt: 'web', os: 'windows', large: true };
const androidEntry = { platform: 'xiaohongshu', os: 'android' as const, label: '小红书', package_name: 'com.xingin.xhs' };

function asAndroidApp() {
  (window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
}
let clip: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetLocalDb();
  localStorage.clear();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  for (const p of Object.values(plugins)) for (const f of Object.values(p)) f.mockReset();
  clip = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clip } });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

describe('按钮出现条件', () => {
  it('打开方式：安卓 App = 原生内置页；iOS App = 系统内置浏览器；电脑 / 网页 = 新标签页', () => {
    expect(builtinMode('capacitor', 'android')).toBe('native');
    expect(builtinMode('capacitor', 'ios')).toBe('sheet');
    expect(builtinMode('web', 'android')).toBe('tab');
    expect(builtinMode('electron', 'windows')).toBe('tab');
  });
  it('“分屏打开”只在安卓 App + 平板 / 大屏，且登记了安卓包名时出现', () => {
    expect(canSplitScreen(tablet)).toBe(true);
    expect(canSplitScreen(tablet, androidEntry)).toBe(true);
    expect(canSplitScreen(phone, androidEntry)).toBe(false);
    expect(canSplitScreen(web, androidEntry)).toBe(false);
    expect(canSplitScreen({ rt: 'capacitor', os: 'ios', large: true }, androidEntry)).toBe(false);
    expect(canSplitScreen(tablet, { os: 'android', package_name: '' })).toBe(false);
    expect(canSplitScreen(tablet, { os: 'ios', package_name: null })).toBe(false);
    expect(canSplitScreen(tablet, null)).toBe(false);
  });
  it('平板判断：屏幕短边 ≥ 600', () => {
    expect(isLargeScreen({ innerWidth: 375, innerHeight: 812, screen: { width: 375, height: 812 } })).toBe(false);
    expect(isLargeScreen({ innerWidth: 1280, innerHeight: 800, screen: { width: 1280, height: 800 } })).toBe(true);
    expect(isLargeScreen({ innerWidth: 800, innerHeight: 1280 })).toBe(true);
  });
  it('“退出该平台登录”只在安卓原生内置页提供', () => {
    expect(canClearBuiltin(phone)).toBe(true);
    expect(canClearBuiltin(web)).toBe(false);
    expect(canClearBuiltin({ rt: 'capacitor', os: 'ios', large: false })).toBe(false);
  });
  it('按钮文案', () => {
    expect(builtinPublishLabel(xhs, 'native')).toBe('在软件内打开小红书发布');
    expect(builtinPublishLabel(xhs, 'tab')).toBe('在新标签页打开小红书发布');
    expect(builtinOpenLabel(xhs, 'native')).toBe('打开小红书（内置）');
    expect(builtinOpenLabel(xhs, 'tab')).toBe('打开小红书网页版');
    expect(splitLabel(xhs)).toBe('分屏打开小红书');
  });
  it('官方网址都是 https；知乎回答进创作中心、知乎文章进写文章页', () => {
    for (const id of ['xiaohongshu', 'douyin', 'channels', 'wechat_mp', 'zhihu', 'bilibili', 'kuaishou', 'xianyu', 'x']) {
      const c = center(id)!;
      expect(c.url).toMatch(/^https:\/\//);
      expect(c.publishUrl).toMatch(/^https:\/\//);
      expect(c.hosts.length).toBeGreaterThan(0);
    }
    expect(publishUrlOfWrite('zhihu_article')).toBe('https://zhuanlan.zhihu.com/write');
    expect(publishUrlOfWrite('zhihu_answer')).toBe('https://www.zhihu.com/creator');
    expect(publishUrlOfWrite('xiaohongshu')).toBe('https://creator.xiaohongshu.com/publish/publish');
  });
});

describe('复制 + 打开流程', () => {
  it('安卓 App：先复制文案，再在内置页打开发布页，并带上“由你本人点击发布”的提示', async () => {
    asAndroidApp();
    const order: string[] = [];
    clip.mockImplementation(async () => { order.push('copy'); });
    plugins.BuiltinWeb!.isAvailable.mockResolvedValue({ available: true });
    plugins.BuiltinWeb!.open.mockImplementation(async () => { order.push('open'); });
    const r = await copyAndOpenBuiltin(xhs, '标题\n\n正文');
    expect(order).toEqual(['copy', 'open']);
    expect(clip).toHaveBeenCalledWith('标题\n\n正文');
    expect(plugins.BuiltinWeb!.open).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://creator.xiaohongshu.com/publish/publish', title: '小红书', platform: 'xiaohongshu', packageName: 'com.xingin.xhs', hint: PASTE_HINT, hosts: xhs.hosts,
    }));
    expect(r).toMatchObject({ ok: true, copied: true });
    expect(r.message).toContain('粘贴后由你本人点击发布');
  });
  it('网页版：复制后在新标签页打开发布页', async () => {
    const w = { opener: {} };
    const open = vi.fn().mockReturnValue(w);
    vi.stubGlobal('open', open);
    const r = await copyAndOpenBuiltin(xhs, 'x');
    expect(open).toHaveBeenCalledWith('https://creator.xiaohongshu.com/publish/publish', '_blank');
    expect(w.opener).toBeNull();
    expect(r.ok).toBe(true);
    expect(plugins.BuiltinWeb!.open).not.toHaveBeenCalled();
  });
  it('只接受 https 网址', async () => {
    const r = await openBuiltin(xhs, { url: 'javascript:alert(1)' });
    expect(r.ok).toBe(false);
  });
  it('去发布页：新按钮出现，点击后复制完整文案并打开发布页，状态里提示由你本人发布', async () => {
    const open = vi.fn().mockReturnValue({ opener: null });
    vi.stubGlobal('open', open);
    await db.insert('drafts', { platform: 'xiaohongshu', title: '通勤三招', body: '正文内容', tags: ['效率'], status: 'approved', created_at: new Date().toISOString() });
    render(<Publish go={() => {}} />);
    const btn = await screen.findByTestId('builtin-publish');
    expect(btn.textContent).toBe('在新标签页打开小红书发布');
    expect(screen.getByTestId('handoff').textContent).toContain('复制文案并打开小红书');
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(clip).toHaveBeenCalledWith(draftText({ title: '通勤三招', body: '正文内容', tags: ['效率'] }));
    expect(clip.mock.calls[0]![0]).toBe('通勤三招\n\n正文内容\n\n#效率');
    expect((await screen.findByTestId('publish-status')).textContent).toContain('由你本人点击发布');
    expect(screen.queryByTestId('fallback-app')).toBeNull();
  });
});

describe('不支持时降级', () => {
  it('系统 WebView 不可用：不打开内置页，返回原因并提示改用官方 App', async () => {
    asAndroidApp();
    plugins.BuiltinWeb!.isAvailable.mockResolvedValue({ available: false, reason: '系统 WebView 未安装或已停用' });
    const r = await copyAndOpenBuiltin(xhs, 'x');
    expect(plugins.BuiltinWeb!.open).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, fallbackApp: true, copied: true });
    expect(r.message).toContain('系统 WebView 未安装或已停用');
    expect(r.message).toContain('官方 App');
  });
  it('内置页打开失败（插件报错）：同样给出原因 + 官方 App 备选', async () => {
    asAndroidApp();
    plugins.BuiltinWeb!.isAvailable.mockResolvedValue({ available: true });
    plugins.BuiltinWeb!.open.mockRejectedValue(new Error('boom'));
    const r = await openBuiltin(xhs, { publish: true });
    expect(r).toMatchObject({ ok: false, fallbackApp: true });
    expect(r.message).toContain('boom');
  });
  it('旧版 App 没有插件：英文报错换成白话', async () => {
    asAndroidApp();
    plugins.BuiltinWeb!.isAvailable.mockRejectedValue(new Error('"BuiltinWeb" plugin is not implemented on android'));
    const r = await openBuiltin(xhs);
    expect(r).toMatchObject({ ok: false, fallbackApp: true });
    expect(r.message).toContain('请安装 0.7.0');
    expect(r.message).not.toContain('not implemented');
  });
  it('网页版弹窗被拦截：提示允许弹出窗口', async () => {
    vi.stubGlobal('open', vi.fn().mockReturnValue(null));
    const r = await openBuiltin(xhs);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('弹出窗口');
  });
  it('去发布页：内置页不可用时显示原因与“打开官方 App”，点击后启动官方 App', async () => {
    asAndroidApp();
    plugins.BuiltinWeb!.isAvailable.mockResolvedValue({ available: false, reason: '系统 WebView 未安装或已停用' });
    plugins.LocalApps!.launch.mockResolvedValue(undefined);
    await db.insert('drafts', { platform: 'xiaohongshu', title: 't', body: 'b', status: 'approved', created_at: new Date().toISOString() });
    render(<Publish go={() => {}} />);
    const btn = await screen.findByTestId('builtin-publish');
    expect(btn.textContent).toBe('在软件内打开小红书发布');
    fireEvent.click(btn);
    expect((await screen.findByTestId('publish-status')).textContent).toContain('内置网页打不开');
    fireEvent.click(screen.getByTestId('fallback-app'));
    await waitFor(() => expect(plugins.LocalApps!.launch).toHaveBeenCalledWith(expect.objectContaining({ packageName: 'com.xingin.xhs' })));
  });
  it('分屏：平板上用 LAUNCH_ADJACENT 打开；系统回报不支持时提示已正常打开', async () => {
    plugins.SplitScreen!.openAdjacent.mockResolvedValueOnce({ adjacent: true, inMultiWindow: false });
    let r = await openSplit(androidEntry, '小红书', tablet);
    expect(plugins.SplitScreen!.openAdjacent).toHaveBeenCalledWith({ packageName: 'com.xingin.xhs' });
    expect(r.message).toContain('分屏打开小红书');
    plugins.SplitScreen!.openAdjacent.mockResolvedValueOnce({ adjacent: false, inMultiWindow: false });
    r = await openSplit(androidEntry, '小红书', tablet);
    expect(r.message).toBe('这台设备不支持分屏，已正常打开小红书');
  });
  it('分屏：手机（不支持）直接正常打开并提示；未安装时说明原因', async () => {
    asAndroidApp();
    plugins.LocalApps!.launch.mockResolvedValue(undefined);
    let r = await openSplit(androidEntry, '小红书', phone);
    expect(plugins.SplitScreen!.openAdjacent).not.toHaveBeenCalled();
    expect(plugins.LocalApps!.launch).toHaveBeenCalled();
    expect(r).toEqual({ ok: true, message: '这台设备不支持分屏，已正常打开小红书' });
    plugins.SplitScreen!.openAdjacent.mockRejectedValueOnce(new Error('NOT_INSTALLED：未安装该应用'));
    r = await openSplit(androidEntry, '小红书', tablet);
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toContain('请先在手机上安装');
  });
  it('退出登录：安卓调用原生清除（只传站点列表）；网页版说明去浏览器清除', async () => {
    let r = await clearBuiltin(xhs);
    expect(r.ok).toBe(false);
    expect(plugins.BuiltinWeb!.clearData).not.toHaveBeenCalled();
    asAndroidApp();
    plugins.BuiltinWeb!.clearData.mockResolvedValue({ cleared: 3 });
    r = await clearBuiltin(center('wechat_mp')!);
    expect(plugins.BuiltinWeb!.clearData).toHaveBeenCalledWith({ hosts: ['mp.weixin.qq.com', 'weixin.qq.com'] });
    expect(r.message).toContain('一起退出');
  });
});

describe('首页入口卡片', () => {
  it('登记了软件的平台在首页有“打开 X”入口；没登记时不显示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked')));
    const { unmount } = render(<Home go={() => {}} />);
    await screen.findByTestId('intro');
    expect(screen.queryByTestId('builtin-entries')).toBeNull();
    unmount();
    await localApi('/api/local-apps', 'PUT', androidEntry);
    render(<Home go={() => {}} />);
    const btn = await screen.findByTestId('home-builtin');
    expect(btn.textContent).toBe('打开小红书网页版');
    expect(screen.queryByTestId('home-split')).toBeNull();
  });
});
