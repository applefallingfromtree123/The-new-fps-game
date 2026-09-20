// All DOM-driven HUD elements: health, ammo, crosshair, killfeed, banners,
// objective pips, scoreboard and the damage direction indicators.

import { TEAM_INFO } from '/shared/constants.js';
import { WEAPONS } from '/shared/weapons.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      scoreA: $('scoreAlpha'), scoreB: $('scoreBravo'),
      clock: $('matchClock'), modeLabel: $('modeLabel'),
      objective: $('objectiveBar'),
      killfeed: $('killfeed'),
      healthFill: $('healthFill'), healthText: $('healthText'), healthBar: document.querySelector('.health-bar'),
      streakBox: $('streakBox'), streakName: $('streakName'),
      equip: $('equipBox'),
      weaponName: $('weaponName'), ammoMag: $('ammoMag'), ammoReserve: $('ammoReserve'),
      ammo: document.querySelector('.ammo'), reloadHint: $('reloadHint'),
      scorePopup: $('scorePopup'),
      damage: $('damageIndicators'),
      banner: $('banner'),
      death: $('deathScreen'), killerInfo: $('killerInfo'), respawnTimer: $('respawnTimer'),
      flash: $('flashOverlay'), vignette: $('damageVignette'),
      scope: $('scopeOverlay'),
      scoreboard: $('scoreboard'),
      sbAlpha: $('sbAlpha'), sbBravo: $('sbBravo'), sbMode: $('sbMode'), sbMap: $('sbMap'),
      sbScoreA: $('sbScoreA'), sbScoreB: $('sbScoreB'),
      compass: $('compass'),
      minimapWrap: $('minimapWrap'),
    };
    this.killfeedRows = [];
    this.damageArrows = [];
    this.objPips = new Map();
    this.bannerTimer = 0;
    this.buildCompass();
  }

  buildCompass() {
    const marks = [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]];
    this.el.compass.innerHTML = '';
    this.compassMarks = marks.map(([label, deg]) => {
      const i = document.createElement('i');
      i.textContent = label;
      this.el.compass.appendChild(i);
      return { el: i, deg };
    });
  }

  updateCompass(yaw) {
    // yaw 0 faces +z, which we call north
    const facing = ((yaw * 180) / Math.PI + 360) % 360;
    const width = this.el.compass.clientWidth || 180;
    for (const m of this.compassMarks) {
      let rel = ((m.deg - facing + 540) % 360) - 180;
      const x = width / 2 + (rel / 70) * (width / 2);
      const visible = Math.abs(rel) < 72;
      m.el.style.display = visible ? 'block' : 'none';
      m.el.style.left = `${x}px`;
      m.el.style.opacity = String(1 - Math.abs(rel) / 90);
    }
  }

  setMode(mode, map) {
    this.el.modeLabel.textContent = `${mode.name} · ${map.name}`;
    this.el.sbMode.textContent = `${mode.name} — ${mode.en}`;
    this.el.sbMap.textContent = `${map.name} (${map.en})`;
  }

  setScores(a, b) {
    this.el.scoreA.textContent = a;
    this.el.scoreB.textContent = b;
    this.el.sbScoreA.textContent = a;
    this.el.sbScoreB.textContent = b;
  }

  setClock(seconds) {
    if (seconds === null || seconds === undefined) { this.el.clock.textContent = '--:--'; return; }
    const s = Math.max(0, Math.round(seconds));
    this.el.clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this.el.healthFill.style.width = `${pct}%`;
    this.el.healthText.textContent = Math.ceil(pct);
    this.el.healthBar.classList.toggle('low', pct < 35);
    this.el.vignette.style.opacity = pct < 60 ? String((60 - pct) / 60 * 0.9) : '0';
  }

  setWeapon(weaponId, ammo, reserve, reloading) {
    const def = WEAPONS[weaponId];
    this.el.weaponName.textContent = def ? def.name : weaponId;
    this.el.ammoMag.textContent = ammo;
    this.el.ammoReserve.textContent = `/${reserve}`;
    this.el.ammo.classList.toggle('empty', ammo === 0);
    this.el.reloadHint.classList.toggle('hidden', !(ammo === 0 && reserve > 0 && !reloading));
  }

  setEquipment(lethal, lethalCount, tactical, tacticalCount) {
    this.el.equip.innerHTML =
      `<div>💣 ${lethal} <b>${lethalCount}</b> <kbd>G</kbd></div>` +
      `<div>✨ ${tactical} <b>${tacticalCount}</b> <kbd>F</kbd></div>`;
  }

  setStreak(name) {
    this.el.streakBox.classList.toggle('hidden', !name);
    if (name) this.el.streakName.textContent = name;
  }

  setCrosshair(spreadPx, hidden, hitTint) {
    const ch = this.el.crosshair;
    ch.style.display = hidden ? 'none' : 'block';
    const gap = Math.max(3, Math.min(28, spreadPx));
    ch.querySelector('.top').style.transform = `translateY(${16 - gap}px)`;
    ch.querySelector('.bottom').style.transform = `translateY(${gap - 16}px)`;
    ch.querySelector('.left').style.transform = `translateX(${16 - gap}px)`;
    ch.querySelector('.right').style.transform = `translateX(${gap - 16}px)`;
    ch.classList.toggle('hit', !!hitTint);
  }

  setScope(on) { this.el.scope.classList.toggle('hidden', !on); }

  hitmarker(kill) {
    const el = this.el.hitmarker;
    el.classList.remove('show', 'kill');
    void el.offsetWidth;                      // restart the animation
    el.classList.add('show');
    if (kill) el.classList.add('kill');
  }

  killfeed(entry, myTeam) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const cls = (team) => (team === myTeam ? 'a' : 'b');
    const weaponName = WEAPONS[entry.weapon]?.name
      || ({ melee: '근접', frag: '수류탄', semtex: '점착탄', airstrike: '공습', fall: '낙하', void: '추락' })[entry.weapon]
      || entry.weapon;
    row.innerHTML = entry.byName
      ? `<span class="${cls(entry.byTeam)}">${escapeHtml(entry.byName)}</span>` +
        `<span class="w">${entry.headshot ? '<span class="hs">✦</span> ' : ''}${escapeHtml(weaponName)}</span>` +
        `<span class="${cls(entry.onTeam)}">${escapeHtml(entry.onName)}</span>`
      : `<span class="w">${escapeHtml(weaponName)}</span><span class="${cls(entry.onTeam)}">${escapeHtml(entry.onName)}</span>`;
    this.el.killfeed.appendChild(row);
    this.killfeedRows.push({ el: row, until: performance.now() + 6500 });
    while (this.killfeedRows.length > 6) {
      const old = this.killfeedRows.shift();
      old.el.remove();
    }
  }

  scorePopup(text) {
    const d = document.createElement('div');
    d.textContent = text;
    this.el.scorePopup.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  damageFrom(angleRad) {
    const d = document.createElement('div');
    d.className = 'dmg-arrow';
    d.style.transform = `rotate(${angleRad}rad)`;
    this.el.damage.appendChild(d);
    setTimeout(() => d.remove(), 1100);
  }

  banner(text, sub, duration = 2.4, color) {
    const el = this.el.banner;
    el.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`;
    el.style.color = color || '#ffffff';
    el.classList.remove('hidden');
    this.bannerTimer = duration;
  }

  setDeath(show, killerName, killerWeapon, timer) {
    this.el.death.classList.toggle('hidden', !show);
    if (show) {
      this.el.killerInfo.textContent = killerName
        ? `${killerName} 에게 제압당했습니다 (${WEAPONS[killerWeapon]?.name || killerWeapon || ''})`
        : '전장에서 쓰러졌습니다';
      this.el.respawnTimer.textContent = Math.ceil(timer);
    }
  }

  setFlash(amount) { this.el.flash.style.opacity = String(Math.max(0, Math.min(1, amount))); }

  setObjectives(objectives) {
    if (!objectives || !objectives.length) {
      if (this.objPips.size) { this.el.objective.innerHTML = ''; this.objPips.clear(); }
      return;
    }
    for (const o of objectives) {
      let pip = this.objPips.get(o.id);
      if (!pip) {
        pip = document.createElement('div');
        pip.className = 'obj-pip';
        pip.innerHTML = `${o.id}<i class="prog"></i>`;
        this.el.objective.appendChild(pip);
        this.objPips.set(o.id, pip);
      }
      pip.classList.toggle('alpha', o.owner === 0);
      pip.classList.toggle('bravo', o.owner === 1);
      pip.classList.toggle('contest', !!o.contested);
      const prog = pip.querySelector('.prog');
      prog.style.width = `${Math.abs(o.progress || 0) * 100}%`;
      prog.style.background = o.progress < 0 ? TEAM_INFO[0].css : TEAM_INFO[1].css;
    }
  }

  setScoreboard(visible, rows, myId, myTeam) {
    this.el.scoreboard.classList.toggle('hidden', !visible);
    if (!visible) return;
    const build = (tbody, team) => {
      tbody.innerHTML = rows.filter((r) => r.team === team).map((r) => `
        <tr class="${r.id === myId ? 'me' : ''}">
          <td>${escapeHtml(r.name)}${r.bot ? '<span class="bot">AI</span>' : ''}</td>
          <td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td>
        </tr>`).join('');
    };
    build(this.el.sbAlpha, myTeam === 0 ? 0 : 1);
    build(this.el.sbBravo, myTeam === 0 ? 1 : 0);
    document.querySelector('.sb-team.alpha h3').firstChild.textContent =
      (myTeam === 0 ? TEAM_INFO[0].name : TEAM_INFO[1].name) + ' ';
    document.querySelector('.sb-team.bravo h3').firstChild.textContent =
      (myTeam === 0 ? TEAM_INFO[1].name : TEAM_INFO[0].name) + ' ';
  }

  tick(dt) {
    const now = performance.now();
    for (let i = this.killfeedRows.length - 1; i >= 0; i--) {
      if (now > this.killfeedRows[i].until) {
        this.killfeedRows[i].el.remove();
        this.killfeedRows.splice(i, 1);
      }
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.add('hidden');
    }
  }

  reset() {
    this.el.killfeed.innerHTML = '';
    this.killfeedRows.length = 0;
    this.el.objective.innerHTML = '';
    this.objPips.clear();
    this.el.banner.classList.add('hidden');
    this.el.death.classList.add('hidden');
    this.el.scoreboard.classList.add('hidden');
    this.setFlash(0);
    this.setStreak(null);
  }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
