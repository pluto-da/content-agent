/**
 * 桌面端主进程：
 * 1. 在本机启动后端（只监听 127.0.0.1，数据存放在系统应用数据目录）；
 * 2. 打开主窗口加载界面；
 * 3. 创作中心使用 <webview>，每个平台独立的持久分区 persist:creator-<平台>，登录态只保存在本机。
 * 安全：禁用 Node 集成、开启上下文隔离与沙箱；webview 只允许官方域名、禁止预加载脚本与弹窗；
 * 主进程不对创作中心执行任何脚本（无 executeJavaScript / debugger / Cookie 读取）。
 */
const { app, BrowserWindow, shell, session } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

const ALLOWED = ['douyin.com', 'xiaohongshu.com', 'weixin.qq.com', 'qq.com', 'x.com', 'twitter.com', 'goofish.com', 'taobao.com'];
const allowed = (u) => { try { const h = new URL(u).hostname; return new URL(u).protocol === 'https:' && ALLOWED.some((d) => h === d || h.endsWith('.' + d)); } catch { return false; } };

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

let server;
async function startServer() {
  const port = await freePort();
  const res = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
  server = fork(path.join(res, 'server', 'dist', 'index.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: '127.0.0.1', CA_DATA_DIR: path.join(app.getPath('userData'), 'data'), CA_WEB_DIST: path.join(res, 'web', 'dist'), CA_AGENT_DEFAULTS: path.join(res, 'agent') },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return port; } catch { /* 等待 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('后端启动失败');
}

async function createWindow() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1360, height: 880, title: '内容运营助手',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    if (!allowed(params.src) || !String(params.partition || '').startsWith('persist:creator-')) event.preventDefault();
  });
  app.on('web-contents-created', (_e, contents) => {
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => { if (allowed(url)) contents.loadURL(url); else shell.openExternal(url); return { action: 'deny' }; });
    contents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); shell.openExternal(url); } });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications' || perm === 'clipboard-sanitized-write'));
  return createWindow();
});
app.on('window-all-closed', () => { if (server) server.kill(); app.quit(); });
