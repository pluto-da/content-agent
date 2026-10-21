// 只向界面暴露两个最小能力：识别桌面端、用系统浏览器打开外部链接。
const { contextBridge, shell } = require('electron');
contextBridge.exposeInMainWorld('contentAgent', {
  isElectron: true,
  openExternal: (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); },
});
