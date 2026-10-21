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
  localApp: {
    pick: () => ipcRenderer.invoke('localapp:pick'),
    launch: (opts) => ipcRenderer.invoke('localapp:launch', opts),
    share: (opts) => ipcRenderer.invoke('localapp:share', opts),
  },
});
