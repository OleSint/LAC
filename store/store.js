const fs = require('fs');
const path = require('path');

class JsonStore {
  constructor(userDataPath) {
    this.settingsPath = path.join(userDataPath, 'settings.json');
    this.historyPath = path.join(userDataPath, 'history.json');
  }

  loadSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  saveSettings(settings) {
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }

  loadHistory() {
    try {
      return JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
    } catch (e) {
      return [];
    }
  }

  appendMessage(msg) {
    const history = this.loadHistory();
    history.push(msg);
    fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
    return history;
  }

  clearHistory() {
    fs.writeFileSync(this.historyPath, JSON.stringify([], null, 2));
  }

  updateMessage(id, patch) {
    const history = this.loadHistory();
    const idx = history.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    history[idx] = { ...history[idx], ...patch };
    fs.writeFileSync(this.historyPath, JSON.stringify(history, null, 2));
    return history[idx];
  }
}

module.exports = { JsonStore };
