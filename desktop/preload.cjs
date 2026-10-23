// 沙箱预加载脚本：只向界面暴露最小能力，全部经主进程校验（主进程只接受主界面来源的请求）。
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('contentAgent', {
  isElectron: true,
  platform: process.platform,
  openExternal: (url) => { if (/^https:\/\//.test(url)) ipcRenderer.invoke('ca:open-external', url); },
  creator: {
    lastUrl: (id) => ipcRenderer.invoke('creator:last-url', id),
    status: (ids) => ipcRenderer.invoke('creator:status', ids),
    logout: (id) => ipcRenderer.invoke('creator:logout', id),
  },
  // 0.8.0 内嵌浏览器（WebContentsView 由主进程管理；这里只转发矩形与导航指令，收状态事件）
  browser: {
    open: (o) => ipcRenderer.invoke('browser:open', o),
    show: (o) => ipcRenderer.invoke('browser:show', o),
    destroy: (o) => ipcRenderer.invoke('browser:destroy', o),
    hideAll: () => ipcRenderer.invoke('browser:hideAll'),
    setBounds: (r) => ipcRenderer.invoke('browser:setBounds', r),
    setVisible: (v) => ipcRenderer.invoke('browser:setVisible', !!v),
    nav: (o) => ipcRenderer.invoke('browser:nav', o),
    clear: (o) => ipcRenderer.invoke('browser:clear', o),
    onState: (fn) => ipcRenderer.on('browser:state', (_e, s) => fn(s)),
    onError: (fn) => ipcRenderer.on('browser:error', (_e, s) => fn(s)),
    onSendToAgent: (fn) => ipcRenderer.on('browser:send-to-agent', (_e, s) => fn(s)),
  },
  // 0.10.0 Key 加密（系统钥匙串）：只暴露加解密，不暴露密钥
  safeStorage: {
    available: () => ipcRenderer.invoke('safe:available'),
    encrypt: (s) => ipcRenderer.invoke('safe:encrypt', s),
    decrypt: (b) => ipcRenderer.invoke('safe:decrypt', b),
  },
  localApp: {
    pick: () => ipcRenderer.invoke('localapp:pick'),
    launch: (opts) => ipcRenderer.invoke('localapp:launch', opts),
    share: (opts) => ipcRenderer.invoke('localapp:share', opts),
  },
});
