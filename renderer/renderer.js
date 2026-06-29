const settingsScreen = document.getElementById('settings-screen');
const chatScreen = document.getElementById('chat-screen');
const mediaScreen = document.getElementById('media-screen');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');
const mediaContent = document.getElementById('mediaContent');
const replyBar = document.getElementById('replyBar');
const replyBarName = document.getElementById('replyBarName');
const replyBarText = document.getElementById('replyBarText');
const emojiPanel = document.getElementById('emojiPanel');
const emojiBtn = document.getElementById('emojiBtn');

const URL_RE = /(https?:\/\/[^\s<>"']+)/i;

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😜', '🤔', '😎',
  '😢', '😭', '😡', '👍', '👎', '👏', '🙏', '💪', '🔥', '🎉',
  '❤️', '💔', '✅', '❌', '⭐', '🚀', '😴', '🤝', '👋', '🙌',
  '😇', '🥳', '🤩', '😏', '😅', '😬', '🤯', '😱', '🥺', '😤',
  '🤗', '👀', '💯', '🎂', '☕', '🍕', '⚽', '🎮', '📷', '🎵',
];

let allMessages = [];
let activeQuery = '';
let currentMatchIndex = -1;
let connected = false;
let peerName = null;
let pendingReply = null;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function buildHighlightedFragment(text, query) {
  const frag = document.createDocumentFragment();
  if (!query) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let pos = 0;
  let idx = lower.indexOf(q);
  if (idx === -1) {
    frag.appendChild(document.createTextNode(text));
    return frag;
  }
  while (idx !== -1) {
    if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + q.length);
    frag.appendChild(mark);
    pos = idx + q.length;
    idx = lower.indexOf(q, pos);
  }
  if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
  return frag;
}

function renderTextWithLinks(container, text, highlightQuery) {
  const re = new RegExp(URL_RE, 'gi');
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(buildHighlightedFragment(text.slice(lastIndex, match.index), highlightQuery));
    }
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'msg-link';
    a.textContent = match[1];
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.lac.openLink(match[1]);
    });
    container.appendChild(a);
    lastIndex = match.index + match[1].length;
  }
  if (lastIndex < text.length) {
    container.appendChild(buildHighlightedFragment(text.slice(lastIndex), highlightQuery));
  }
}

function renderPreviewCard(preview) {
  const card = document.createElement('div');
  card.className = 'link-preview';
  card.addEventListener('click', () => window.lac.openLink(preview.url));

  if (preview.image) {
    const img = document.createElement('img');
    img.className = 'preview-image';
    img.src = preview.image;
    card.appendChild(img);
  }
  const body = document.createElement('div');
  body.className = 'preview-body';
  const title = document.createElement('div');
  title.className = 'preview-title';
  title.textContent = preview.title;
  body.appendChild(title);
  if (preview.description) {
    const desc = document.createElement('div');
    desc.className = 'preview-desc';
    desc.textContent = preview.description;
    body.appendChild(desc);
  }
  card.appendChild(body);
  return card;
}

