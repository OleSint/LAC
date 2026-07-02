const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { PeerHub } = require('./net/hub');
const { JsonStore } = require('./store/store');
const { extractFirstUrl, fetchLinkPreview } = require('./net/linkPreview');

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB Soft-Limit für LAN-Transfer
const DEFAULT_LISTEN_PORT = 53911;
const DEFAULT_DISCOVERY_PORT = 53910;

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

// Sicherheitsnetz: ohne diesen Handler kann eine nicht abgefangene Exception den
// Prozess unsichtbar (ohne Fenster) am Leben halten, z.B. durch offene Timer/Sockets.
process.on('uncaughtException', (err) => {
  try {
    dialog.showErrorBox('LAC - Unerwarteter Fehler', `${err.message}\n\nLAC wird jetzt beendet.`);
  } catch (e) {
    // Dialog kann in seltenen Fällen selbst fehlschlagen - trotzdem beenden.
  }
  app.exit(1);
});

let mainWindow;
let hub = null;
let store;
let profile = null;

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

function findContact(id) {
  return profile.contacts.find((c) => c.id === id) || null;
}

function saveProfile() {
  store.saveProfile(profile);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 420,
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
  createWindow();

  profile = store.loadProfile();
  if (profile) {
    startHub();
  }
});

app.on('window-all-closed', () => {
  if (hub) hub.stop();
  app.quit();
});

function startHub() {
  if (hub) hub.stop();
  hub = new PeerHub({
    deviceId: profile.deviceId,
    displayName: profile.displayName,
    listenPort: profile.listenPort,
    discoveryPort: profile.discoveryPort,
  });

  hub.on('error', (err) => {
    safeSend('hub:error', { message: err.message });
  });

  hub.on('status', (status) => {
    // Verbindet sich jemand Unbekanntes mit uns (z.B. weil er uns zuerst als Kontakt
    // hinzugefügt hat), legen wir automatisch einen Kontakt an - sonst würde die
    // Unterhaltung im Verlauf landen, ohne in der Kontaktliste sichtbar zu sein.
    if (status.connected && !findContact(status.deviceId)) {
      const info = hub.getDiscoveredInfo(status.deviceId);
      const contact = {
        id: status.deviceId,
        name: status.name || (info && info.name) || 'Unbekannt',
        host: (info && info.host) || null,
        port: (info && info.port) || null,
      };
      profile.contacts.push(contact);
      saveProfile();
      safeSend('contact:added', contact);
    }
    safeSend('contact:status', { contactId: status.deviceId, connected: status.connected });
  });

  hub.on('message', ({ deviceId, msg }) => {
    handlePeerMessage(deviceId, msg);
  });

  hub.on('discovered', (info) => {
    if (!findContact(info.deviceId)) safeSend('discovery:found', info);
  });

  hub.on('discovery-lost', ({ deviceId }) => {
    safeSend('discovery:lost', { deviceId });
  });

  hub.start();

  profile.contacts.forEach((contact) => {
    hub.watchContact(contact.id, contact.host, contact.port);
  });
}

function handlePeerMessage(contactId, msg) {
  const contact = findContact(contactId);
  const senderName = contact ? contact.name : 'Unbekannt';

  if (msg.type === 'chat') {
    const stored = {
      id: msg.id,
      from: 'peer',
      kind: 'text',
      text: msg.text,
      senderName,
      ts: msg.ts,
    };
    if (msg.replyTo) stored.replyTo = msg.replyTo;
    store.appendMessage(contactId, stored);
    safeSend('chat:incoming', { contactId, message: stored });
    triggerLinkPreview(contactId, stored);
    notifyIncoming();
  } else if (msg.type === 'file') {
    const stored = receiveFile(contactId, senderName, msg);
    safeSend('chat:incoming', { contactId, message: stored });
    notifyIncoming();
  } else if (msg.type === 'delete') {
    const removed = store.deleteMessage(contactId, msg.id);
    if (removed && removed.kind === 'file' && removed.path) {
      try { fs.unlinkSync(removed.path); } catch (e) { /* Datei ggf. schon weg */ }
    }
    safeSend('chat:deleted', { contactId, id: msg.id });
  }
}

function receiveFile(contactId, senderName, msg) {
  const mediaDir = store.mediaDirFor(contactId);
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
    senderName,
    ts: msg.ts,
  };
  if (msg.replyTo) stored.replyTo = msg.replyTo;
  store.appendMessage(contactId, stored);
  return stored;
}

// Best-effort Linkvorschau: läuft asynchron im Hintergrund, blockiert das Senden/Empfangen nicht
// und scheitert lautlos, wenn der PC gerade kein Internet hat.
function triggerLinkPreview(contactId, storedMessage) {
  const url = extractFirstUrl(storedMessage.text);
  if (!url) return;
  fetchLinkPreview(url).then((preview) => {
    if (!preview) return;
    store.updateMessage(contactId, storedMessage.id, { preview });
    safeSend('chat:preview', { contactId, id: storedMessage.id, preview });
  });
}

function buildAndSendFile(contactId, buffer, name, mime, replyTo) {
  const mediaDir = store.mediaDirFor(contactId);
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
  const sent = hub ? hub.send(contactId, msg) : false;

  const stored = {
    id,
    from: 'me',
    kind: 'file',
    name,
    mime,
    size: buffer.length,
    path: localPath,
    fileUrl: pathToFileURL(localPath).href,
    senderName: profile.displayName,
    ts: msg.ts,
    sent,
  };
  if (replyTo) stored.replyTo = replyTo;
  store.appendMessage(contactId, stored);
  return stored;
}

