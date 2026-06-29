const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lac', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  getHistory: () => ipcRenderer.invoke('history:get'),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  getLinkStatus: () => ipcRenderer.invoke('link:status'),
  getPeer: () => ipcRenderer.invoke('peer:get'),
  getMedia: () => ipcRenderer.invoke('media:list'),
  sendMessage: (text, replyTo) => ipcRenderer.invoke('chat:send', text, replyTo),
  sendFile: (replyTo) => ipcRenderer.invoke('chat:sendFile', replyTo),
  sendClipboardImage: (bytes, mime, replyTo) => ipcRenderer.invoke('chat:sendClipboardImage', bytes, mime, replyTo),
  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  onIncoming: (callback) => ipcRenderer.on('chat:incoming', (event, msg) => callback(msg)),
  onStatus: (callback) => ipcRenderer.on('link:status', (event, status) => callback(status)),
  onPreview: (callback) => ipcRenderer.on('chat:preview', (event, data) => callback(data)),
  onPeerName: (callback) => ipcRenderer.on('peer:name', (event, data) => callback(data)),
});
