/**
 * 内嵌浏览器三端统一接口（0.8.0）：
 *  - 安卓：原生插件 BrowserHost —— 在 Capacitor WebView 之上叠加一个容器，每个保活平台一个系统 WebView，按 HTML 占位元素的矩形摆放；
 *  - Electron：主进程 WebContentsView（分区 persist:creator-<id>，无 preload），经 preload 暴露的最小 IPC 同步矩形与状态；
 *  - 网页版：官方站点普遍禁止被框架嵌入 → 不内嵌，主区显示平台卡片 + 新标签页打开。
 * 全程不执行任何页面脚本、不读页面内容；只有原生层的 url / title / 前进后退状态回传给界面。
 * 所有调用记入 calls（B4 插件调用记录）。
 */
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { appOs, electronBridge, runtime } from '../runtime';
import { BrowserPool, type PoolAction } from './pool';

export interface NavState { platform: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean; progress: number; loading?: boolean }
export interface LoadError { platform: string; kind: 'http' | 'network' | 'ssl' | 'blocked'; status?: number; url?: string; description?: string }
export interface Rect { x: number; y: number; width: number; height: number }

interface BrowserHostPlugin {
  isAvailable(): Promise<{ available: boolean; multiProfile: boolean; webviewVersion?: string }>;
  open(o: { platform: string; url: string; hosts: string[]; profile: string; restored?: boolean }): Promise<void>;
  show(o: { platform: string }): Promise<void>;
  hideAll(): Promise<void>;
  setFrame(r: Rect & { dpr?: number }): Promise<void>;
  setVisible(o: { visible: boolean }): Promise<void>;
  goBack(o: { platform: string }): Promise<void>;
  goForward(o: { platform: string }): Promise<void>;
  reload(o: { platform: string }): Promise<void>;
  stop(o: { platform: string }): Promise<void>;
  loadUrl(o: { platform: string; url: string }): Promise<void>;
  destroy(o: { platform: string }): Promise<void>;
  clearData(o: { platform: string; hosts: string[] }): Promise<{ cleared: number }>;
  getState(o: { platform: string }): Promise<NavState>;
  takePending(): Promise<{ items: { kind: string; text?: string; title?: string; image?: string; mime?: string; channel: string }[] }>;
  addListener(ev: 'navState', fn: (s: NavState) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'loadError', fn: (e: LoadError) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'externalScheme', fn: (e: { platform: string; url: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'inboxReceived', fn: (e: { count: number }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'trimMemory', fn: (e: { level: number }) => void): Promise<PluginListenerHandle>;
}
export const BrowserHostNative = registerPlugin<BrowserHostPlugin>('BrowserHost');

export type HostMode = 'android' | 'electron' | 'web';
export function hostMode(): HostMode {
  if (runtime() === 'capacitor' && appOs() === 'android') return 'android';
  if (runtime() === 'electron' && electronBridge()?.browser) return 'electron';
  return 'web';
}

export interface CallRecord { op: string; args?: unknown; at: number }
type Listener = { nav: (s: NavState) => void; error: (e: LoadError) => void; scheme: (e: { platform: string; url: string }) => void; restored: (platform: string) => void; inbox: () => void };

/** 单例：三端统一的浏览器宿主。 */
class Host {
  mode: HostMode = hostMode();
  pool = new BrowserPool();
  calls: CallRecord[] = [];
  hosts = new Map<string, string[]>();
  private l: Partial<Listener>[] = [];
  private ready = false;
  private visible = true;
  multiProfile = false;
  available = this.mode !== 'web';

  on(x: Partial<Listener>): () => void { this.l.push(x); return () => { this.l = this.l.filter((y) => y !== x); }; }
  private emit<K extends keyof Listener>(k: K, ...a: Parameters<Listener[K]>) { for (const x of this.l) (x[k] as ((...b: unknown[]) => void) | undefined)?.(...a); }
  private rec(op: string, args?: unknown) { this.calls.push({ op, args, at: Date.now() }); if (this.calls.length > 500) this.calls.shift(); }

  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = true;
    this.mode = hostMode();
    if (this.mode === 'android') {
      try {
        const r = await BrowserHostNative.isAvailable();
        this.available = r.available; this.multiProfile = r.multiProfile;
      } catch { this.available = false; }
      if (!this.available) return;
      await BrowserHostNative.addListener('navState', (s) => { this.pool.update(s.platform, s); this.emit('nav', s); });
      await BrowserHostNative.addListener('loadError', (e) => this.emit('error', e));
      await BrowserHostNative.addListener('externalScheme', (e) => this.emit('scheme', e));
      await BrowserHostNative.addListener('inboxReceived', () => this.emit('inbox'));
      await BrowserHostNative.addListener('trimMemory', () => { void this.exec(this.pool.trim()); });
    } else if (this.mode === 'electron') {
      const b = electronBridge()!.browser!;
      this.available = true;
      b.onState((s: NavState) => { this.pool.update(s.platform, s); this.emit('nav', s); });
      b.onError?.((e: LoadError) => this.emit('error', e));
      b.onSendToAgent?.((p: { platform: string; text: string; url: string; title: string }) => window.dispatchEvent(new CustomEvent('ca:send-to-agent', { detail: { ...p, channel: 'context_menu' } })));
    }
  }

  private async exec(actions: PoolAction[]): Promise<void> {
    for (const a of actions) {
      this.rec(a.op, a);
      if (a.op === 'open') {
        const hosts = this.hosts.get(a.platform) ?? [];
        if (this.mode === 'android') await BrowserHostNative.open({ platform: a.platform, url: a.url, hosts, profile: `ca-${a.platform}`, restored: a.restored });
        else if (this.mode === 'electron') await electronBridge()!.browser!.open({ platform: a.platform, url: a.url, hosts });
        if (a.restored) this.emit('restored', a.platform);
      } else if (a.op === 'show') {
        if (this.mode === 'android') await BrowserHostNative.show({ platform: a.platform });
        else if (this.mode === 'electron') await electronBridge()!.browser!.show({ platform: a.platform });
      } else if (a.op === 'hibernate') {
        if (this.mode === 'android') await BrowserHostNative.destroy({ platform: a.platform });
        else if (this.mode === 'electron') await electronBridge()!.browser!.destroy({ platform: a.platform });
      }
    }
  }

  /** 切到某平台（保活池决定 show / open / restored）。 */
  async activate(platform: string, homeUrl: string, hosts: string[]): Promise<PoolAction[]> {
    await this.init();
    this.hosts.set(platform, hosts);
    const actions = this.pool.activate(platform, homeUrl);
    if (this.available) await this.exec(actions); else for (const a of actions) this.rec(a.op, a);
    return actions;
  }
  async loadUrl(platform: string, url: string): Promise<void> {
    if (!/^https:\/\//.test(url)) throw new Error('只允许 https 网址');
    const hosts = this.hosts.get(platform) ?? [];
    const h = new URL(url).hostname;
    if (hosts.length && !hosts.some((x) => h === x || h.endsWith(`.${x}`))) throw new Error('网址不属于该平台官方域名');
    this.rec('loadUrl', { platform, url });
    this.pool.update(platform, { url });
    if (this.mode === 'android' && this.available) await BrowserHostNative.loadUrl({ platform, url });
    else if (this.mode === 'electron') await electronBridge()!.browser!.nav({ platform, action: 'load', url });
  }
  async nav(platform: string, action: 'back' | 'forward' | 'reload' | 'stop'): Promise<void> {
    this.rec(action, { platform });
    if (this.mode === 'android' && this.available) {
      if (action === 'back') await BrowserHostNative.goBack({ platform });
      else if (action === 'forward') await BrowserHostNative.goForward({ platform });
      else if (action === 'reload') await BrowserHostNative.reload({ platform });
      else await BrowserHostNative.stop({ platform });
    } else if (this.mode === 'electron') await electronBridge()!.browser!.nav({ platform, action });
  }
  private lastFrame = '';
  async setFrame(r: Rect): Promise<void> {
    const key = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    if (key === this.lastFrame) return;
    this.lastFrame = key;
    this.rec('setFrame', r);
    if (!this.available) return;
    if (this.mode === 'android') await BrowserHostNative.setFrame({ ...r, dpr: window.devicePixelRatio || 1 });
    else if (this.mode === 'electron') await electronBridge()!.browser!.setBounds(r);
  }
  async setVisible(v: boolean): Promise<void> {
    if (this.visible === v) return;
    this.visible = v;
    this.rec('setVisible', { visible: v });
    if (!this.available) return;
    if (this.mode === 'android') await BrowserHostNative.setVisible({ visible: v });
    else if (this.mode === 'electron') await electronBridge()!.browser!.setVisible(v);
  }
  async hideAll(): Promise<void> {
    this.rec('hideAll');
    this.pool.current = null;
    if (!this.available) return;
    if (this.mode === 'android') await BrowserHostNative.hideAll();
    else if (this.mode === 'electron') await electronBridge()!.browser!.hideAll();
  }
  async clear(platform: string, hosts: string[]): Promise<number> {
    this.rec('clearData', { platform });
    this.pool.remove(platform);
    if (this.mode === 'android' && this.available) return (await BrowserHostNative.clearData({ platform, hosts })).cleared;
    if (this.mode === 'electron') { await electronBridge()!.browser!.clear({ platform }); return 1; }
    return 0;
  }
  setLimit(n: number) { void this.exec(this.pool.setLimit(n)); }
}

export const browserHost = new Host();
if (typeof window !== 'undefined') (window as unknown as { __browserCalls?: CallRecord[] }).__browserCalls = browserHost.calls;

/** 覆盖主区的 HTML 浮层计数（原生视图在最上层会挡住它们）：任何浮层打开 → 收起原生视图，全部关闭 → 恢复。 */
let overlays = 0;
const overlayListeners = new Set<(n: number) => void>();
export const overlayManager = {
  push() { overlays++; void browserHost.setVisible(false); for (const f of overlayListeners) f(overlays); return () => overlayManager.pop(); },
  pop() { overlays = Math.max(0, overlays - 1); if (!overlays) void browserHost.setVisible(true); for (const f of overlayListeners) f(overlays); },
  count: () => overlays,
  subscribe(f: (n: number) => void) { overlayListeners.add(f); return () => { overlayListeners.delete(f); }; },
};
