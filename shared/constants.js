// Core tuning values shared by the client renderer, the bot AI and the
// authoritative server. Distances are in metres, times in seconds.

export const TICK_RATE = 30;                 // server simulation ticks per second
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_RATE = 15;             // state broadcasts per second
export const CLIENT_SEND_RATE = 30;          // input packets per second

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  eyeHeight: 1.62,
  crouchHeight: 1.1,
  crouchEyeHeight: 0.95,
  maxHealth: 100,
  regenDelay: 4.5,          // seconds after last damage before health regenerates
  regenRate: 28,            // health per second once regeneration starts
  walkSpeed: 4.4,
  sprintSpeed: 7.1,
  crouchSpeed: 2.3,
  adsSpeedScale: 0.55,      // movement multiplier while aiming down sights
  acceleration: 55,
  airAcceleration: 9,
  friction: 11,
  gravity: 21.5,
  jumpVelocity: 7.2,
  stepHeight: 0.55,
  mantleHeight: 1.35,
  slideDuration: 0.75,
  slideSpeed: 9.6,
  spawnProtection: 1.2,
};

export const TEAM = {
  ALPHA: 0,   // "Coalition"
  BRAVO: 1,   // "Spectre"
  NONE: -1,
};

export const TEAM_INFO = {
  [TEAM.ALPHA]: { id: 0, key: 'alpha', name: '연합군', short: 'ALPHA', color: 0x4da3ff, css: '#4da3ff' },
  [TEAM.BRAVO]: { id: 1, key: 'bravo', name: '반군', short: 'BRAVO', color: 0xff5f52, css: '#ff5f52' },
};

export const DAMAGE_MULTIPLIER = {
  head: 2.0,
  chest: 1.0,
  stomach: 1.0,
  limb: 0.85,
};

// Score awarded for various events, mirroring CoD's scorestreak economy.
export const SCORE = {
  kill: 100,
  assist: 50,
  headshot: 25,
  capture: 200,
  defend: 100,
  objectiveTick: 15,
  roundWin: 250,
};

export const KILLSTREAKS = [
  { at: 3, id: 'uav', name: 'UAV 정찰기', desc: '15초간 적 위치가 미니맵에 표시됩니다.', duration: 15 },
  { at: 5, id: 'counter_uav', name: '대공 방해기', desc: '10초간 적 미니맵을 교란합니다.', duration: 10 },
  { at: 7, id: 'airstrike', name: '정밀 공습', desc: '조준 지점에 폭격을 요청합니다.', duration: 0 },
];

export const NET = {
  protocolVersion: 3,
  heartbeatMs: 5000,
  timeoutMs: 20000,
  maxNameLength: 16,
};

export const COLLISION_EPS = 1e-4;
