const profileScreen = document.getElementById('profile-screen');
const appLayout = document.getElementById('app-layout');
const sidebar = document.getElementById('sidebar');
const ownSettingsScreen = document.getElementById('own-settings-screen');
const emptyState = document.getElementById('empty-state');
const chatScreen = document.getElementById('chat-screen');
const mediaScreen = document.getElementById('media-screen');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const contactsListEl = document.getElementById('contactsList');
const nearbyListEl = document.getElementById('nearbyList');

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

let profile = null;
let contacts = [];
let nearby = [];
let onlineIds = new Set();
let unreadCounts = {}; // contactId -> Anzahl ungelesener Nachrichten

let currentContactId = null;
let allMessages = [];
let activeQuery = '';
let currentMatchIndex = -1;
let pendingReply = null;

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

// ---------- Bootstrapping ----------

async function init() {
  profile = await window.lac.getProfile();
  if (!profile) {
    profileScreen.classList.remove('hidden');
    return;
  }
  profileScreen.classList.add('hidden');
  await enterApp();
}

document.getElementById('saveProfile').addEventListener('click', async () => {
  const displayName = document.getElementById('displayName').value.trim();
  if (!displayName) {
    alert('Bitte einen Namen eingeben.');
    return;
  }
  profile = await window.lac.saveProfile({ displayName });
  profileScreen.classList.add('hidden');
  await enterApp();
});

// ---------- App-Layout (Seitenleiste + Hauptbereich) ----------

async function enterApp() {
  appLayout.classList.remove('hidden');
  showEmptyState();
  restoreSidebarState();
  await refreshContacts();
  await refreshNearby();
}

function restoreSidebarState() {
  const collapsed = localStorage.getItem('lac.sidebarCollapsed') === '1';
  sidebar.classList.toggle('collapsed', collapsed);
  updateExpandButtons();
}

function toggleSidebar() {
  const collapsed = sidebar.classList.toggle('collapsed');
  localStorage.setItem('lac.sidebarCollapsed', collapsed ? '1' : '0');
  updateExpandButtons();
}

function updateExpandButtons() {
  const collapsed = sidebar.classList.contains('collapsed');
  document.getElementById('sidebarExpandBtnEmpty').classList.toggle('hidden', !collapsed);
  document.getElementById('sidebarExpandBtnChat').classList.toggle('hidden', !collapsed);
}

document.getElementById('sidebarCollapseBtn').addEventListener('click', toggleSidebar);
document.getElementById('sidebarExpandBtnEmpty').addEventListener('click', toggleSidebar);
document.getElementById('sidebarExpandBtnChat').addEventListener('click', toggleSidebar);

function showEmptyState() {
  chatScreen.classList.add('hidden');
  mediaScreen.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

// ---------- Kontaktliste ----------

async function refreshContacts() {
  contacts = await window.lac.listContacts();
  onlineIds = new Set(contacts.filter((c) => c.online).map((c) => c.id));
  renderContacts();
}

async function refreshNearby() {
  nearby = await window.lac.listDiscovered();
  renderNearby();
}

// Verschiebt draggedId direkt vor targetId in der lokalen Kontaktliste (Drag & Drop).
function reorderLocalContacts(draggedId, targetId) {
  const fromIdx = contacts.findIndex((c) => c.id === draggedId);
  if (fromIdx === -1) return;
  const [moved] = contacts.splice(fromIdx, 1);
  const toIdx = contacts.findIndex((c) => c.id === targetId);
  contacts.splice(toIdx === -1 ? contacts.length : toIdx, 0, moved);
}

function renderContacts() {
  contactsListEl.innerHTML = '';
  if (!contacts.length) {
    const empty = document.createElement('div');
    empty.className = 'contacts-empty';
    empty.textContent = 'Noch keine Kontakte. Schau unten bei "In der Nähe gefunden".';
    contactsListEl.appendChild(empty);
    return;
  }
  contacts.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'contact-item' + (c.id === currentContactId ? ' active' : '');
    item.dataset.id = c.id;
    item.draggable = true;
    item.addEventListener('dragstart', (e) => {
      item.classList.add('dragging');
      e.dataTransfer.setData('text/plain', c.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => item.classList.remove('dragging'));
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
    item.addEventListener('drop', async (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === c.id) return;
      reorderLocalContacts(draggedId, c.id);
      renderContacts();
      await window.lac.reorderContacts(contacts.map((x) => x.id));
    });

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar';
    avatar.textContent = initials(c.name);

    const info = document.createElement('div');
    info.className = 'contact-info';
    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = c.name;
    const status = document.createElement('div');
    status.className = 'contact-status' + (c.online ? ' online' : '');
    status.textContent = c.online ? 'Online' : 'Offline';
    info.appendChild(name);
    info.appendChild(status);

    item.appendChild(avatar);
    item.appendChild(info);

    const unread = unreadCounts[c.id] || 0;
    if (unread > 0) {
      const badge = document.createElement('div');
      badge.className = 'contact-unread';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      item.appendChild(badge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'contact-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Kontakt entfernen';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.lac.removeContact(c.id);
      await refreshContacts();
      await refreshNearby();
    });
    item.appendChild(removeBtn);

    item.addEventListener('click', () => openChat(c));
    contactsListEl.appendChild(item);
  });
}

