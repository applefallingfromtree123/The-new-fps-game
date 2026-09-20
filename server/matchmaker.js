// Matchmaking queues for the online modes.
//
// online_duel   : strict 1v1, waits for a real opponent, then offers an AI
//                 opponent once the search times out.
// online_12v12  : fills a 24 player lobby; late joiners drop into a running
//                 match by taking over a bot slot.

import { getMode, randomMapFor } from '../shared/modes.js';
import { Room } from './room.js';

export class Matchmaker {
  constructor(opts = {}) {
    this.queues = new Map();        // modeId -> [entry]
    this.rooms = new Map();         // roomId -> Room
    this.log = opts.log || (() => {});
    this.timer = setInterval(() => this.tick(), 500);
  }

  enqueue(client, modeId, loadoutId) {
    const mode = getMode(modeId);
    if (!mode.online) throw new Error('not an online mode');
    this.dequeue(client);
    if (!this.queues.has(modeId)) this.queues.set(modeId, []);
    const entry = { client, loadoutId, since: Date.now(), modeId };
    this.queues.get(modeId).push(entry);
    client.queueEntry = entry;
    this.log(`[mm] ${client.name} queued for ${modeId} (${this.queues.get(modeId).length} waiting)`);
    this.sendStatus(modeId);
  }

  dequeue(client) {
    if (!client.queueEntry) return;
    const q = this.queues.get(client.queueEntry.modeId);
    if (q) {
      const i = q.indexOf(client.queueEntry);
      if (i >= 0) q.splice(i, 1);
    }
    const mode = client.queueEntry.modeId;
    client.queueEntry = null;
    this.sendStatus(mode);
  }

  sendStatus(modeId) {
    const q = this.queues.get(modeId) || [];
    const mode = getMode(modeId);
    const needed = mode.teamSize * 2;
    for (const entry of q) {
      entry.client.send({
        t: 'queue',
        mode: modeId,
        waiting: q.length,
        needed,
        elapsed: Math.round((Date.now() - entry.since) / 1000),
        timeout: mode.searchTimeout,
        online: this.onlineCount,
      });
    }
  }

  get onlineCount() { return this._online || 0; }
  set onlineCount(v) { this._online = v; }

  tick() {
    for (const [modeId, q] of this.queues) {
      if (q.length === 0) continue;
      const mode = getMode(modeId);
      const capacity = mode.teamSize * 2;
      const waited = (Date.now() - q[0].since) / 1000;

      if (modeId === 'online_duel') {
        if (q.length >= 2) {
          const pair = q.splice(0, 2);
          this.startRoom(modeId, pair, false);
        } else if (waited >= mode.searchTimeout) {
          // no human opponent turned up: offer an AI duel so play never stalls
          const solo = q.splice(0, 1);
          this.startRoom(modeId, solo, true);
        }
        continue;
      }

      // large online mode: drop players into a running match when one has room
      const joinable = [...this.rooms.values()].find(
        (r) => r.modeId === modeId && !r.closed && !r.endsAt && r.playerCount < capacity,
      );
      if (joinable && (q.length < capacity || waited > 2)) {
        const group = q.splice(0, capacity - joinable.playerCount);
        for (const e of group) {
          this.dequeueEntry(e);
          joinable.addClient(e.client, e.loadoutId);
        }
        continue;
      }
      if (q.length >= capacity || waited >= mode.searchTimeout) {
        const group = q.splice(0, capacity);
        this.startRoom(modeId, group, mode.botFill);
      }
    }
    for (const [id, room] of this.rooms) if (room.closed) this.rooms.delete(id);
  }

  dequeueEntry(entry) {
    entry.client.queueEntry = null;
  }

  startRoom(modeId, entries, withBots) {
    const mapId = randomMapFor(modeId);
    const room = new Room(modeId, {
      mapId,
      log: this.log,
      onEmpty: (r) => this.rooms.delete(r.id),
    });
    this.rooms.set(room.id, room);
    for (const e of entries) {
      this.dequeueEntry(e);
      e.client.send({ t: 'match_found', mode: modeId, map: mapId, withBots: !!withBots, players: entries.length });
    }
    // brief "match found" beat before the players are dropped in
    setTimeout(() => {
      if (room.closed) return;
      for (const e of entries) {
        if (!e.client.alive) continue;
        room.addClient(e.client, e.loadoutId);
      }
      if (withBots) room.fillBots();
      room.broadcast({ t: 'roster', roster: room.roster() });
    }, 1500);
    this.log(`[mm] room ${room.id} ${modeId} on ${mapId} with ${entries.length} human(s), bots=${withBots}`);
    return room;
  }

  stats() {
    return {
      rooms: this.rooms.size,
      queues: Object.fromEntries([...this.queues].map(([k, v]) => [k, v.length])),
      players: [...this.rooms.values()].reduce((n, r) => n + r.playerCount, 0),
    };
  }

  stop() { clearInterval(this.timer); }
}
