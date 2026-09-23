// Thin WebSocket client with reconnect and round-trip time measurement.

export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.ping = 0;
    this.online = 0;
    this.name = '';
    this.retry = 0;
    this.maxRetries = 3;
    this.gaveUp = false;
    this._pingTimer = null;
    this.serverUrl = null;
  }

  /**
   * Point the client at a matchmaking server. Accepts a bare host, an http(s)
   * URL or a ws(s) URL; the /ws path is added when missing. Empty resets to
   * the page's own origin (how the bundled `npm start` server is reached).
   */
  setServerUrl(value) {
    const raw = (value || '').trim();
    if (!raw) { this.serverUrl = null; return null; }
    let url = raw;
    if (!/^[a-z]+:\/\//i.test(url)) url = `wss://${url}`;
    url = url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    url = url.replace(/\/+$/, '');
    if (!/\/ws$/.test(url)) url += '/ws';
    this.serverUrl = url;
    return url;
  }

  /** `force` restarts the retry budget, e.g. when the player asks to play online. */
  connect(name, force = false) {
    this.name = name || this.name;
    if (force) { this.gaveUp = false; this.retry = 0; }
    if (this.gaveUp && !force) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = this.serverUrl || `${proto}//${location.host}/ws`;
    try {
      this.ws = new WebSocket(url);
    } catch {
      this._scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this.retry = 0;
      this.send({ t: 'hello', name: this.name });
      this._pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 3000);
      this.emit('open');
    };
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this._pingTimer);
      this.emit('close');
      this._scheduleRetry();
    };
    this.ws.onerror = () => { /* close follows */ };
    this.ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'pong') {
        this.ping = Math.round(performance.now() - msg.c);
        return;
      }
      if (msg.t === 'welcome' || msg.t === 'hello_ok') {
        this.id = msg.id;
        if (typeof msg.online === 'number') this.online = msg.online;
      }
      if (msg.t === 'presence') this.online = msg.online;
      this.emit(msg.t, msg);
      this.emit('*', msg);
    };
  }

  _scheduleRetry() {
    if (this._retryTimer) return;
    if (this.retry >= this.maxRetries) {
      // No server answering: this is a static deploy, so stop hammering it.
      this.gaveUp = true;
      this.emit('unavailable');
      return;
    }
    const delay = Math.min(4000, 800 * 2 ** this.retry++);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.connect();
    }, delay);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  on(type, fn) {
    const wrapped = (e) => fn(e.detail);
    this.addEventListener(type, wrapped);
    return () => this.removeEventListener(type, wrapped);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== 1) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  close() {
    clearInterval(this._pingTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
    this.connected = false;
  }
}

export const net = new Net();