function renderNearby() {
  nearbyListEl.innerHTML = '';
  if (!nearby.length) {
    const empty = document.createElement('div');
    empty.className = 'contacts-empty';
    empty.textContent = 'Gerade nichts in der Nähe gefunden.';
    nearbyListEl.appendChild(empty);
    return;
  }
  nearby.forEach((d) => {
    const item = document.createElement('div');
    item.className = 'contact-item';

    const avatar = document.createElement('div');
    avatar.className = 'contact-avatar';
    avatar.textContent = initials(d.name);

    const info = document.createElement('div');
    info.className = 'contact-info';
    const name = document.createElement('div');
    name.className = 'contact-name';
    name.textContent = d.name;
    const status = document.createElement('div');
    status.className = 'contact-status';
    status.textContent = d.host;
    info.appendChild(name);
    info.appendChild(status);

    item.appendChild(avatar);
    item.appendChild(info);

    const addBtn = document.createElement('button');
    addBtn.className = 'nearby-add-btn';
    addBtn.textContent = '+ Hinzufügen';
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await window.lac.addDiscoveredContact(d);
      await refreshContacts();
      await refreshNearby();
    });
    item.appendChild(addBtn);

    nearbyListEl.appendChild(item);
  });
}

document.getElementById('showManualAdd').addEventListener('click', () => {
  document.getElementById('manualAddForm').classList.toggle('hidden');
});

document.getElementById('manualAddBtn').addEventListener('click', async () => {
  const name = document.getElementById('manualName').value.trim();
  const host = document.getElementById('manualHost').value.trim();
  const port = document.getElementById('manualPort').value.trim() || '53911';
  const errorEl = document.getElementById('manualAddError');
  errorEl.classList.add('hidden');

  if (!host) {
    errorEl.textContent = 'Bitte eine IP-Adresse eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }

  const result = await window.lac.addManualContact({ name, host, port });
  if (!result.ok) {
    errorEl.textContent = result.error;
    errorEl.classList.remove('hidden');
    return;
  }

  document.getElementById('manualName').value = '';
  document.getElementById('manualHost').value = '';
  document.getElementById('manualPort').value = '';
  document.getElementById('manualAddForm').classList.add('hidden');
  await refreshContacts();
});

// ---------- Eigenes Profil ----------

document.getElementById('ownSettingsBtn').addEventListener('click', async () => {
  ownSettingsScreen.classList.remove('hidden');
  document.getElementById('ownDisplayName').value = profile.displayName || '';
  document.getElementById('ownPortsHint').textContent =
    `Lausch-Port: ${profile.listenPort} · Discovery-Port: ${profile.discoveryPort}`;
});

document.getElementById('ownSettingsBack').addEventListener('click', () => {
  ownSettingsScreen.classList.add('hidden');
});

document.getElementById('saveOwnSettings').addEventListener('click', async () => {
  const displayName = document.getElementById('ownDisplayName').value.trim();
  if (!displayName) return;
  profile = await window.lac.saveProfile({ displayName });
  ownSettingsScreen.classList.add('hidden');
});

// ---------- Chat ----------

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
    const url = match[1];
    const a = document.createElement('a');
    a.className = 'msg-link';
    a.textContent = url;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      window.lac.openLink(url);
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

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'bubble-reply-btn';
  deleteBtn.textContent = '🗑';
  deleteBtn.title = 'Nachricht löschen';
  deleteBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const ok = await window.lac.deleteMessage(currentContactId, msg.id);
    if (ok) removeMessageFromView(msg.id);
  });
  footer.appendChild(deleteBtn);

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