ipcMain.handle('profile:get', () => profile);

ipcMain.handle('profile:save', (event, { displayName }) => {
  if (!profile) {
    profile = {
      deviceId: crypto.randomUUID(),
      displayName,
      listenPort: DEFAULT_LISTEN_PORT,
      discoveryPort: DEFAULT_DISCOVERY_PORT,
      contacts: [],
    };
  } else {
    profile.displayName = displayName;
  }
  saveProfile();
  if (hub) hub.updateIdentity({ displayName });
  else startHub();
  return profile;
});

ipcMain.handle('contacts:list', () => {
  return profile.contacts.map((c) => ({ ...c, online: hub ? hub.isConnected(c.id) : false }));
});

ipcMain.handle('contacts:remove', (event, id) => {
  profile.contacts = profile.contacts.filter((c) => c.id !== id);
  saveProfile();
  if (hub) hub.unwatchContact(id);
  return true;
});

ipcMain.handle('contacts:addDiscovered', (event, { deviceId, name, host, port }) => {
  if (findContact(deviceId)) return { ok: false, error: 'Bereits als Kontakt hinzugefügt.' };
  const contact = { id: deviceId, name, host, port };
  profile.contacts.push(contact);
  saveProfile();
  if (hub) hub.watchContact(deviceId, host, port);
  return { ok: true, contact };
});

ipcMain.handle('contacts:addManual', async (event, { name, host, port }) => {
  if (!hub) return { ok: false, error: 'Noch nicht bereit.' };
  try {
    const { deviceId, name: remoteName } = await hub.dialAndAdd(host, parseInt(port, 10));
    if (findContact(deviceId)) return { ok: false, error: 'Bereits als Kontakt hinzugefügt.' };
    const contact = { id: deviceId, name: name || remoteName || 'Unbenannt', host, port: parseInt(port, 10) };
    profile.contacts.push(contact);
    saveProfile();
    return { ok: true, contact };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('discovery:list', () => {
  if (!hub) return [];
  return hub.listDiscovered().filter((d) => !findContact(d.deviceId));
});

// Persistiert eine neue Reihenfolge der Kontaktliste (Drag & Drop in der Seitenleiste).
ipcMain.handle('contacts:reorder', (event, orderedIds) => {
  const byId = new Map(profile.contacts.map((c) => [c.id, c]));
  const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  profile.contacts.forEach((c) => {
    if (!orderedIds.includes(c.id)) reordered.push(c);
  });
  profile.contacts = reordered;
  saveProfile();
  return true;
});

ipcMain.handle('history:get', (event, contactId) => {
  return store.loadHistory(contactId);
});

ipcMain.handle('history:clear', (event, contactId) => {
  // Angehängte Mediendateien mit löschen, sonst blieben sie verwaist auf der Platte.
  const history = store.loadHistory(contactId);
  history.forEach((msg) => {
    if (msg.kind === 'file' && msg.path) {
      try { fs.unlinkSync(msg.path); } catch (e) { /* Datei ggf. schon weg */ }
    }
  });
  store.clearHistory(contactId);
  return true;
});

ipcMain.handle('media:list', (event, contactId) => {
  const history = store.loadHistory(contactId);
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

ipcMain.handle('chat:send', (event, contactId, text, replyTo) => {
  const msg = {
    id: crypto.randomUUID(),
    type: 'chat',
    text,
    ts: Date.now(),
  };
  if (replyTo) msg.replyTo = replyTo;
  const sent = hub ? hub.send(contactId, msg) : false;
  const stored = { id: msg.id, from: 'me', kind: 'text', text, senderName: profile.displayName, ts: msg.ts, sent };
  if (replyTo) stored.replyTo = replyTo;
  store.appendMessage(contactId, stored);
  triggerLinkPreview(contactId, stored);
  return stored;
});

ipcMain.handle('chat:sendFile', async (event, contactId, replyTo) => {
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

  return buildAndSendFile(contactId, buffer, name, mime, replyTo);
});

ipcMain.handle('chat:sendClipboardImage', (event, contactId, bytes, mime, replyTo) => {
  if (!bytes || !bytes.length) return null;
  if (bytes.length > MAX_FILE_BYTES) {
    dialog.showErrorBox('Bild zu groß', `Maximal ${MAX_FILE_BYTES / 1024 / 1024} MB sind erlaubt.`);
    return null;
  }
  const buffer = Buffer.from(bytes);
  const ext = MIME_EXT[mime] || '.png';
  const name = `clipboard-${Date.now()}${ext}`;
  return buildAndSendFile(contactId, buffer, name, mime || 'image/png', replyTo);
});

ipcMain.handle('chat:delete', (event, contactId, id) => {
  const removed = store.deleteMessage(contactId, id);
  if (!removed) return false;

  if (removed.kind === 'file' && removed.path) {
    try { fs.unlinkSync(removed.path); } catch (e) { /* Datei ggf. schon weg */ }
  }

  // Löschen wirkt immer für beide Seiten - unabhängig davon, wer die Nachricht
  // ursprünglich gesendet hat. Der Partner bekommt keine Rückfrage, die Nachricht
  // verschwindet bei ihm einfach ebenfalls.
  if (hub) hub.send(contactId, { type: 'delete', id });

  return true;
});

ipcMain.handle('file:open', (event, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle('link:open', (event, url) => {
  shell.openExternal(url);
});
