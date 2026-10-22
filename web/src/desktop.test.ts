/** B16：电脑端 WebContentsView 管理（mock electron）：分区命名、setBounds、显示切换、context-menu“发给 Agent”、导航白名单。 */
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createBrowserViews } = require('../../desktop/browser-views.cjs') as { createBrowserViews: (...a: unknown[]) => any };

function mockElectron() {
  const created: any[] = [];
  class WebContentsView {
    opts: any; bounds: any = null; visible = true; handlers: Record<string, (...a: any[]) => void> = {};
    webContents: any;
    constructor(opts: any) {
      this.opts = opts; created.push(this);
      const h = this.handlers;
      this.webContents = {
        url: '', title: '标题', loadURL: vi.fn(function (this: any, u: string) { this.url = u; }), getURL() { return this.url; }, getTitle() { return this.title; },
        canGoBack: () => false, canGoForward: () => false, isLoading: () => false, reload: vi.fn(), stop: vi.fn(), goBack: vi.fn(), goForward: vi.fn(), close: vi.fn(),
        setWindowOpenHandler: vi.fn((fn: any) => { h.open = fn; }), on: (ev: string, fn: any) => { h[ev] = fn; },
        executeJavaScript: vi.fn(), insertCSS: vi.fn(), setUserAgent: vi.fn(),
      };
    }
    setBounds(b: any) { this.bounds = b; }
    setVisible(v: boolean) { this.visible = v; }
  }
  const menus: any[] = [];
  const Menu = { buildFromTemplate: (items: any[]) => { menus.push(items); return { popup: vi.fn() }; } };
  const win = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } };
  return { WebContentsView, Menu, shell: { openExternal: vi.fn() }, win, created, menus };
}

describe('B16 Electron WebContentsView', () => {
  it('每平台一个视图：分区 persist:creator-<id>、沙箱、无 preload；setBounds 同步、只显示当前平台', () => {
    const m = mockElectron(); const send = vi.fn();
    const bv = createBrowserViews(m, m.win, send);
    expect(bv.open({ platform: 'xiaohongshu', url: 'https://creator.xiaohongshu.com/', hosts: ['xiaohongshu.com'] })).toBe(true);
    bv.open({ platform: 'douyin', url: 'https://creator.douyin.com/', hosts: ['douyin.com'] });
    expect(m.created[0].opts.webPreferences).toEqual({ partition: 'persist:creator-xiaohongshu', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
    expect('preload' in m.created[0].opts.webPreferences).toBe(false);
    bv.setBounds({ x: 72.4, y: 44, width: 988.6, height: 856 });
    bv.show({ platform: 'douyin' });
    expect(m.created[1].bounds).toEqual({ x: 72, y: 44, width: 989, height: 856 });
    expect(m.created.map((v: any) => v.visible)).toEqual([false, true]);
    bv.setVisible(false); expect(m.created[1].visible).toBe(false);
    bv.setVisible(true); bv.hideAll(); expect(m.created.every((v: any) => !v.visible)).toBe(true);
    // 不执行任何页面脚本
    for (const v of m.created) { expect(v.webContents.executeJavaScript).not.toHaveBeenCalled(); expect(v.webContents.insertCSS).not.toHaveBeenCalled(); expect(v.webContents.setUserAgent).not.toHaveBeenCalled(); }
  });
  it('只允许 https；导航 load 只允许该平台白名单；外部 scheme 拦截；新窗口在当前视图打开', () => {
    const m = mockElectron(); const send = vi.fn();
    const bv = createBrowserViews(m, m.win, send);
    expect(() => bv.open({ platform: 'x', url: 'http://x.com' })).toThrow('https');
    bv.open({ platform: 'zhihu', url: 'https://www.zhihu.com/creator', hosts: ['zhihu.com'] });
    expect(() => bv.nav({ platform: 'zhihu', action: 'load', url: 'https://evil.com/' })).toThrow('官方域名');
    bv.nav({ platform: 'zhihu', action: 'load', url: 'https://zhuanlan.zhihu.com/write' });
    const h = m.created[0].handlers;
    const e = { preventDefault: vi.fn() };
    h['will-navigate'](e, 'zhihu://question/1');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(h.open({ url: 'https://www.zhihu.com/hot' })).toEqual({ action: 'deny' });
    expect(m.created[0].webContents.loadURL).toHaveBeenLastCalledWith('https://www.zhihu.com/hot');
  });
  it('context-menu：有选中文字时出现“发给 Agent”，点击只回传 selectionText + 网址 + 标题', () => {
    const m = mockElectron(); const send = vi.fn();
    const bv = createBrowserViews(m, m.win, send);
    bv.open({ platform: 'xiaohongshu', url: 'https://www.xiaohongshu.com/explore', hosts: ['xiaohongshu.com'] });
    m.created[0].handlers['context-menu']({}, { selectionText: '  秋天第一杯奶茶  ' });
    const item = m.menus[0].find((x: any) => x.label === '发给 Agent');
    item.click();
    expect(send).toHaveBeenCalledWith('browser:send-to-agent', { platform: 'xiaohongshu', text: '秋天第一杯奶茶', url: 'https://www.xiaohongshu.com/explore', title: '标题' });
    m.created[0].handlers['context-menu']({}, { selectionText: '' });
    expect(m.menus[1].some((x: any) => x.label === '发给 Agent')).toBe(false);
  });
});