function removeMessageFromView(id) {
  const idx = allMessages.findIndex((m) => m.id === id);
  if (idx !== -1) allMessages.splice(idx, 1);
  const bubble = messagesEl.querySelector(`[data-id="${id}"]`);
  if (bubble) bubble.remove();
  if (activeQuery.trim()) updateSearchCount();
}

function setChatStatus(contact) {
  const online = onlineIds.has(contact.id);
  statusDot.classList.toggle('connected', online);
  statusText.textContent = `${contact.name}${online ? '' : ' (offline)'}`;
}

async function openChat(contact) {
  currentContactId = contact.id;
  unreadCounts[contact.id] = 0;

  emptyState.classList.add('hidden');
  mediaScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  renderContacts();

  setChatStatus(contact);
  clearPendingReply();
  activeQuery = '';
  searchInput.value = '';
  searchBar.classList.add('hidden');

  allMessages = await window.lac.getHistory(contact.id);
  renderAll();
  messageInput.focus();
}

document.getElementById('clearChatBtn').addEventListener('click', async () => {
  if (!currentContactId) return;
  const ok = confirm('Wirklich alle Nachrichten in diesem Chat löschen?\n\nDer Chat und der Kontakt bleiben erhalten, nur die Nachrichten und angehängten Dateien werden entfernt.');
  if (!ok) return;
  await window.lac.clearHistory(currentContactId);
  allMessages = [];
  renderAll();
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
  if (!text || !currentContactId) return;
  messageInput.value = '';
  const replyTo = pendingReply;
  clearPendingReply();
  const stored = await window.lac.sendMessage(currentContactId, text, replyTo);
  addMessage(stored);
}

document.getElementById('sendBtn').addEventListener('click', sendCurrentMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendCurrentMessage();
});

document.getElementById('attachBtn').addEventListener('click', async () => {
  if (!currentContactId) return;
  const replyTo = pendingReply;
  const stored = await window.lac.sendFile(currentContactId, replyTo);
  if (stored) {
    clearPendingReply();
    addMessage(stored);
  }
});

// Bilder aus der Zwischenablage (z.B. Screenshots) direkt einfügen und senden.
async function handlePasteEvent(e) {
  if (!currentContactId) return;
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
      const stored = await window.lac.sendClipboardImage(currentContactId, bytes, item.type, replyTo);
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

window.lac.onIncoming(({ contactId, message }) => {
  if (contactId === currentContactId) {
    addMessage(message);
  } else {
    unreadCounts[contactId] = (unreadCounts[contactId] || 0) + 1;
    renderContacts();
  }
});

window.lac.onDeleted(({ contactId, id }) => {
  if (contactId === currentContactId) removeMessageFromView(id);
});

window.lac.onContactAdded((contact) => {
  if (!contacts.find((c) => c.id === contact.id)) {
    contacts.push({ ...contact, online: true });
    renderContacts();
  }
});

window.lac.onContactStatus(({ contactId, connected }) => {
  if (connected) onlineIds.add(contactId);
  else onlineIds.delete(contactId);

  const idx = contacts.findIndex((c) => c.id === contactId);
  if (idx !== -1) contacts[idx].online = connected;

  if (contactId === currentContactId) {
    const contact = contacts.find((c) => c.id === contactId);
    if (contact) setChatStatus(contact);
  }
  renderContacts();
});

window.lac.onDiscoveryFound(() => {
  refreshNearby();
});

window.lac.onDiscoveryLost(() => {
  refreshNearby();
});

window.lac.onPreview(({ contactId, id, preview }) => {
  if (contactId !== currentContactId) return;
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
  if (!currentContactId) return;
  chatScreen.classList.add('hidden');
  mediaScreen.classList.remove('hidden');
  const data = await window.lac.getMedia(currentContactId);
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
    const data = await window.lac.getMedia(currentContactId);
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
