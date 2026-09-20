// Weapon definitions. Damage falls off linearly between `nearRange` and
// `farRange`, the same model Call of Duty uses for its damage profiles.

export const WEAPON_CLASS = {
  AR: 'assault',
  SMG: 'smg',
  LMG: 'lmg',
  SNIPER: 'sniper',
  SHOTGUN: 'shotgun',
  PISTOL: 'pistol',
  LAUNCHER: 'launcher',
};

function weapon(def) {
  return {
    pellets: 1,
    burst: 0,
    adsZoom: 1.35,
    adsTime: 0.22,
    reloadTime: 2.1,
    swapTime: 0.55,
    recoilRecovery: 7.5,
    moveSpread: 1.9,
    airSpread: 2.6,
    crouchSpread: 0.72,
    headshotCapable: true,
    tracer: 0x9fd8ff,
    ...def,
  };
}

export const WEAPONS = {
  ak74: weapon({
    id: 'ak74', name: 'AK-74', cls: WEAPON_CLASS.AR,
    damage: 33, nearRange: 28, farRange: 55, minDamage: 22,
    rpm: 620, magazine: 30, reserve: 180, reloadTime: 2.25,
    spread: 0.85, recoil: { v: 1.15, h: 0.5 }, adsSpread: 0.16,
    velocity: 760, adsZoom: 1.45,
  }),
  m4a1: weapon({
    id: 'm4a1', name: 'M4A1', cls: WEAPON_CLASS.AR,
    damage: 28, nearRange: 32, farRange: 62, minDamage: 20,
    rpm: 750, magazine: 30, reserve: 180, reloadTime: 2.0,
    spread: 0.7, recoil: { v: 0.92, h: 0.38 }, adsSpread: 0.13,
    velocity: 820, adsZoom: 1.5,
  }),
  scarh: weapon({
    id: 'scarh', name: 'SCAR-H', cls: WEAPON_CLASS.AR,
    damage: 40, nearRange: 30, farRange: 60, minDamage: 26,
    rpm: 540, magazine: 20, reserve: 140, reloadTime: 2.4,
    spread: 0.95, recoil: { v: 1.4, h: 0.6 }, adsSpread: 0.18,
    velocity: 780, adsZoom: 1.55,
  }),
  mp5: weapon({
    id: 'mp5', name: 'MP5', cls: WEAPON_CLASS.SMG,
    damage: 24, nearRange: 16, farRange: 34, minDamage: 14,
    rpm: 860, magazine: 30, reserve: 210, reloadTime: 1.85,
    spread: 1.0, recoil: { v: 0.75, h: 0.45 }, adsSpread: 0.22,
    velocity: 520, adsTime: 0.17, adsZoom: 1.3, moveSpread: 1.35,
  }),
  vector: weapon({
    id: 'vector', name: 'Vector .45', cls: WEAPON_CLASS.SMG,
    damage: 21, nearRange: 14, farRange: 28, minDamage: 12,
    rpm: 1100, magazine: 32, reserve: 224, reloadTime: 1.95,
    spread: 1.25, recoil: { v: 0.62, h: 0.55 }, adsSpread: 0.26,
    velocity: 480, adsTime: 0.16, adsZoom: 1.25, moveSpread: 1.3,
  }),
  p90: weapon({
    id: 'p90', name: 'P90', cls: WEAPON_CLASS.SMG,
    damage: 22, nearRange: 18, farRange: 32, minDamage: 13,
    rpm: 900, magazine: 50, reserve: 250, reloadTime: 2.3,
    spread: 1.05, recoil: { v: 0.68, h: 0.4 }, adsSpread: 0.2,
    velocity: 540, adsTime: 0.18, adsZoom: 1.3, moveSpread: 1.4,
  }),
  m249: weapon({
    id: 'm249', name: 'M249 SAW', cls: WEAPON_CLASS.LMG,
    damage: 32, nearRange: 36, farRange: 72, minDamage: 24,
    rpm: 700, magazine: 100, reserve: 300, reloadTime: 4.2,
    spread: 1.4, recoil: { v: 1.0, h: 0.7 }, adsSpread: 0.22,
    velocity: 800, adsTime: 0.36, adsZoom: 1.5, moveSpread: 2.6,
  }),
  pkm: weapon({
    id: 'pkm', name: 'PKM', cls: WEAPON_CLASS.LMG,
    damage: 38, nearRange: 40, farRange: 80, minDamage: 28,
    rpm: 600, magazine: 100, reserve: 300, reloadTime: 4.6,
    spread: 1.5, recoil: { v: 1.25, h: 0.8 }, adsSpread: 0.24,
    velocity: 825, adsTime: 0.4, adsZoom: 1.55, moveSpread: 2.8,
  }),
  intervention: weapon({
    id: 'intervention', name: 'Intervention', cls: WEAPON_CLASS.SNIPER,
    damage: 98, nearRange: 60, farRange: 200, minDamage: 85,
    rpm: 45, magazine: 7, reserve: 42, reloadTime: 3.1, boltAction: 0.95,
    spread: 2.6, recoil: { v: 3.4, h: 0.9 }, adsSpread: 0.0,
    velocity: 1100, adsTime: 0.42, adsZoom: 5.0, scope: true, moveSpread: 4.5,
    tracer: 0xffe9a8,
  }),
  dragunov: weapon({
    id: 'dragunov', name: 'SVD Dragunov', cls: WEAPON_CLASS.SNIPER,
    damage: 72, nearRange: 55, farRange: 160, minDamage: 58,
    rpm: 180, magazine: 10, reserve: 60, reloadTime: 2.8,
    spread: 2.2, recoil: { v: 2.6, h: 0.8 }, adsSpread: 0.05,
    velocity: 980, adsTime: 0.38, adsZoom: 3.6, scope: true, moveSpread: 4.0,
    tracer: 0xffe9a8,
  }),
  m1014: weapon({
    id: 'm1014', name: 'M1014', cls: WEAPON_CLASS.SHOTGUN,
    damage: 19, pellets: 8, nearRange: 7, farRange: 16, minDamage: 4,
    rpm: 220, magazine: 8, reserve: 48, reloadTime: 3.2,
    spread: 3.4, recoil: { v: 2.2, h: 0.9 }, adsSpread: 2.2,
    velocity: 380, adsTime: 0.26, adsZoom: 1.2, moveSpread: 1.1,
  }),
  m1911: weapon({
    id: 'm1911', name: 'M1911', cls: WEAPON_CLASS.PISTOL,
    damage: 30, nearRange: 14, farRange: 30, minDamage: 18,
    rpm: 420, magazine: 8, reserve: 56, reloadTime: 1.6,
    spread: 1.1, recoil: { v: 1.3, h: 0.5 }, adsSpread: 0.25,
    velocity: 460, adsTime: 0.16, adsZoom: 1.25,
  }),
  deagle: weapon({
    id: 'deagle', name: 'Desert Eagle', cls: WEAPON_CLASS.PISTOL,
    damage: 55, nearRange: 20, farRange: 42, minDamage: 34,
    rpm: 260, magazine: 7, reserve: 42, reloadTime: 1.9,
    spread: 1.5, recoil: { v: 2.6, h: 0.8 }, adsSpread: 0.28,
    velocity: 520, adsTime: 0.2, adsZoom: 1.35,
  }),
  rpg7: weapon({
    id: 'rpg7', name: 'RPG-7', cls: WEAPON_CLASS.LAUNCHER,
    damage: 150, nearRange: 5, farRange: 9, minDamage: 35,
    rpm: 30, magazine: 1, reserve: 4, reloadTime: 3.6,
    spread: 0.4, recoil: { v: 3.0, h: 0.6 }, adsSpread: 0.2,
    velocity: 55, adsTime: 0.45, adsZoom: 1.4, projectile: 'rocket',
    splashRadius: 9, headshotCapable: false, tracer: 0xff9a3c,
  }),
};

