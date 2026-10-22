/**
 * 桌面端主进程：
 * 1. 在本机启动后端（只监听 127.0.0.1，数据存放在系统应用数据目录）；
 * 2. 打开主窗口加载界面；
 * 3. 创作中心使用 <webview>，每个平台独立的持久分区 persist:creator-<平台>，登录态只保存在本机。
 *
 * 登录保持（直到用户手动退出）：
 * - 每个平台一个持久分区，Cookie / localStorage 由 Chromium 写在 userData/Partitions/creator-<平台>；
 * - 页面跳转、每 60 秒、退出前都会调用 cookies.flushStore() 把 Cookie 落盘；
 * - 启动与升级时从不清理分区（本文件中唯一的清除调用是用户点击“退出登录/清除登录”）；
 * - 记住每个标签页最后访问的官方地址（creator-state.json），下次打开时恢复。
 * 登录状态只根据“该分区中是否存在该平台域名的 Cookie（只数数量，不读取值）”判断。
 *
 * 安全：禁用 Node 集成、开启上下文隔离与沙箱；webview 只允许官方域名、禁止预加载脚本与弹窗；
 * 主进程不对创作中心执行任何脚本（无 executeJavaScript / debugger），不读取、不修改、不伪造 Cookie 值或有效期。
 */
const { app, BrowserWindow, shell, session, ipcMain, dialog, clipboard } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');

/** 平台 → 官方域名（与 server/src/modules/handoff.ts 的 CREATOR_CENTERS 保持一致）。 */
const CENTERS = {
  douyin: ['douyin.com'],
  xiaohongshu: ['xiaohongshu.com'],
  channels: ['channels.weixin.qq.com', 'weixin.qq.com', 'qq.com'],
  wechat_mp: ['mp.weixin.qq.com', 'weixin.qq.com', 'qq.com'],
  x: ['x.com', 'twitter.com'],
  xianyu: ['goofish.com', 'taobao.com'],
  zhihu: ['zhihu.com'],
};
const ALLOWED = [...new Set(Object.values(CENTERS).flat())];
const hostOk = (h, domains) => domains.some((d) => h === d || h.endsWith('.' + d));
const allowed = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && hostOk(x.hostname, ALLOWED); } catch { return false; } };
const partitionOf = (id) => `persist:creator-${id}`;
const validId = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(CENTERS, id);

function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

/* ---------- 每个平台的本地状态：最后地址、是否曾保存过会话、是否由用户退出 ---------- */
const statePath = () => path.join(app.getPath('userData'), 'creator-state.json');
let state = {};
function loadState() { try { state = JSON.parse(fs.readFileSync(statePath(), 'utf8')) || {}; } catch { state = {}; } }
let saveTimer = null;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch { /* 忽略 */ } }, 300);
}
function saveStateNow() { clearTimeout(saveTimer); try { fs.writeFileSync(statePath(), JSON.stringify(state, null, 2)); } catch { /* 忽略 */ } }

const sessions = () => Object.keys(CENTERS).map((id) => [id, session.fromPartition(partitionOf(id))]);
function idForSession(ses) { const hit = sessions().find(([, s]) => s === ses); return hit ? hit[0] : null; }
async function flushAll() { await Promise.all(sessions().map(([, s]) => s.cookies.flushStore().catch(() => {}))); }

/** 只统计该平台域名下未过期 Cookie 的数量，不读取、不返回任何 Cookie 值。 */
async function cookieCount(id) {
  const list = await session.fromPartition(partitionOf(id)).cookies.get({});
  const now = Date.now() / 1000;
  return list.filter((c) => hostOk(String(c.domain || '').replace(/^\./, ''), CENTERS[id]) && (!c.expirationDate || c.expirationDate > now)).length;
}

async function loginStatus(id) {
  const n = await cookieCount(id);
  const st = state[id] || {};
  if (n > 0) {
    if (!st.hadSession) { state[id] = { ...st, hadSession: true, loggedOut: false }; saveState(); }
    return 'saved';
  }
  // 以前保存过会话、用户没有手动退出，现在却没有 Cookie：说明被平台（或有效期）过期了。
  return st.hadSession && !st.loggedOut ? 'expired' : 'none';
}

/* ---------- 后端 ---------- */
let server;
let dataDir;
async function startServer() {
  const port = await freePort();
  const res = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
  dataDir = path.join(app.getPath('userData'), 'data');
  server = fork(path.join(res, 'server', 'dist', 'index.js'), [], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port), HOST: '127.0.0.1', CA_DATA_DIR: dataDir, CA_WEB_DIST: path.join(res, 'web', 'dist'), CA_AGENT_DEFAULTS: path.join(res, 'agent') },
    stdio: 'inherit',
  });
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return port; } catch { /* 等待 */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('后端启动失败');
}

