const net = require('net');
const dgram = require('dgram');
const os = require('os');
const EventEmitter = require('events');

const DISCOVERY_MAGIC = 'lac-discover-v1';
const DISCOVERY_INTERVAL_MS = 3000;
const DISCOVERY_TTL_MS = 10000; // nach dieser Zeit ohne neue Ankündigung gilt ein Gerät als offline

// Verwaltet alle Netzwerk-Aspekte für mehrere gleichzeitige Kontakte:
// - EIN gemeinsamer TCP-Listener nimmt Verbindungen von beliebigen Partnern an
// - EIN UDP-Broadcast kündigt die eigene Präsenz im LAN an und lauscht auf andere
// - Eingehende/ausgehende Verbindungen werden per "hello"-Handschlag (deviceId)
//   eindeutig einem Kontakt zugeordnet, unabhängig davon, wer wen zuerst erreicht hat.
class PeerHub extends EventEmitter {
  constructor({ deviceId, displayName, listenPort, discoveryPort }) {
    super();
    this.deviceId = deviceId;
    this.displayName = displayName;
    this.listenPort = listenPort;
    this.discoveryPort = discoveryPort;

    this.server = null;
    this.udp = null;
    this.discoveryTimer = null;
    this.staleCheckTimer = null;

    this.sockets = new Map(); // deviceId -> { socket, buffer }
    this.pendingSockets = new Set(); // Sockets ohne bestätigte deviceId (warten auf hello)
    this.contactsByDeviceId = new Map(); // deviceId -> { host, port } - bekannte Kontakte zum aktiven Verbinden
    this.reconnectTimers = new Map(); // deviceId -> Timer
    this.discovered = new Map(); // deviceId -> { name, host, port, lastSeen }

    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this._startServer();
    this._startDiscovery();
    this.staleCheckTimer = setInterval(() => this._pruneStaleDiscoveries(), 2000);
  }

  stop() {
    this.stopped = true;
    clearInterval(this.discoveryTimer);
    clearInterval(this.staleCheckTimer);
    this.reconnectTimers.forEach((t) => clearTimeout(t));
    this.reconnectTimers.clear();
    if (this.server) this.server.close();
    if (this.udp) {
      try { this.udp.close(); } catch (e) { /* schon zu */ }
    }
    this.sockets.forEach(({ socket }) => socket.destroy());
    this.sockets.clear();
    this.pendingSockets.forEach((s) => s.destroy());
    this.pendingSockets.clear();
  }

  updateIdentity({ displayName }) {
    if (displayName) this.displayName = displayName;
  }

  isConnected(deviceId) {
    return this.sockets.has(deviceId);
  }

  send(deviceId, obj) {
    const entry = this.sockets.get(deviceId);
    if (!entry) return false;
    entry.socket.write(JSON.stringify(obj) + '\n');
    return true;
  }

  // Registriert einen bekannten Kontakt zum aktiven Verbindungsaufbau (z.B. nach dem
  // Hinzufügen oder beim Programmstart für alle gespeicherten Kontakte).
  watchContact(deviceId, host, port) {
    this.contactsByDeviceId.set(deviceId, { host, port });
    if (!this.isConnected(deviceId)) this._tryConnect(deviceId);
  }

  unwatchContact(deviceId) {
    this.contactsByDeviceId.delete(deviceId);
    clearTimeout(this.reconnectTimers.get(deviceId));
    this.reconnectTimers.delete(deviceId);
    const entry = this.sockets.get(deviceId);
    if (entry) entry.socket.destroy();
  }

  listDiscovered() {
    return Array.from(this.discovered.entries()).map(([deviceId, info]) => ({
      deviceId,
      name: info.name,
      host: info.host,
      port: info.port,
    }));
  }

  getDiscoveredInfo(deviceId) {
    return this.discovered.get(deviceId) || null;
  }

