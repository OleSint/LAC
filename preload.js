const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lac', {
  getProfile: () => ipcRenderer.invoke('profile:get'),
  saveProfile: (data) => ipcRenderer.invoke('profile:save', data),

  listContacts: () => ipcRenderer.invoke('contacts:list'),
  removeContact: (id) => ipcRenderer.invoke('contacts:remove', id),
  addDiscoveredContact: (info) => ipcRenderer.invoke('contacts:addDiscovered', info),
  addManualContact: (info) => ipcRenderer.invoke('contacts:addManual', info),
  reorderContacts: (ids) => ipcRenderer.invoke('contacts:reorder', ids),
  listDiscovered: () => ipcRenderer.invoke('discovery:list'),

  getHistory: (contactId) => ipcRenderer.invoke('history:get', contactId),
  clearHistory: (contactId) => ipcRenderer.invoke('history:clear', contactId),
  getMedia: (contactId) => ipcRenderer.invoke('media:list', contactId),

  sendMessage: (contactId, text, replyTo) => ipcRenderer.invoke('chat:send', contactId, text, replyTo),
  sendFile: (contactId, replyTo) => ipcRenderer.invoke('chat:sendFile', contactId, replyTo),
  sendClipboardImage: (contactId, bytes, mime, replyTo) =>
    ipcRenderer.invoke('chat:sendClipboardImage', contactId, bytes, mime, replyTo),
  deleteMessage: (contactId, id) => ipcRenderer.invoke('chat:delete', contactId, id),

  openFile: (filePath) => ipcRenderer.invoke('file:open', filePath),
  openLink: (url) => ipcRenderer.invoke('link:open', url),

  onIncoming: (callback) => ipcRenderer.on('chat:incoming', (event, data) => callback(data)),
  onPreview: (callback) => ipcRenderer.on('chat:preview', (event, data) => callback(data)),
  onDeleted: (callback) => ipcRenderer.on('chat:deleted', (event, data) => callback(data)),
  onContactStatus: (callback) => ipcRenderer.on('contact:status', (event, data) => callback(data)),
  onContactAdded: (callback) => ipcRenderer.on('contact:added', (event, data) => callback(data)),
  onDiscoveryFound: (callback) => ipcRenderer.on('discovery:found', (event, data) => callback(data)),
  onDiscoveryLost: (callback) => ipcRenderer.on('discovery:lost', (event, data) => callback(data)),
  onHubError: (callback) => ipcRenderer.on('hub:error', (event, data) => callback(data)),
});
