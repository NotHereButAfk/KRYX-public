// Thin WebSocket client for the shared 24/7 match-state server (see /server).
// Fully optional: with no URL configured, or if the connection ever fails,
// every method here is a safe no-op — the game falls back to the local-only
// ServerSim simulation exactly as it behaved before this existed.

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS  = 20000;

export class NetClient {
  constructor(url) {
    this.url = url || '';
    this.enabled = !!this.url;
    this.ws = null;
    this.connected = false;
    this.selfId = null;
    this.matchStart = null;
    this.matchDurationMs = null;
    this.mapId = null;
    this.roster = []; // [{id, name, kills, score}], includes self
    this._reconnectDelay = RECONNECT_BASE_MS;
    this._name = 'Recruit';

    this.onState = null;     // (matchStart, matchDurationMs, roster) => void
    this.onKillFeed = null;  // (name) => void
    this.onJoined = null;    // (name) => void
    this.onLeft = null;      // (name) => void
  }

  connect() {
    if (!this.enabled) { console.info('[net] no VITE_WS_URL configured — using local-only match simulation'); return; }
    if (this.ws) return;
    this._open();
  }

  _open() {
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { console.warn('[net] connect failed:', e?.message); this._scheduleReconnect(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this._reconnectDelay = RECONNECT_BASE_MS;
      console.info(`[net] connected to match server ${this.url}`);
      this.sendHello(this._name);
    };
    ws.onmessage = (ev) => this._onMessage(ev);
    ws.onclose = () => {
      if (this.connected) console.warn('[net] match server connection lost — retrying in background');
      this.connected = false; this.ws = null; this._scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* onclose handles reconnect */ } };
  }

  _scheduleReconnect() {
    if (!this.enabled) return;
    setTimeout(() => this._open(), this._reconnectDelay);
    this._reconnectDelay = Math.min(RECONNECT_MAX_MS, this._reconnectDelay * 1.6);
  }

  _onMessage(ev) {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'welcome' || msg.type === 'state') {
      if (msg.type === 'welcome') this.selfId = msg.id;
      this.matchStart = msg.matchStart;
      this.matchDurationMs = msg.matchDurationMs;
      this.mapId = msg.mapId || this.mapId;
      this.roster = msg.players || [];
      this.onState?.(this.matchStart, this.matchDurationMs, this.roster, this.mapId);
    } else if (msg.type === 'kill_feed') {
      this.onKillFeed?.(msg.name);
    } else if (msg.type === 'joined') {
      this.onJoined?.(msg.name);
    } else if (msg.type === 'left') {
      this.onLeft?.(msg.name);
    }
  }

  sendHello(name) {
    this._name = name || this._name;
    this._send({ type: 'hello', name: this._name });
  }

  sendKill() {
    this._send({ type: 'kill' });
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // Other real players (excludes self).
  get others() {
    return this.roster.filter((p) => p.id !== this.selfId);
  }
}
