// HTTP + WebSocket entry point.
//   - serves the client, the shared game modules and the three.js build
//   - runs matchmaking and every live online room

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import { NET } from '../shared/constants.js';
import { MODES, MODE_ORDER } from '../shared/modes.js';
import { MAP_DEFS } from '../shared/maps.js';
import { Matchmaker } from './matchmaker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 8080;

const app = express();
// The same file layout the static host (GitHub Pages) serves, so the game
// behaves identically whether it is run from here or from a static deploy.
app.use('/shared', express.static(path.join(ROOT, 'shared'), { extensions: ['js'] }));
app.use('/vendor', express.static(path.join(ROOT, 'vendor')));
app.use('/client', express.static(path.join(ROOT, 'client')));
app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));

app.get('/api/info', (_req, res) => {
  res.json({
    protocol: NET.protocolVersion,
    online: clients.size,
    modes: MODE_ORDER.map((id) => ({ id, name: MODES[id].name, online: !!MODES[id].online })),
    maps: MAP_DEFS.length,
    ...mm.stats(),
  });
});

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const mm = new Matchmaker({ log });
const clients = new Set();
let nextClientId = 1;

class Client {
  constructor(ws) {
    this.ws = ws;
    this.id = nextClientId++;
    this.name = `Soldier${this.id}`;
    this.room = null;
    this.entityId = null;
    this.queueEntry = null;
    this.alive = true;
    this.lastSeen = Date.now();
    this.lastSeq = 0;
  }

  send(obj) {
    if (this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(obj)); } catch { /* socket closing */ }
  }
}

wss.on('connection', (ws) => {
  const client = new Client(ws);
  clients.add(client);
  mm.onlineCount = clients.size;
  client.send({ t: 'welcome', id: client.id, protocol: NET.protocolVersion, online: clients.size });
  broadcastPresence();

  ws.on('message', (raw) => {
    client.lastSeen = Date.now();
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    handle(client, msg);
  });

  ws.on('close', () => {
    client.alive = false;
    clients.delete(client);
    mm.onlineCount = clients.size;
    mm.dequeue(client);
    if (client.room) client.room.removeClient(client);
    broadcastPresence();
  });

  ws.on('error', () => { /* handled by close */ });
});

function handle(client, msg) {
  switch (msg.t) {
    case 'hello': {
      const name = String(msg.name || '').trim().slice(0, NET.maxNameLength);
      if (name) client.name = name;
      client.send({ t: 'hello_ok', id: client.id, name: client.name, online: clients.size });
      break;
    }
    case 'queue': {
      if (!MODES[msg.mode] || !MODES[msg.mode].online) {
        client.send({ t: 'error', msg: '온라인 모드가 아닙니다.' });
        return;
      }
      if (client.room) client.room.removeClient(client);
      try { mm.enqueue(client, msg.mode, msg.loadout); } catch (e) {
        client.send({ t: 'error', msg: String(e.message) });
      }
      break;
    }
    case 'cancel_queue':
      mm.dequeue(client);
      client.send({ t: 'queue_cancelled' });
      break;
    case 'input':
      if (client.room) client.room.handleInput(client, msg);
      break;
    case 'loadout':
      if (client.room) {
        const ent = client.room.sim.entities.get(client.entityId);
        if (ent) ent.pendingLoadout = msg.loadout;
      }
      break;
    case 'leave':
      if (client.room) client.room.removeClient(client);
      mm.dequeue(client);
      client.send({ t: 'left' });
      break;
    case 'chat': {
      const text = String(msg.text || '').slice(0, 120);
      if (client.room && text) {
        client.room.broadcast({ t: 'chat', from: client.name, team: client.team, text });
      }
      break;
    }
    case 'ping':
      client.send({ t: 'pong', c: msg.c, s: Date.now() });
      break;
    default:
      break;
  }
}

function broadcastPresence() {
  const payload = JSON.stringify({ t: 'presence', online: clients.size, ...mm.stats() });
  for (const c of clients) {
    if (c.room) continue;                       // in-match clients do not need it
    if (c.ws.readyState === 1) c.ws.send(payload);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const c of clients) {
    if (now - c.lastSeen > NET.timeoutMs) {
      try { c.ws.terminate(); } catch { /* already gone */ }
    }
  }
}, NET.heartbeatMs);

server.listen(PORT, () => {
  log(`FPS server listening on http://localhost:${PORT}`);
  log(`${MAP_DEFS.length} maps, ${MODE_ORDER.length} modes ready`);
});

export { app, server, mm };
