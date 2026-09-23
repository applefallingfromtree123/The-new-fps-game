import test from 'node:test';
import assert from 'node:assert/strict';

import { MAP_DEFS, buildMap, mapsBySize } from '../shared/maps.js';
import { MODES, MODE_ORDER, getMode, OBJECTIVE } from '../shared/modes.js';
import { WEAPONS, LOADOUTS, damageAtRange, fireInterval, getWeapon } from '../shared/weapons.js';
import { CollisionWorld, moveCharacter, rayPlayer, wishVector } from '../shared/physics.js';
import { NavGrid } from '../shared/nav.js';
import { MatchSim, MATCH_STATE } from '../shared/match.js';
import { PLAYER, TEAM } from '../shared/constants.js';

test('twenty maps are defined with unique ids', () => {
  assert.equal(MAP_DEFS.length, 20);
  const ids = new Set(MAP_DEFS.map((m) => m.id));
  assert.equal(ids.size, 20);
  assert.equal(mapsBySize('large').length, 6);
  assert.equal(mapsBySize('medium').length, 8);
  assert.equal(mapsBySize('small').length, 6);
});

test('every map builds valid geometry, spawns and objectives', () => {
  for (const def of MAP_DEFS) {
    const map = buildMap(def.id);
    assert.ok(map.blocks.length > 15, `${def.id} has too little geometry`);
    for (const b of map.blocks) {
      assert.ok(b.w > 0 && b.h > 0 && b.d > 0, `${def.id} has a degenerate block`);
      assert.ok(Number.isFinite(b.x + b.y + b.z), `${def.id} has a NaN block`);
    }
    assert.ok(map.objectives.length >= 1);
    for (const team of [0, 1]) {
      assert.ok(map.spawns[team].length >= 8, `${def.id} team ${team} needs spawns`);
      for (const s of map.spawns[team]) {
        assert.ok(Math.abs(s.x) <= map.hx && Math.abs(s.z) <= map.hz, `${def.id} spawn out of bounds`);
      }
    }
  }
});

test('map generation is deterministic', () => {
  const a = buildMap('crossfire').blocks.length;
  const b = JSON.parse(JSON.stringify(buildMap('crossfire'))).blocks.length;
  assert.equal(a, b);
});

test('spawn points are not buried inside geometry', () => {
  for (const def of MAP_DEFS) {
    const map = buildMap(def.id);
    const world = new CollisionWorld(map);
    for (const team of [0, 1]) {
      let clear = 0;
      for (const s of map.spawns[team]) {
        const y = world.groundBelow(s.x, 4, s.z, PLAYER.radius, 8);
        if (!world.boxBlocked(s.x, y, s.z, PLAYER.radius, PLAYER.height)) clear++;
      }
      assert.ok(clear >= map.spawns[team].length * 0.6,
        `${def.id} team ${team}: only ${clear}/${map.spawns[team].length} spawns are clear`);
    }
  }
});

test('characters fall, land and are blocked by walls', () => {
  const world = new CollisionWorld(buildMap('rust'));
  const s = { pos: { x: 0, y: 20, z: -18 }, vel: { x: 0, y: 0, z: 0 }, onGround: false, height: PLAYER.height };
  for (let i = 0; i < 240; i++) moveCharacter(world, s, 1 / 60);
  assert.ok(s.onGround, 'player should land');
  assert.ok(s.pos.y >= 0 && s.pos.y < 6, `landed at an implausible height: ${s.pos.y}`);

  // walking into the arena boundary must not escape the map
  s.vel.x = 40;
  for (let i = 0; i < 300; i++) { s.vel.x = 40; moveCharacter(world, s, 1 / 60); }
  assert.ok(Math.abs(s.pos.x) <= world.map.hx, 'player escaped the arena');
});

test('movement basis matches the camera basis', () => {
  // The renderer sets camera.rotation.y = yaw + PI (YXZ), so in world space
  //   forward = (sin yaw, cos yaw)      camera -Z
  //   right   = (-cos yaw, sin yaw)     camera +X
  // Those two vectors are the ground truth for W/A/S/D.
  for (const yaw of [0, 0.7, -1.3, Math.PI / 2, Math.PI, -2.9]) {
    const fwd = wishVector(yaw, 1, 0);
    assert.ok(Math.abs(fwd.x - Math.sin(yaw)) < 1e-9, `forward.x at yaw ${yaw}`);
    assert.ok(Math.abs(fwd.z - Math.cos(yaw)) < 1e-9, `forward.z at yaw ${yaw}`);

    const right = wishVector(yaw, 0, 1);
    assert.ok(Math.abs(right.x + Math.cos(yaw)) < 1e-9, `right.x at yaw ${yaw}`);
    assert.ok(Math.abs(right.z - Math.sin(yaw)) < 1e-9, `right.z at yaw ${yaw}`);

    // forward and strafe must stay perpendicular
    assert.ok(Math.abs(fwd.x * right.x + fwd.z * right.z) < 1e-9, `basis not orthogonal at yaw ${yaw}`);
  }
  // back-pedalling and left-strafing are exact mirrors
  const left = wishVector(1.1, 0, -1), right = wishVector(1.1, 0, 1);
  assert.ok(Math.abs(left.x + right.x) < 1e-9 && Math.abs(left.z + right.z) < 1e-9);
});

