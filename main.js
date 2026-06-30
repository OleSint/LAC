const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { P2PLink } = require('./net/p2p');
const { JsonStore } = require('./store/store');
const { extractFirstUrl, fetchLinkPreview } = require('./net/linkPreview');

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB Soft-Limit für LAN-Transfer

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
};

let mainWindow;
let link = null;
let store;
let mediaDir;
let currentSettings = null;
let peerName = null; // zuletzt bekannter Anzeigename des Partners (per Handshake ausgetauscht)

function safeSend(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Macht per Taskleisten-Blinken (Windows/Linux) bzw. Dock-Hüpfen (macOS) auf eine
// neue Nachricht aufmerksam, wenn das Fenster nicht fokussiert ist.
function notifyIncoming() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFocused()) return;
  mainWindow.flashFrame(true);
}

function myName() {
  return (currentSettings && currentSettings.displayName) || 'Ich';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    minWidth: 360,
    minHeight: 480,
    title: 'LAC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Verhindert, dass irgendein Link (z.B. via Mittelklick-Standardverhalten) ein
  // zweites, ungeschütztes LAC-Fenster ohne Preload öffnet. Externe URLs gehen
  // stattdessen immer über shell.openExternal in den Standardbrowser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('focus', () => {
    mainWindow.flashFrame(false);
  });
}

app.whenReady().then(() => {
  store = new JsonStore(app.getPath('userData'));
  mediaDir = path.join(app.getPath('userData'), 'media');
  fs.mkdirSync(mediaDir, { recursive: true });
  createWindow();

  const settings = store.loadSettings();
  if (settings) {
    currentSettings = settings;
    peerName = settings.peerDisplayName || null;
    startLink(settings);
  }
});

app.on('window-all-closed', () => {
  if (link) link.stop();
  app.quit();
});

function startLink(settings) {
  if (link) link.stop();
  link = new P2PLink({
    listenPort: settings.listenPort,
    peerHost: settings.peerHost,
    peerPort: settings.peerPort,
  });

  link.on('status', (status) => {
    safeSend('link:status', status);
    if (status.connected) {
      link.send({ type: 'hello', name: myName() });
    }
  });

  link.on('message', (msg) => {
    if (msg.type === 'hello') {
      peerName = msg.name || 'Partner';
      if (currentSettings) {
        currentSettings.peerDisplayName = peerName;
        store.saveSettings(currentSettings);
      }
      safeSend('peer:name', { name: peerName });
    } else if (msg.type === 'chat') {
      const stored = {
        id: msg.id,
        from: 'peer',
        kind: 'text',
        text: msg.text,
        senderName: peerName || 'Partner',
        ts: msg.ts,
      };
      if (msg.replyTo) stored.replyTo = msg.replyTo;
      store.appendMessage(stored);
      safeSend('chat:incoming', stored);
      triggerLinkPreview(stored);
      notifyIncoming();
    } else if (msg.type === 'file') {
      const stored = receiveFile(msg);
      safeSend('chat:incoming', stored);
      notifyIncoming();
    }
  });

  link.start();
}

function receiveFile(msg) {
  const buffer = Buffer.from(msg.data, 'base64');
  const safeName = `${msg.id}_${path.basename(msg.name)}`;
  const filePath = path.join(mediaDir, safeName);
  fs.writeFileSync(filePath, buffer);
  const stored = {
    id: msg.id,
    from: 'peer',
    kind: 'file',
    name: msg.name,
    mime: msg.mime,
    size: msg.size,
    path: filePath,
    fileUrl: pathToFileURL(filePath).href,
    senderName: peerName || 'Partner',
    ts: msg.ts,
  };
  if (msg.replyTo) stored.replyTo = msg.replyTo;
  store.appendMessage(stored);
  return stored;
}

// Best-effort Linkvorschau: läuft asynchron im Hintergrund, blockiert das Senden/Empfangen nicht
// und scheitert lautlos, wenn der PC gerade kein Internet hat.
function triggerLinkPreview(storedMessage) {
  const url = extractFirstUrl(storedMessage.text);
  if (!url) return;
  fetchLinkPreview(url).then((preview) => {
    if (!preview) return;
    store.updateMessage(storedMessage.id, { preview });
    safeSend('chat:preview', { id: storedMessage.id, preview });
  });
}