export const LETHALS = {
  frag: { id: 'frag', name: '파편 수류탄', damage: 140, radius: 7.5, fuse: 3.2, count: 2, throwSpeed: 18 },
  semtex: { id: 'semtex', name: '점착 폭탄', damage: 160, radius: 6.0, fuse: 2.2, count: 1, throwSpeed: 21, sticky: true },
};

export const TACTICALS = {
  flash: { id: 'flash', name: '섬광탄', radius: 12, fuse: 1.6, count: 2, throwSpeed: 20, blindTime: 3.2 },
  smoke: { id: 'smoke', name: '연막탄', radius: 9, fuse: 1.2, count: 1, throwSpeed: 18, duration: 12 },
};

export const PERKS = {
  lightweight: { id: 'lightweight', name: '경량화', desc: '이동 속도 +8%' },
  stopping_power: { id: 'stopping_power', name: '스토핑 파워', desc: '총기 피해량 +12%' },
  ghost: { id: 'ghost', name: '고스트', desc: 'UAV에 표시되지 않음' },
  steady_aim: { id: 'steady_aim', name: '스테디 에임', desc: '무반동 조준 탄퍼짐 -25%' },
  scavenger: { id: 'scavenger', name: '스캐빈저', desc: '처치 시 탄약 회복' },
  commando: { id: 'commando', name: '코만도', desc: '낙하 피해 면역, 근접 사거리 증가' },
};

