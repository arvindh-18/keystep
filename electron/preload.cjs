const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('keystepNative', {
  platform: process.platform,
  fetchBytes: async (url) => { const u = await ipcRenderer.invoke('fetch-bytes', url); return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength); },
  fetchText: (url) => ipcRenderer.invoke('fetch-text', url),
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, f) => cb(f.name, f.bytes)),
});
