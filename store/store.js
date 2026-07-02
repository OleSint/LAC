const fs = require('fs');
const path = require('path');

// Verwaltet ein Profil (eigene Identität + Kontaktliste) und pro Kontakt einen
// getrennten Chatverlauf. Jeder Kontakt bekommt eine eigene history-Datei,
// identifiziert über seine deviceId.
class JsonStore {
  constructor(userDataPath) {
    this.root = userDataPath;
    this.profilePath = path.join(userDataPath, 'profile.json');
    this.historyDir = path.join(userDataPath, 'history');
    fs.mkdirSync(this.historyDir, { recursive: true });
  }

  loadProfile() {
    try {
      return JSON.parse(fs.readFileSync(this.profilePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  saveProfile(profile) {
    fs.writeFileSync(this.profilePath, JSON.stringify(profile, null, 2));
  }

  _historyPath(contactId) {
    return path.join(this.historyDir, `${contactId}.json`);
  }

  loadHistory(contactId) {
    try {
      return JSON.parse(fs.readFileSync(this._historyPath(contactId), 'utf8'));
    } catch (e) {
      return [];
    }
  }

  appendMessage(contactId, msg) {
    const history = this.loadHistory(contactId);
    history.push(msg);
    fs.writeFileSync(this._historyPath(contactId), JSON.stringify(history, null, 2));
    return history;
  }

  clearHistory(contactId) {
    fs.writeFileSync(this._historyPath(contactId), JSON.stringify([], null, 2));
  }

  updateMessage(contactId, id, patch) {
    const history = this.loadHistory(contactId);
    const idx = history.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    history[idx] = { ...history[idx], ...patch };
    fs.writeFileSync(this._historyPath(contactId), JSON.stringify(history, null, 2));
    return history[idx];
  }

  deleteMessage(contactId, id) {
    const history = this.loadHistory(contactId);
    const idx = history.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    const [removed] = history.splice(idx, 1);
    fs.writeFileSync(this._historyPath(contactId), JSON.stringify(history, null, 2));
    return removed;
  }

  mediaDirFor(contactId) {
    const dir = path.join(this.root, 'media', contactId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

module.exports = { JsonStore };