// Preset classes the player picks from in the loadout screen.
export const LOADOUTS = [
  {
    id: 'assault', name: '돌격병', icon: '🪖',
    primary: 'm4a1', secondary: 'm1911',
    lethal: 'frag', tactical: 'flash', perks: ['stopping_power', 'scavenger'],
    desc: '균형 잡힌 기본 병과. 모든 교전 거리에 대응합니다.',
  },
  {
    id: 'raider', name: '강습병', icon: '⚡',
    primary: 'mp5', secondary: 'm1911',
    lethal: 'semtex', tactical: 'flash', perks: ['lightweight', 'steady_aim'],
    desc: '근접전 특화. 빠른 기동으로 측면을 파고듭니다.',
  },
  {
    id: 'marksman', name: '저격수', icon: '🎯',
    primary: 'intervention', secondary: 'deagle',
    lethal: 'frag', tactical: 'smoke', perks: ['ghost', 'steady_aim'],
    desc: '장거리 제압. 한 발로 승부를 봅니다.',
  },
  {
    id: 'support', name: '지원병', icon: '🛡️',
    primary: 'm249', secondary: 'm1911',
    lethal: 'frag', tactical: 'smoke', perks: ['scavenger', 'commando'],
    desc: '화력 지원. 거점 방어와 제압 사격에 강합니다.',
  },
  {
    id: 'breacher', name: '돌파병', icon: '💥',
    primary: 'm1014', secondary: 'deagle',
    lethal: 'semtex', tactical: 'flash', perks: ['lightweight', 'commando'],
    desc: '실내 돌파. 좁은 통로에서 압도적입니다.',
  },
  {
    id: 'demolition', name: '폭파병', icon: '🚀',
    primary: 'scarh', secondary: 'rpg7',
    lethal: 'frag', tactical: 'smoke', perks: ['stopping_power', 'scavenger'],
    desc: '차량과 거점 파괴. 폭발물로 지역을 봉쇄합니다.',
  },
];

export function getWeapon(id) {
  const w = WEAPONS[id];
  if (!w) throw new Error(`unknown weapon: ${id}`);
  return w;
}

export function fireInterval(weapon) {
  if (weapon.boltAction) return weapon.boltAction;
  return 60 / weapon.rpm;
}

/** Linear damage falloff between nearRange and farRange. */
export function damageAtRange(weapon, distance) {
  if (distance <= weapon.nearRange) return weapon.damage;
  if (distance >= weapon.farRange) return weapon.minDamage;
  const t = (distance - weapon.nearRange) / (weapon.farRange - weapon.nearRange);
  return weapon.damage + (weapon.minDamage - weapon.damage) * t;
}

export const MELEE = { damage: 135, range: 2.4, cooldown: 0.8 };