function buildReplySnippet(msg) {
  if (msg.kind === 'file') {
    return msg.mime && msg.mime.startsWith('image/') ? '📷 Bild' : '📄 ' + msg.name;
  }
  const text = msg.text || '';
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

function renderMessage(msg, highlightQuery) {
  const div = document.createElement('div');
  div.className = 'bubble ' + (msg.from === 'me' ? 'me' : 'peer');
  div.dataset.id = msg.id;

  if (msg.senderName) {
    const nameEl = document.createElement('span');
    nameEl.className = 'sender-name';
    nameEl.textContent = msg.senderName;
    div.appendChild(nameEl);
  }

  if (msg.replyTo) {
    const quote = document.createElement('div');
    quote.className = 'reply-quote';
    quote.addEventListener('click', () => {
      const target = messagesEl.querySelector(`[data-id="${msg.replyTo.id}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const qName = document.createElement('div');
    qName.className = 'reply-quote-name';
    qName.textContent = msg.replyTo.senderName || '';
    const qText = document.createElement('div');
    qText.className = 'reply-quote-text';
    qText.textContent = msg.replyTo.snippet || '';
    quote.appendChild(qName);
    quote.appendChild(qText);
    div.appendChild(quote);
  }

  if (msg.kind === 'file') {
    if (msg.mime && msg.mime.startsWith('image/')) {
      const img = document.createElement('img');
      img.className = 'media';
      img.src = msg.fileUrl || 'file://' + msg.path;
      img.addEventListener('click', () => window.lac.openFile(msg.path));
      div.appendChild(img);
    } else {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.addEventListener('click', () => window.lac.openFile(msg.path));
      const icon = document.createElement('div');
      icon.className = 'file-icon';
      icon.textContent = '📄';
      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.appendChild(buildHighlightedFragment(msg.name, highlightQuery));
      const size = document.createElement('div');
      size.className = 'file-size';
      size.textContent = fmtSize(msg.size || 0);
      info.appendChild(name);
      info.appendChild(size);
      card.appendChild(icon);
      card.appendChild(info);
      div.appendChild(card);
    }
  } else {
    const textSpan = document.createElement('div');
    renderTextWithLinks(textSpan, msg.text, highlightQuery);
    div.appendChild(textSpan);
    if (msg.preview) {
      div.appendChild(renderPreviewCard(msg.preview));
    }
  }

  const footer = document.createElement('div');
  footer.className = 'bubble-footer';

  const replyBtn = document.createElement('button');
  replyBtn.className = 'bubble-reply-btn';
  replyBtn.textContent = '↩ Antworten';
  replyBtn.title = 'Auf diese Nachricht antworten';
  replyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setPendingReply(msg);
  });
  footer.appendChild(replyBtn);

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(msg.ts);
  footer.appendChild(time);

  div.appendChild(footer);
  messagesEl.appendChild(div);
  return div;
}

function matchesQuery(msg, q) {
  const hay = msg.kind === 'file' ? (msg.name || '') : (msg.text || '');
  return hay.toLowerCase().includes(q);
}

function renderAll() {
  messagesEl.innerHTML = '';
  const q = activeQuery.trim().toLowerCase();
  allMessages.forEach((msg) => {
    if (q && !matchesQuery(msg, q)) return;
    renderMessage(msg, q || null);
  });
  updateSearchCount();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function updateSearchCount() {
  const count = messagesEl.children.length;
  searchCount.textContent = activeQuery.trim() ? `${count} Treffer` : '';
  currentMatchIndex = -1;
}

function addMessage(msg) {
  allMessages.push(msg);
  if (activeQuery.trim()) {
    renderAll();
  } else {
    renderMessage(msg, null);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

async function loadHistory() {
  allMessages = await window.lac.getHistory();
  renderAll();
}

function setStatus(isConnected) {
  connected = isConnected;
  statusDot.classList.toggle('connected', connected);
  statusText.textContent = connected ? `Verbunden${peerName ? ' mit ' + peerName : ''}` : 'Verbinde...';
}

async function showChatScreen() {
  settingsScreen.classList.add('hidden');
  mediaScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  const peer = await window.lac.getPeer();
  peerName = peer ? peer.name : null;
  await loadHistory();
  const status = await window.lac.getLinkStatus();
  setStatus(status.connected);
  messageInput.focus();
}

async function init() {
  const settings = await window.lac.getSettings();
  if (settings && settings.peerHost) {
    document.getElementById('displayName').value = settings.displayName || '';
    document.getElementById('listenPort').value = settings.listenPort;
    document.getElementById('peerHost').value = settings.peerHost;
    document.getElementById('peerPort').value = settings.peerPort;
    await showChatScreen();
  } else {
    settingsScreen.classList.remove('hidden');
    chatScreen.classList.add('hidden');
  }
}

document.getElementById('saveSettings').addEventListener('click', async () => {
  const displayName = document.getElementById('displayName').value.trim();
  const listenPort = parseInt(document.getElementById('listenPort').value, 10);
  const peerHost = document.getElementById('peerHost').value.trim();
  const peerPort = parseInt(document.getElementById('peerPort').value, 10);

  if (!peerHost || !listenPort || !peerPort) {
    alert('Bitte alle Felder ausfüllen.');
    return;
  }

  await window.lac.saveSettings({ displayName, listenPort, peerHost, peerPort });
  await showChatScreen();
});

document.getElementById('openSettings').addEventListener('click', () => {
  chatScreen.classList.add('hidden');
  settingsScreen.classList.remove('hidden');
});

function setPendingReply(msg) {
  pendingReply = { id: msg.id, senderName: msg.senderName || '', snippet: buildReplySnippet(msg) };
  replyBarName.textContent = pendingReply.senderName;
  replyBarText.textContent = pendingReply.snippet;
  replyBar.classList.remove('hidden');
  messageInput.focus();
}

function clearPendingReply() {
  pendingReply = null;
  replyBar.classList.add('hidden');
}

document.getElementById('replyBarCancel').addEventListener('click', clearPendingReply);

async function sendCurrentMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  messageInput.value = '';
  const replyTo = pendingReply;
  clearPendingReply();
  const stored = await window.lac.sendMessage(text, replyTo);
  addMessage(stored);
}

document.getElementById('sendBtn').addEventListener('click', sendCurrentMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCurrentMessage();
});

document.getElementById('attachBtn').addEventListener('click', async () => {
  const replyTo = pendingReply;
  const stored = await window.lac.sendFile(replyTo);
  if (stored) {
    clearPendingReply();
    addMessage(stored);
  }
});

// Bilder aus der Zwischenablage (z.B. Screenshots) direkt einfügen und senden.
async function handlePasteEvent(e) {
  const items = e.clipboardData ? e.clipboardData.items : null;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (!blob) continue;
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const replyTo = pendingReply;
      const stored = await window.lac.sendClipboardImage(bytes, item.type, replyTo);
      if (stored) {
        clearPendingReply();
        addMessage(stored);
      }
      return;
    }
  }
}

messageInput.addEventListener('paste', handlePasteEvent);
document.addEventListener('paste', (e) => {
  if (e.target !== messageInput) handlePasteEvent(e);
});

window.lac.onIncoming((msg) => addMessage(msg));
window.lac.onStatus((status) => setStatus(status.connected));
window.lac.onPeerName(({ name }) => {
  peerName = name;
  setStatus(connected);
});
window.lac.onPreview(({ id, preview }) => {
  const stored = allMessages.find((m) => m.id === id);
  if (stored) stored.preview = preview;
  const bubble = messagesEl.querySelector(`[data-id="${id}"]`);
  if (!bubble || bubble.querySelector('.link-preview')) return;
  const footerEl = bubble.querySelector('.bubble-footer');
  bubble.insertBefore(renderPreviewCard(preview), footerEl);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

// --- Suche ---
document.getElementById('searchBtn').addEventListener('click', () => {
  searchBar.classList.toggle('hidden');
  if (!searchBar.classList.contains('hidden')) {
    searchInput.focus();
  } else {
    activeQuery = '';
    searchInput.value = '';
    renderAll();
  }
});

searchInput.addEventListener('input', () => {
  activeQuery = searchInput.value;
  renderAll();
});

document.getElementById('searchClose').addEventListener('click', () => {
  activeQuery = '';
  searchInput.value = '';
  searchBar.classList.add('hidden');
  renderAll();
});

function scrollToMatch(index) {
  const bubbles = messagesEl.children;
  if (!bubbles.length) return;
  currentMatchIndex = ((index % bubbles.length) + bubbles.length) % bubbles.length;
  bubbles[currentMatchIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('searchNext').addEventListener('click', () => scrollToMatch(currentMatchIndex + 1));
document.getElementById('searchPrev').addEventListener('click', () => scrollToMatch(currentMatchIndex - 1));

// --- Medien & Links Übersicht ---
let currentMediaTab = 'images';

function showMediaEmpty(text) {
  const div = document.createElement('div');
  div.className = 'media-empty';
  div.textContent = text;
  mediaContent.appendChild(div);
}

function renderMediaTab(data, tab) {
  mediaContent.innerHTML = '';
  if (tab === 'images') {
    if (!data.images.length) return showMediaEmpty('Noch keine Bilder.');
    const grid = document.createElement('div');
    grid.className = 'media-grid';
    data.images.forEach((msg) => {
      const img = document.createElement('img');
      img.src = msg.fileUrl || 'file://' + msg.path;
      img.title = msg.name;
      img.addEventListener('click', () => window.lac.openFile(msg.path));
      grid.appendChild(img);
    });
    mediaContent.appendChild(grid);
  } else if (tab === 'documents') {
    if (!data.documents.length) return showMediaEmpty('Noch keine Dateien.');
    const list = document.createElement('div');
    list.className = 'media-list';
    data.documents.forEach((msg) => {
      const item = document.createElement('div');
      item.className = 'media-list-item';
      item.addEventListener('click', () => window.lac.openFile(msg.path));
      const icon = document.createElement('div');
      icon.className = 'file-icon';
      icon.textContent = '📄';
      const info = document.createElement('div');
      info.className = 'file-info';
      const name = document.createElement('div');
      name.className = 'file-name';
      name.textContent = msg.name;
      const meta = document.createElement('div');
      meta.className = 'file-meta';
      meta.textContent = fmtSize(msg.size || 0) + ' · ' + fmtTime(msg.ts);
      info.appendChild(name);
      info.appendChild(meta);
      item.appendChild(icon);
      item.appendChild(info);
      list.appendChild(item);
    });
    mediaContent.appendChild(list);
  } else if (tab === 'links') {
    if (!data.links.length) return showMediaEmpty('Noch keine Links.');
    const list = document.createElement('div');
    list.className = 'media-list';
    data.links.forEach((msg) => {
      const item = document.createElement('div');
      item.className = 'media-list-item';
      item.addEventListener('click', () => window.lac.openLink(msg.url));
      const icon = document.createElement('div');
      icon.className = 'file-icon';
      icon.textContent = '🔗';
      const info = document.createElement('div');
      info.className = 'file-info';
      const title = document.createElement('div');
      title.className = 'link-title';
      title.textContent = (msg.preview && msg.preview.title) || msg.url;
      const url = document.createElement('div');
      url.className = 'link-url';
      url.textContent = msg.url;
      info.appendChild(title);
      info.appendChild(url);
      item.appendChild(icon);
      item.appendChild(info);
      list.appendChild(item);
    });
    mediaContent.appendChild(list);
  }
}

async function openMediaScreen() {
  chatScreen.classList.add('hidden');
  mediaScreen.classList.remove('hidden');
  const data = await window.lac.getMedia();
  renderMediaTab(data, currentMediaTab);
}

document.getElementById('mediaBtn').addEventListener('click', openMediaScreen);
document.getElementById('mediaBack').addEventListener('click', () => {
  mediaScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
});

document.querySelectorAll('.media-tab').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.media-tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentMediaTab = btn.dataset.tab;
    const data = await window.lac.getMedia();
    renderMediaTab(data, currentMediaTab);
  });
});

// --- Emoji-Picker ---
function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  const pos = start + text.length;
  input.focus();
  input.setSelectionRange(pos, pos);
}

EMOJIS.forEach((emoji) => {
  const btn = document.createElement('button');
  btn.className = 'emoji-item';
  btn.textContent = emoji;
  btn.addEventListener('click', () => insertAtCursor(messageInput, emoji));
  emojiPanel.appendChild(btn);
});

emojiBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  emojiPanel.classList.toggle('hidden');
});

document.addEventListener('click', (e) => {
  if (!emojiPanel.classList.contains('hidden') && !emojiPanel.contains(e.target) && e.target !== emojiBtn) {
    emojiPanel.classList.add('hidden');
  }
});

init();