function buildAndSendFile(buffer, name, mime, replyTo) {
  const id = crypto.randomUUID();
  const localPath = path.join(mediaDir, `${id}_${name}`);
  fs.writeFileSync(localPath, buffer);

  const msg = {
    id,
    type: 'file',
    name,
    mime,
    size: buffer.length,
    data: buffer.toString('base64'),
    ts: Date.now(),
  };
  if (replyTo) msg.replyTo = replyTo;
  const sent = link ? link.send(msg) : false;

  const stored = {
    id,
    from: 'me',
    kind: 'file',
    name,
    mime,
    size: buffer.length,
    path: localPath,
    fileUrl: pathToFileURL(localPath).href,
    senderName: myName(),
    ts: msg.ts,
    sent,
  };
  if (replyTo) stored.replyTo = replyTo;
  store.appendMessage(stored);
  return stored;
}

ipcMain.handle('settings:get', () => {
  return store.loadSettings();
});

ipcMain.handle('settings:save', (event, settings) => {
  const existing = store.loadSettings() || {};
  const merged = { ...existing, ...settings };
  currentSettings = merged;
  store.saveSettings(merged);
  startLink(merged);
  return true;
});

ipcMain.handle('history:get', () => {
  return store.loadHistory();
});

ipcMain.handle('history:clear', () => {
  store.clearHistory();
  return true;
});

ipcMain.handle('link:status', () => {
  return { connected: link ? link.isConnected() : false };
});

ipcMain.handle('peer:get', () => {
  return { name: peerName };
});

ipcMain.handle('media:list', () => {
  const history = store.loadHistory();
  const images = [];
  const documents = [];
  const links = [];

  history.forEach((msg) => {
    if (msg.kind === 'file') {
      if (msg.mime && msg.mime.startsWith('image/')) images.push(msg);
      else documents.push(msg);
    } else if (msg.kind === 'text' || !msg.kind) {
      const url = extractFirstUrl(msg.text || '');
      if (url) links.push({ ...msg, url });
    }
  });

  return { images, documents, links };
});

ipcMain.handle('chat:send', (event, text, replyTo) => {
  const msg = {
    id: crypto.randomUUID(),
    type: 'chat',
    text,
    ts: Date.now(),
  };
  if (replyTo) msg.replyTo = replyTo;
  const sent = link ? link.send(msg) : false;
  const stored = { id: msg.id, from: 'me', kind: 'text', text, senderName: myName(), ts: msg.ts, sent };
  if (replyTo) stored.replyTo = replyTo;
  store.appendMessage(stored);
  triggerLinkPreview(stored);
  return stored;
});

ipcMain.handle('chat:sendFile', async (event, replyTo) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Datei senden',
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const sourcePath = result.filePaths[0];
  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_FILE_BYTES) {
    dialog.showErrorBox('Datei zu groß', `Maximal ${MAX_FILE_BYTES / 1024 / 1024} MB sind erlaubt.`);
    return null;
  }

  const name = path.basename(sourcePath);
  const ext = path.extname(name).toLowerCase();
  const mime = IMAGE_MIME[ext] || 'application/octet-stream';
  const buffer = fs.readFileSync(sourcePath);

  return buildAndSendFile(buffer, name, mime, replyTo);
});

ipcMain.handle('chat:sendClipboardImage', (event, bytes, mime, replyTo) => {
  if (!bytes || !bytes.length) return null;
  if (bytes.length > MAX_FILE_BYTES) {
    dialog.showErrorBox('Bild zu groß', `Maximal ${MAX_FILE_BYTES / 1024 / 1024} MB sind erlaubt.`);
    return null;
  }
  const buffer = Buffer.from(bytes);
  const ext = MIME_EXT[mime] || '.png';
  const name = `clipboard-${Date.now()}${ext}`;
  return buildAndSendFile(buffer, name, mime || 'image/png', replyTo);
});

ipcMain.handle('file:open', (event, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle('link:open', (event, url) => {
  shell.openExternal(url);
});
