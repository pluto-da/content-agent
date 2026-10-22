/**
 * 0.8.0 电脑端内嵌浏览器：每个平台一个 WebContentsView（分区 persist:creator-<平台>，沿用已有命名，登录不丢；无 preload）。
 * 渲染层只通过 preload 暴露的最小 IPC 同步矩形与状态（browser:setBounds / show / nav …，事件 browser:state / browser:error / browser:send-to-agent）。
 * 规则：只允许 https；唤起其他 App 的 scheme 拦截；新窗口在当前视图打开；context-menu 用 Electron 提供的 selectionText 生成“发给 Agent”
 * （这是 Electron 的选择信息，不执行页面脚本）。本文件不调用 executeJavaScript / insertCSS / setUserAgent / debugger。
 * 依赖通过参数注入（electron 模块），便于单测（mock electron）。
 */
const PLATFORM_ID = /^[a-z0-9_-]{1,40}$/i;
const isHttps = (u) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const hostIn = (u, hosts) => {
  if (!hosts || !hosts.length) return true;
  try { const h = new URL(u).hostname.toLowerCase(); return hosts.some((x) => h === x || h.endsWith(`.${x}`)); } catch { return false; }
};

function createBrowserViews(deps, win, send, opts = {}) {
  const { WebContentsView, Menu, shell } = deps;
  const views = new Map(); // platform → { view, hosts }
  let current = null;
  let visible = true;
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  const onRemember = opts.onRemember || (() => {});

  const state = (platform, wc, progress) => ({
    platform, url: wc.getURL(), title: wc.getTitle(),
    canGoBack: wc.navigationHistory ? wc.navigationHistory.canGoBack() : wc.canGoBack(),
    canGoForward: wc.navigationHistory ? wc.navigationHistory.canGoForward() : wc.canGoForward(),
    progress,
  });
  const applyBounds = () => {
    for (const [id, v] of views) {
      v.view.setBounds(bounds);
      v.view.setVisible(visible && id === current);
    }
  };

  function open({ platform, url, hosts }) {
    if (!PLATFORM_ID.test(String(platform || ''))) throw new Error('未知平台');
    if (!isHttps(url)) throw new Error('只允许 https 网址');
    if (views.has(platform)) return false;
    const view = new WebContentsView({ webPreferences: { partition: `persist:creator-${platform}`, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true } });
    const wc = view.webContents;
    const h = Array.isArray(hosts) ? hosts.filter((x) => typeof x === 'string').map((x) => x.toLowerCase()) : [];
    views.set(platform, { view, hosts: h });
    win.contentView.addChildView(view);
    view.setBounds(bounds);
    view.setVisible(false);
    wc.setWindowOpenHandler(({ url: u }) => { if (isHttps(u)) wc.loadURL(u); else external(platform, u); return { action: 'deny' }; });
    wc.on('will-navigate', (e, u) => { if (!isHttps(u)) { e.preventDefault(); external(platform, u); } });
    wc.on('will-redirect', (e, u) => { if (!/^https?:/.test(u)) { e.preventDefault(); external(platform, u); } });
    wc.on('did-start-loading', () => send('browser:state', state(platform, wc, 10)));
    wc.on('did-stop-loading', () => send('browser:state', state(platform, wc, 100)));
    const nav = (_e, u) => { send('browser:state', state(platform, wc, 60)); if (isHttps(u)) onRemember(platform, u); };
    wc.on('did-navigate', nav);
    wc.on('did-navigate-in-page', nav);
    wc.on('page-title-updated', () => send('browser:state', state(platform, wc, 100)));
    wc.on('did-fail-load', (_e, code, desc, u, isMain) => { if (isMain && code !== -3) send('browser:error', { platform, kind: code === -200 || (code <= -200 && code > -300) ? 'ssl' : 'network', url: u, description: desc }); });
    wc.on('did-navigate', (_e, _u, status) => { if (status === 403 || status === 451 || status === 429 || status >= 500) send('browser:error', { platform, kind: 'http', status }); });
    wc.on('context-menu', (_e, params) => {
      const text = String(params.selectionText || '').trim();
      const items = [];
      if (text) items.push({ label: '发给 Agent', click: () => send('browser:send-to-agent', { platform, text: text.slice(0, 5000), url: wc.getURL(), title: wc.getTitle() }) });
      items.push({ label: '复制', role: 'copy', enabled: !!text }, { label: '后退', enabled: state(platform, wc, 0).canGoBack, click: () => goBack(wc) }, { label: '重新加载', click: () => wc.reload() });
      Menu.buildFromTemplate(items).popup({ window: win });
    });
    wc.loadURL(url);
    return true;
  }
  function external(platform, u) { send('browser:state', { platform, externalScheme: u }); }
  const goBack = (wc) => (wc.navigationHistory ? wc.navigationHistory.goBack() : wc.goBack());
  const goForward = (wc) => (wc.navigationHistory ? wc.navigationHistory.goForward() : wc.goForward());

  function show({ platform }) { if (!views.has(platform)) return false; current = platform; applyBounds(); const wc = views.get(platform).view.webContents; send('browser:state', state(platform, wc, wc.isLoading() ? 50 : 100)); return true; }
  function destroy({ platform }) {
    const v = views.get(platform);
    if (!v) return false;
    win.contentView.removeChildView(v.view);
    try { v.view.webContents.close(); } catch { /* 已关闭 */ }
    views.delete(platform);
    if (current === platform) current = null;
    return true;
  }
  function hideAll() { current = null; applyBounds(); }
  function setBounds(r) {
    const n = (x) => Math.max(0, Math.round(Number(x) || 0));
    bounds = { x: n(r && r.x), y: n(r && r.y), width: n(r && r.width), height: n(r && r.height) };
    applyBounds();
    return bounds;
  }
  function setVisible(v) { visible = !!v; applyBounds(); }
  function nav({ platform, action, url }) {
    const v = views.get(platform);
    if (!v) return false;
    const wc = v.view.webContents;
    if (action === 'back') goBack(wc);
    else if (action === 'forward') goForward(wc);
    else if (action === 'reload') wc.reload();
    else if (action === 'stop') wc.stop();
    else if (action === 'load') { if (!isHttps(url) || !hostIn(url, v.hosts)) throw new Error('只允许该平台官方域名内的 https 网址'); wc.loadURL(url); }
    return true;
  }
  async function clear({ platform }, session) {
    destroy({ platform });
    const ses = session.fromPartition(`persist:creator-${platform}`);
    await ses.clearStorageData();
    await ses.clearCache();
    return true;
  }
  return { open, show, destroy, hideAll, setBounds, setVisible, nav, clear, views, get current() { return current; }, get bounds() { return bounds; }, openExternal: (u) => shell.openExternal(u) };
}

module.exports = { createBrowserViews, isHttps, hostIn };