/* ---------- 本地应用（只启动用户自己登记的 App；不操控 App 内任何界面） ---------- */
const SCHEME_RE = /^[a-z][a-z0-9+.-]{1,40}:\/\/[^\s<>"']{0,500}$/i;
const BAD_SCHEMES = /^(javascript|data|vbscript|file|about|blob|http|https|ms-settings|shell)\b/i;
const validProtocol = (p) => typeof p === 'string' && SCHEME_RE.test(p) && !BAD_SCHEMES.test(p);
function validExec(p) {
  if (typeof p !== 'string' || !p || p.length > 1024 || p.includes('..') || !path.isAbsolute(p)) return false;
  if (process.platform === 'win32') return /\.(exe|lnk)$/i.test(p) && fs.existsSync(p);
  if (process.platform === 'darwin') return /\.app\/?$/.test(p) && fs.existsSync(p);
  return fs.existsSync(p) && fs.statSync(p).isFile();
}
async function launch({ execPath, protocol }) {
  if (execPath) {
    if (!validExec(execPath)) return { ok: false, error: '应用路径无效或不存在' };
    const err = await shell.openPath(execPath);
    return err ? { ok: false, error: err } : { ok: true };
  }
  if (protocol) {
    if (!validProtocol(protocol)) return { ok: false, error: '协议格式不正确' };
    await shell.openExternal(protocol);
    return { ok: true };
  }
  return { ok: false, error: '没有可启动的路径或协议' };
}

async function createWindow() {
  const port = await startServer();
  const origin = `http://127.0.0.1:${port}`;
  const win = new BrowserWindow({
    width: 1360, height: 880, title: '超级工作台',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true },
  });
  // 只接受来自主界面的 IPC 请求
  const fromUi = (e) => { try { return new URL(e.senderFrame.url).origin === origin; } catch { return false; } };
  const guard = (fn) => async (e, ...args) => { if (!fromUi(e)) throw new Error('拒绝：来源不是主界面'); return fn(...args); };

  ipcMain.handle('ca:open-external', guard(async (url) => { if (typeof url === 'string' && /^https:\/\//.test(url)) await shell.openExternal(url); }));
  ipcMain.handle('creator:last-url', guard(async (id) => (validId(id) && state[id]?.lastUrl && allowed(state[id].lastUrl) ? state[id].lastUrl : null)));
  ipcMain.handle('creator:status', guard(async (ids) => {
    const out = {};
    for (const id of (Array.isArray(ids) ? ids : Object.keys(CENTERS)).filter(validId)) out[id] = await loginStatus(id);
    return out;
  }));
  // 唯一的清除登录入口：用户在界面上点击“退出登录/清除登录”并确认。
  ipcMain.handle('creator:logout', guard(async (id) => {
    if (!validId(id)) throw new Error('未知平台');
    const ses = session.fromPartition(partitionOf(id));
    await ses.clearStorageData();
    await ses.clearCache();
    await ses.cookies.flushStore().catch(() => {});
    state[id] = { loggedOut: true, hadSession: false };
    saveStateNow();
    return { ok: true };
  }));
  ipcMain.handle('localapp:pick', guard(async () => {
    const mac = process.platform === 'darwin';
    const r = await dialog.showOpenDialog(win, {
      title: '选择应用', defaultPath: mac ? '/Applications' : undefined,
      properties: ['openFile'],
      filters: mac ? [{ name: '应用', extensions: ['app'] }] : process.platform === 'win32' ? [{ name: '应用', extensions: ['exe', 'lnk'] }] : [],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  }));
  ipcMain.handle('localapp:launch', guard(async (opts) => launch(opts || {})));
  /** 分享草稿到应用：复制文字 → 打开草稿素材文件夹 → 启动应用。粘贴与发布由用户本人完成。 */
  ipcMain.handle('localapp:share', guard(async (opts) => {
    const { text, draftId, execPath, protocol } = opts || {};
    if (typeof text === 'string' && text) clipboard.writeText(text);
    let mediaDir = null;
    if (Number.isInteger(draftId) && draftId > 0) {
      const d = path.join(dataDir, 'media', String(draftId));
      if (fs.existsSync(d)) { mediaDir = d; await shell.openPath(d); }
    }
    const r = execPath || protocol ? await launch({ execPath, protocol }) : { ok: true };
    return { ...r, copied: Boolean(text), mediaDir };
  }));

  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    const part = String(params.partition || '');
    const id = part.replace(/^persist:creator-/, '');
    if (!allowed(params.src) || !part.startsWith('persist:creator-') || !validId(id)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  await win.loadURL(`${origin}/`);
}

app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => { if (allowed(url)) contents.loadURL(url); else if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  // 每次跳转：记住最后地址 + 把 Cookie 落盘
  const remember = (_ev, url) => {
    const id = idForSession(contents.session);
    if (!id) return;
    if (allowed(url)) { state[id] = { ...(state[id] || {}), lastUrl: url, loggedOut: false }; saveState(); }
    contents.session.cookies.flushStore().catch(() => {});
  };
  contents.on('did-navigate', remember);
  contents.on('did-navigate-in-page', remember);
});

let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  saveStateNow();
  flushAll().finally(() => app.quit());
});

app.whenReady().then(() => {
  loadState();
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'notifications' || perm === 'clipboard-sanitized-write'));
  setInterval(() => { flushAll(); }, 60000).unref?.();
  return createWindow();
});
app.on('window-all-closed', () => { if (server) server.kill(); app.quit(); });