  // Einmaliger, expliziter Verbindungsversuch zu host:port (manuelles Hinzufügen als
  // Fallback, falls Auto-Discovery im Netzwerk nicht funktioniert, z.B. wegen
  // geblocktem Broadcast). Lernt die deviceId des Gegenübers per Handschlag und
  // registriert danach eine reguläre, dauerhafte Verbindung dafür.
  dialAndAdd(host, port, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let buffer = '';
      const socket = net.createConnection({ host, port });

      const cleanup = () => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.destroy();
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Zeitüberschreitung - Gerät nicht erreichbar'));
      }, timeoutMs);

      socket.once('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });

      socket.once('connect', () => {
        socket.write(JSON.stringify({ type: 'hello', deviceId: this.deviceId, name: this.displayName }) + '\n');
      });

      socket.on('data', (chunk) => {
        if (settled) return;
        buffer += chunk.toString('utf8');
        const idx = buffer.indexOf('\n');
        if (idx === -1) return;
        const line = buffer.slice(0, idx);
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'hello' && msg.deviceId) {
            settled = true;
            cleanup();
            this.watchContact(msg.deviceId, host, port);
            resolve({ deviceId: msg.deviceId, name: msg.name });
            return;
          }
        } catch (e) {
          // ungültige Antwort, unten als Fehler behandelt
        }
        settled = true;
        cleanup();
        reject(new Error('Ungültige Antwort vom Gerät'));
      });
    });
  }

  _startServer() {
    this.server = net.createServer((socket) => this._adoptRawSocket(socket));
    this.server.on('error', (err) => this.emit('error', err));
    this.server.listen(this.listenPort, '0.0.0.0');
  }

  _tryConnect(deviceId) {
    if (this.stopped) return;
    const target = this.contactsByDeviceId.get(deviceId);
    if (!target || this.isConnected(deviceId)) return;

    const socket = net.createConnection({ host: target.host, port: target.port });
    socket.once('connect', () => this._adoptRawSocket(socket, deviceId));
    socket.once('error', () => {
      socket.destroy();
      this._scheduleReconnect(deviceId);
    });
  }

  _scheduleReconnect(deviceId) {
    if (this.stopped || !this.contactsByDeviceId.has(deviceId)) return;
    clearTimeout(this.reconnectTimers.get(deviceId));
    const timer = setTimeout(() => this._tryConnect(deviceId), 3000);
    this.reconnectTimers.set(deviceId, timer);
  }

  // Neue Verbindung (eingehend ohne bekannte deviceId, oder ausgehend mit bekannter
  // deviceId) - wartet auf den "hello"-Handschlag, um sie final zuzuordnen.
  _adoptRawSocket(socket, knownDeviceId) {
    this.pendingSockets.add(socket);
    let buffer = '';

    const finalize = (deviceId, name) => {
      this.pendingSockets.delete(socket);

      const existing = this.sockets.get(deviceId);
      if (existing) {
        // Bereits verbunden - überflüssige Verbindung verwerfen (Dedup wie zuvor)
        socket.destroy();
        return;
      }

      this.sockets.set(deviceId, { socket, buffer: '' });
      clearTimeout(this.reconnectTimers.get(deviceId));
      this.emit('status', { deviceId, name, connected: true });

      socket.on('data', (chunk) => this._onData(deviceId, chunk));

      const onClose = () => {
        if (this.sockets.get(deviceId)?.socket === socket) {
          this.sockets.delete(deviceId);
          this.emit('status', { deviceId, connected: false });
          this._scheduleReconnect(deviceId);
        }
      };
      socket.on('close', onClose);
      socket.on('error', onClose);
    };

    socket.write(JSON.stringify({ type: 'hello', deviceId: this.deviceId, name: this.displayName }) + '\n');

    socket.on('data', function onHandshakeData(chunk) {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx);
      const rest = buffer.slice(idx + 1);
      socket.removeListener('data', onHandshakeData);
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'hello' && msg.deviceId) {
          finalize(msg.deviceId, msg.name);
          if (rest) socket.emit('data', Buffer.from(rest, 'utf8'));
          return;
        }
      } catch (e) {
        // ungültiger Handschlag
      }
      socket.destroy();
    });

    socket.once('error', () => this.pendingSockets.delete(socket));
    socket.once('close', () => this.pendingSockets.delete(socket));
  }

  _onData(deviceId, chunk) {
    const entry = this.sockets.get(deviceId);
    if (!entry) return;
    entry.buffer += chunk.toString('utf8');
    let idx;
    while ((idx = entry.buffer.indexOf('\n')) >= 0) {
      const line = entry.buffer.slice(0, idx);
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      try {
        this.emit('message', { deviceId, msg: JSON.parse(line) });
      } catch (e) {
        // ungültige Zeile ignorieren
      }
    }
  }

  _startDiscovery() {
    this.udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.udp.on('error', (err) => this.emit('error', err));
    this.udp.on('message', (buf, rinfo) => this._onDiscoveryMessage(buf, rinfo));

    this.udp.bind(this.discoveryPort, () => {
      try {
        this.udp.setBroadcast(true);
      } catch (e) {
        // Broadcast evtl. nicht verfügbar (z.B. bestimmte VPN-Adapter) - Discovery
        // fällt dann einfach aus, manuelles Hinzufügen per IP bleibt möglich.
      }
      this._announce();
      this.discoveryTimer = setInterval(() => this._announce(), DISCOVERY_INTERVAL_MS);
    });
  }

  _announce() {
    if (!this.udp) return;
    const payload = Buffer.from(JSON.stringify({
      magic: DISCOVERY_MAGIC,
      deviceId: this.deviceId,
      name: this.displayName,
      port: this.listenPort,
    }));
    this._broadcastAddresses().forEach((addr) => {
      this.udp.send(payload, this.discoveryPort, addr, () => {});
    });
  }

  _broadcastAddresses() {
    const addrs = new Set(['255.255.255.255']);
    const interfaces = os.networkInterfaces();
    Object.values(interfaces).forEach((entries) => {
      (entries || []).forEach((entry) => {
        if (entry.family === 'IPv4' && !entry.internal && entry.netmask) {
          addrs.add(computeBroadcast(entry.address, entry.netmask));
        }
      });
    });
    return Array.from(addrs);
  }

  _onDiscoveryMessage(buf, rinfo) {
    let data;
    try {
      data = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      return;
    }
    if (data.magic !== DISCOVERY_MAGIC || !data.deviceId || data.deviceId === this.deviceId) return;

    const host = rinfo ? rinfo.address : data.host;
    const wasKnown = this.discovered.has(data.deviceId);
    this.discovered.set(data.deviceId, { name: data.name, host, port: data.port, lastSeen: Date.now() });

    if (!wasKnown) {
      this.emit('discovered', { deviceId: data.deviceId, name: data.name, host, port: data.port });
    }

    // Ist dieses Gerät bereits ein Kontakt, IP/Port bei Änderung (z.B. neue DHCP-Lease)
    // automatisch aktualisieren und ggf. sofort verbinden.
    if (this.contactsByDeviceId.has(data.deviceId)) {
      const current = this.contactsByDeviceId.get(data.deviceId);
      if (current.host !== host || current.port !== data.port) {
        this.contactsByDeviceId.set(data.deviceId, { host, port: data.port });
      }
      if (!this.isConnected(data.deviceId)) this._tryConnect(data.deviceId);
    }
  }

  _pruneStaleDiscoveries() {
    const now = Date.now();
    for (const [deviceId, info] of this.discovered.entries()) {
      if (now - info.lastSeen > DISCOVERY_TTL_MS) {
        this.discovered.delete(deviceId);
        this.emit('discovery-lost', { deviceId });
      }
    }
  }
}

function computeBroadcast(address, netmask) {
  const addrParts = address.split('.').map(Number);
  const maskParts = netmask.split('.').map(Number);
  const broadcastParts = addrParts.map((part, i) => (part | (~maskParts[i] & 0xff)) & 0xff);
  return broadcastParts.join('.');
}

module.exports = { PeerHub };