test('W A S D move the player the way the camera faces', () => {
  const sim = new MatchSim({ modeId: 'clash', mapId: 'the_pit', seed: 5, warmup: 0 });
  sim.start();
  const p = sim.addEntity({ name: 'P', team: TEAM.ALPHA });
  sim.step(0.05);

  // stand somewhere with clearance in every direction
  const nav = sim.nav;
  let spot = null;
  for (let c = 1; c < nav.cols - 1 && !spot; c++) {
    for (let r = 1; r < nav.rows - 1 && !spot; r++) {
      let open = true;
      for (let dc = -1; dc <= 1 && open; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!nav.walk[(r + dr) * nav.cols + (c + dc)]) { open = false; break; }
        }
      }
      if (open) spot = nav.cellCenter(c, r);
    }
  }
  assert.ok(spot, 'the test map needs an open area');

  const drive = (forward, right, yaw = 0) => {
    p.pos.x = spot.x; p.pos.z = spot.z; p.pos.y = 0;
    p.vel.x = p.vel.y = p.vel.z = 0;
    Object.assign(p.input, { forward, right, yaw, pitch: 0, sprint: false, crouch: false, jump: false });
    for (let i = 0; i < 12; i++) sim.step(1 / 60);
    return { x: p.pos.x - spot.x, z: p.pos.z - spot.z };
  };

  // facing +z (yaw 0): W goes +z, S goes -z, D strafes -x, A strafes +x
  const w = drive(1, 0);
  assert.ok(w.z > 0.05 && Math.abs(w.x) < 0.02, `W should move forward, got ${JSON.stringify(w)}`);
  const back = drive(-1, 0);
  assert.ok(back.z < -0.05 && Math.abs(back.x) < 0.02, `S should move back, got ${JSON.stringify(back)}`);
  const d = drive(0, 1);
  assert.ok(d.x < -0.05 && Math.abs(d.z) < 0.02, `D should strafe camera-right, got ${JSON.stringify(d)}`);
  const a = drive(0, -1);
  assert.ok(a.x > 0.05 && Math.abs(a.z) < 0.02, `A should strafe camera-left, got ${JSON.stringify(a)}`);
  // A and D must be opposites, never the same direction
  assert.ok(a.x * d.x < 0, 'A and D must move in opposite directions');

  // facing +x (yaw = PI/2): W goes +x, D strafes +z
  const w2 = drive(1, 0, Math.PI / 2);
  assert.ok(w2.x > 0.05 && Math.abs(w2.z) < 0.02, `W at yaw 90 should go +x, got ${JSON.stringify(w2)}`);
  const d2 = drive(0, 1, Math.PI / 2);
  assert.ok(d2.z > 0.05 && Math.abs(d2.x) < 0.02, `D at yaw 90 should go +z, got ${JSON.stringify(d2)}`);
});

test('raycasts hit geometry and player hitboxes', () => {
  const world = new CollisionWorld(buildMap('crossfire'));
  const down = world.raycast(0, 30, 0, 0, -1, 0, 60);
  assert.ok(down, 'a downward ray must hit the ground');
  assert.ok(down.dist > 0 && down.dist <= 30);

  const head = rayPlayer(0, 1.7, -6, 0, 0, 1, 20, 0, 0, 0, PLAYER.height);
  assert.ok(head, 'ray should hit the player');
  assert.equal(head.part, 'head');
  const legs = rayPlayer(0, 0.4, -6, 0, 0, 1, 20, 0, 0, 0, PLAYER.height);
  assert.equal(legs.part, 'limb');
  const miss = rayPlayer(0, 1.7, -6, 1, 0, 0, 20, 0, 0, 0, PLAYER.height);
  assert.equal(miss, null);
});

test('navigation connects both spawns on every map', () => {
  for (const def of MAP_DEFS) {
    const map = buildMap(def.id);
    const nav = new NavGrid(new CollisionWorld(map));
    const a = map.spawns[0][Math.floor(map.spawns[0].length / 2)];
    const b = map.spawns[1][Math.floor(map.spawns[1].length / 2)];
    const path = nav.findPath(a.x, a.z, b.x, b.z);
    assert.ok(path && path.length > 1, `${def.id}: bots cannot path between spawns`);
  }
});

test('weapon damage falls off with range', () => {
  for (const w of Object.values(WEAPONS)) {
    assert.ok(w.minDamage <= w.damage);
    assert.equal(damageAtRange(w, 0), w.damage);
    assert.equal(damageAtRange(w, w.farRange + 50), w.minDamage);
    const mid = damageAtRange(w, (w.nearRange + w.farRange) / 2);
    assert.ok(mid <= w.damage && mid >= w.minDamage);
    assert.ok(fireInterval(w) > 0);
  }
});

