const net = require('net');
const EventEmitter = require('events');

// Verbindet zwei feste PCs im LAN: hört auf einem Port UND versucht aktiv,
// sich zum Partner zu verbinden. Welche Richtung zuerst zustande kommt, gewinnt;
// die jeweils andere/überflüssige Verbindung wird verworfen (Dedup).
class P2PLink extends EventEmitter {
  constructor({ listenPort, peerHost, peerPort }) {
    super();
    this.listenPort = listenPort;
    this.peerHost = peerHost;
    this.peerPort = peerPort;
    this.activeSocket = null;
    this.server = null;
    this.reconnectTimer = null;
    this.buffer = '';
    this.stopped = false;
  }

  start() {
    this.stopped = false;
    this._startServer();
    this._scheduleConnect(0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    if (this.server) this.server.close();
    if (this.activeSocket) this.activeSocket.destroy();
  }

  isConnected() {
    return !!(this.activeSocket && !this.activeSocket.destroyed);
  }

  send(obj) {
    if (!this.isConnected()) return false;
    this.activeSocket.write(JSON.stringify(obj) + '\n');
    return true;
  }

  _startServer() {
    this.server = net.createServer((socket) => {
      this._adoptSocket(socket, 'inbound');
    });
    this.server.on('error', (err) => this.emit('error', err));
    this.server.listen(this.listenPort, '0.0.0.0');
  }

  _scheduleConnect(delayMs) {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._tryConnect(), delayMs);
  }

  _tryConnect() {
    if (this.stopped || this.isConnected()) {
      this._scheduleConnect(2000);
      return;
    }
    const socket = net.createConnection({ host: this.peerHost, port: this.peerPort });
    socket.once('connect', () => this._adoptSocket(socket, 'outbound'));
    socket.once('error', () => {
      socket.destroy();
      this._scheduleConnect(2000);
    });
  }

  _adoptSocket(socket, direction) {
    if (this.isConnected()) {
      // Bereits verbunden - überflüssige Verbindung verwerfen
      socket.destroy();
      return;
    }
    this.activeSocket = socket;
    this.buffer = '';
    this.emit('status', { connected: true, direction });

    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          this.emit('message', JSON.parse(line));
        } catch (e) {
          // ungültige Zeile ignorieren
        }
      }
    });

    const onClose = () => {
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.emit('status', { connected: false });
        this._scheduleConnect(1000);
      }
    };
    socket.on('close', onClose);
    socket.on('error', onClose);
  }
}

module.exports = { P2PLink };
