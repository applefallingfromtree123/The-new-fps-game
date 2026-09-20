// Game modes. Offline modes fill every slot with bots; online modes go through
// matchmaking first and then backfill with bots if a lobby cannot be completed.

import { mapsBySize } from './maps.js';

export const OBJECTIVE = {
  DOMINATION: 'domination',   // hold capture points, score ticks over time
  TDM: 'tdm',                 // team deathmatch, first to the kill limit
  ROUNDS: 'rounds',           // no respawn, first team to win N rounds
};

export const MODES = {
  ground_war: {
    id: 'ground_war',
    name: '전장모드',
    en: 'Ground War',
    icon: '🌍',
    desc: '대규모 맵에서 5개 거점을 두고 벌이는 총력전. 거점을 많이 점령할수록 점수가 빠르게 오릅니다.',
    teamSize: 10,
    objective: OBJECTIVE.DOMINATION,
    scoreLimit: 500,
    timeLimit: 900,
    respawnDelay: 6,
    tickScorePerPoint: 2,     // score per second per held objective
    captureTime: 8,
    killScore: 3,
    mapPool: mapsBySize('large'),
    online: false,
    botFill: true,
  },
  clash: {
    id: 'clash',
    name: '격돌모드',
    en: 'Clash',
    icon: '⚔️',
    desc: '3개 거점을 두고 6대6으로 맞붙는 고속 거점전. 리스폰이 빠르고 교전이 끊이지 않습니다.',
    teamSize: 6,
    objective: OBJECTIVE.DOMINATION,
    scoreLimit: 250,
    timeLimit: 600,
    respawnDelay: 5,
    tickScorePerPoint: 2,
    captureTime: 6,
    killScore: 2,
    mapPool: [...mapsBySize('medium'), ...mapsBySize('small')],
    online: false,
    botFill: true,
  },
  team_12v12: {
    id: 'team_12v12',
    name: '12vs12 모드',
    en: '12v12 Warfare',
    icon: '💥',
    desc: '24명이 한 맵에서 충돌하는 대규모 팀 데스매치. 먼저 150킬을 달성한 팀이 승리합니다.',
    teamSize: 12,
    objective: OBJECTIVE.TDM,
    scoreLimit: 150,
    timeLimit: 720,
    respawnDelay: 4,
    killScore: 1,
    mapPool: [...mapsBySize('large'), ...mapsBySize('medium')],
    online: false,
    botFill: true,
  },
  duel: {
    id: 'duel',
    name: '1대1 모드',
    en: 'Duel',
    icon: '🎯',
    desc: '소형 맵에서 벌이는 1대1 결투. 라운드마다 부활 없이, 먼저 4라운드를 가져가면 승리합니다.',
    teamSize: 1,
    objective: OBJECTIVE.ROUNDS,
    roundsToWin: 4,
    roundTime: 60,
    scoreLimit: 4,
    timeLimit: 0,
    respawnDelay: 0,
    killScore: 1,
    mapPool: mapsBySize('small'),
    online: false,
    botFill: true,
  },

  // ---------------------------------------------------------- special online
  online_duel: {
    id: 'online_duel',
    name: '온라인 1vs1',
    en: 'Ranked Duel',
    icon: '🌐',
    special: true,
    desc: '매치메이킹으로 실제 상대를 찾아 겨루는 랭크 결투. 먼저 4라운드 선취 시 승리합니다.',
    teamSize: 1,
    objective: OBJECTIVE.ROUNDS,
    roundsToWin: 4,
    roundTime: 60,
    scoreLimit: 4,
    timeLimit: 0,
    respawnDelay: 0,
    killScore: 1,
    mapPool: mapsBySize('small'),
    online: true,
    botFill: false,
    minPlayers: 2,
    searchTimeout: 45,
  },
  online_12v12: {
    id: 'online_12v12',
    name: '온라인 12vs12',
    en: 'Ranked 12v12',
    icon: '🛰️',
    special: true,
    desc: '매치메이킹으로 모인 플레이어들이 24인 전장에서 격돌합니다. 정원이 차지 않으면 AI 분대가 투입됩니다.',
    teamSize: 12,
    objective: OBJECTIVE.TDM,
    scoreLimit: 150,
    timeLimit: 720,
    respawnDelay: 4,
    killScore: 1,
    mapPool: [...mapsBySize('large'), ...mapsBySize('medium')],
    online: true,
    botFill: true,
    minPlayers: 2,
    searchTimeout: 25,        // backfill with bots after this many seconds
  },
};

export const MODE_ORDER = ['ground_war', 'clash', 'team_12v12', 'duel', 'online_duel', 'online_12v12'];

export function getMode(id) {
  const m = MODES[id];
  if (!m) throw new Error(`unknown mode: ${id}`);
  return m;
}

export function randomMapFor(modeId, rnd = Math.random) {
  const pool = getMode(modeId).mapPool;
  return pool[Math.floor(rnd() * pool.length)];
}

/** Bot difficulty presets, exposed in the lobby. */
export const DIFFICULTY = {
  recruit: { id: 'recruit', name: '신병', aim: 0.30, reaction: 0.62, spread: 4.2, aggression: 0.45, fov: 95 },
  regular: { id: 'regular', name: '정규군', aim: 0.52, reaction: 0.42, spread: 2.6, aggression: 0.62, fov: 110 },
  hardened: { id: 'hardened', name: '베테랑', aim: 0.72, reaction: 0.28, spread: 1.5, aggression: 0.78, fov: 125 },
  veteran: { id: 'veteran', name: '특수부대', aim: 0.88, reaction: 0.17, spread: 0.8, aggression: 0.92, fov: 140 },
};