test('every loadout references real weapons', () => {
  for (const lo of LOADOUTS) {
    assert.ok(getWeapon(lo.primary));
    assert.ok(getWeapon(lo.secondary));
    assert.ok(lo.perks.length > 0);
  }
});

test('modes declare valid map pools', () => {
  assert.equal(MODE_ORDER.length, 6);
  const ids = new Set(MAP_DEFS.map((m) => m.id));
  for (const id of MODE_ORDER) {
    const mode = getMode(id);
    assert.ok(mode.mapPool.length > 0, `${id} has no maps`);
    for (const mid of mode.mapPool) assert.ok(ids.has(mid), `${id} references unknown map ${mid}`);
    assert.ok(mode.teamSize >= 1);
  }
  assert.ok(MODES.online_duel.online && MODES.online_12v12.online);
  assert.equal(MODES.team_12v12.teamSize, 12);
  assert.equal(MODES.duel.teamSize, 1);
});

test('a bot match plays out and produces kills', () => {
  const sim = new MatchSim({ modeId: 'clash', mapId: 'crossfire', seed: 1234, difficulty: 'hardened' });
  sim.start();
  sim.fillWithBots();
  assert.equal(sim.entities.size, 12);

  let kills = 0;
  for (let i = 0; i < 30 * 90; i++) {
    sim.step(1 / 30);
    for (const ev of sim.drainEvents()) if (ev.type === 'kill') kills++;
    if (sim.state === MATCH_STATE.ENDED) break;
  }
  assert.ok(kills > 0, 'bots should kill each other');
  assert.ok(sim.scores[0] + sim.scores[1] > 0, 'objective scoring should tick');
  for (const e of sim.entities.values()) {
    assert.ok(Number.isFinite(e.pos.x + e.pos.y + e.pos.z), 'entity position went NaN');
    assert.ok(e.pos.y > sim.map.killZ, 'entity fell out of the world');
  }
});

test('duel mode ends after the round limit is reached', () => {
  const sim = new MatchSim({ modeId: 'duel', mapId: 'rust', seed: 99, difficulty: 'veteran' });
  sim.start();
  sim.fillWithBots();
  assert.equal(sim.entities.size, 2);
  for (let i = 0; i < 30 * 600 && sim.state !== MATCH_STATE.ENDED; i++) sim.step(1 / 30);
  assert.equal(sim.state, MATCH_STATE.ENDED);
  assert.ok(sim.roundWins[0] === 4 || sim.roundWins[1] === 4, 'someone must win four rounds');
});

test('team deathmatch reaches its score limit', () => {
  const sim = new MatchSim({ modeId: 'team_12v12', mapId: 'shoothouse', seed: 7, difficulty: 'veteran' });
  sim.start();
  sim.fillWithBots();
  assert.equal(sim.entities.size, 24);
  for (let i = 0; i < 30 * 700 && sim.state !== MATCH_STATE.ENDED; i++) sim.step(1 / 30);
  assert.equal(sim.state, MATCH_STATE.ENDED);
  assert.ok(Math.max(sim.scores[0], sim.scores[1]) >= 1);
});

test('damage, death and respawn cycle works', () => {
  const sim = new MatchSim({ modeId: 'clash', mapId: 'rust', seed: 3, warmup: 0 });
  sim.start();
  const a = sim.addEntity({ name: 'A', team: TEAM.ALPHA });
  const b = sim.addEntity({ name: 'B', team: TEAM.BRAVO });
  // step past the brief spawn protection window
  for (let i = 0; i < 60; i++) sim.step(1 / 30);
  assert.equal(sim.state, MATCH_STATE.LIVE);

  sim.damage(b, a, 60, 'm4a1', 'chest');
  assert.ok(b.health < 100 && b.alive);
  sim.damage(b, a, 60, 'm4a1', 'head');
  assert.equal(b.alive, false);
  assert.equal(a.kills, 1);
  assert.equal(b.deaths, 1);

  for (let i = 0; i < 30 * 8; i++) sim.step(1 / 30);
  assert.equal(b.alive, true, 'player should respawn');
  assert.equal(b.health, PLAYER.maxHealth);
});

test('objective capture flips ownership and scores', () => {
  const sim = new MatchSim({ modeId: 'clash', mapId: 'rust', seed: 11, warmup: 0 });
  sim.start();
  const a = sim.addEntity({ name: 'A', team: TEAM.ALPHA });
  sim.step(0.05);
  const obj = sim.objectives[0];
  a.pos.x = obj.x; a.pos.z = obj.z;
  for (let i = 0; i < 30 * 12; i++) {
    a.pos.x = obj.x; a.pos.z = obj.z;
    sim.step(1 / 30);
  }
  assert.equal(obj.owner, TEAM.ALPHA, 'the point should be captured');
  assert.ok(sim.scores[TEAM.ALPHA] > 0, 'holding a point should score');
});
