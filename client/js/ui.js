// Menu, loadout, map browser, settings, matchmaking overlay and results screen.

import { MODES, MODE_ORDER, DIFFICULTY, OBJECTIVE } from '/shared/modes.js';
import { MAP_DEFS, buildMap, mapSummary, THEMES } from '/shared/maps.js';
import { LOADOUTS, WEAPONS, getWeapon } from '/shared/weapons.js';
import { TEAM_INFO } from '/shared/constants.js';
import { renderMapPreview } from './minimap.js';
import { escapeHtml } from './hud.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

const DEFAULT_SETTINGS = {
  sensitivity: 2.0,
  touchSensitivity: 2.2,
  touchUI: false,
  server: '',
  fov: 90,
  quality: 'medium',
  shake: 0.8,
  volume: 0.6,
  invertY: false,
  holdAds: true,
  minimap: true,
  name: '',
  loadout: 'assault',
  difficulty: 'regular',
};

export function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('blackout.settings') || '{}'); } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveSettings(s) {
  try { localStorage.setItem('blackout.settings', JSON.stringify(s)); } catch { /* private mode */ }
}

export class MenuUI {
  constructor(settings) {
    this.settings = settings;
    this.selectedMode = 'clash';
    this.onPlay = null;
    this.onCancelQueue = null;
    this.mapsRendered = false;
    this.bind();
    this.buildModes();
    this.buildLoadouts();
    this.bindSettings();
    this.selectMode('clash');
  }

  bind() {
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        audio.uiClick();
        document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        $(tab.dataset.panel).classList.add('active');
        if (tab.dataset.panel === 'panel-maps') this.buildMaps();
      });
    });

    $('playerName').value = this.settings.name || `Soldier${Math.floor(Math.random() * 900 + 100)}`;
    $('playerName').addEventListener('change', (e) => {
      this.settings.name = e.target.value.trim().slice(0, 16);
      saveSettings(this.settings);
    });

    $('playBtn').addEventListener('click', () => {
      audio.uiConfirm();
      const mode = MODES[this.selectedMode];
      const mapSel = $('mapSelect').value;
      this.settings.name = $('playerName').value.trim().slice(0, 16) || 'Soldier';
      this.settings.difficulty = $('diffSelect').value;
      saveSettings(this.settings);
      this.onPlay?.({
        modeId: this.selectedMode,
        mapId: mapSel === 'random' ? mode.mapPool[Math.floor(Math.random() * mode.mapPool.length)] : mapSel,
        difficulty: this.settings.difficulty,
        loadoutId: this.settings.loadout,
        playerName: this.settings.name,
        online: !!mode.online,
      });
    });

    $('mmCancel').addEventListener('click', () => {
      audio.uiClick();
      this.onCancelQueue?.();
    });
  }

  buildModes() {
    const wrap = $('modeList');
    wrap.innerHTML = '';
    for (const id of MODE_ORDER) {
      const m = MODES[id];
      const card = document.createElement('div');
      card.className = 'mode-card';
      card.dataset.mode = id;
      card.innerHTML = `
        <div class="ic">${m.icon}</div>
        <h3>${escapeHtml(m.name)}</h3>
        <p>${escapeHtml(m.desc.slice(0, 58))}…</p>
        ${m.online ? `<span class="badge ${m.special ? 'special' : ''}">${m.special ? '특별 · 온라인' : '온라인'}</span>` : ''}`;
      card.addEventListener('click', () => { audio.uiClick(); this.selectMode(id); });
      wrap.appendChild(card);
    }
  }

  selectMode(id) {
    this.selectedMode = id;
    document.querySelectorAll('.mode-card').forEach((c) => c.classList.toggle('active', c.dataset.mode === id));
    const m = MODES[id];
    $('detailIcon').textContent = m.icon;
    $('detailName').textContent = `${m.name} · ${m.en}`;
    $('detailDesc').textContent = m.desc;

    const objLabel = {
      [OBJECTIVE.DOMINATION]: '거점 점령',
      [OBJECTIVE.TDM]: '팀 데스매치',
      [OBJECTIVE.ROUNDS]: '라운드 섬멸',
    }[m.objective];

    const stats = [
      `인원 <b>${m.teamSize} vs ${m.teamSize}</b>`,
      `목표 <b>${objLabel}</b>`,
      m.objective === OBJECTIVE.ROUNDS
        ? `승리 조건 <b>${m.roundsToWin}라운드 선취</b>`
        : `승리 조건 <b>${m.scoreLimit}점</b>`,
      m.timeLimit ? `제한 시간 <b>${Math.round(m.timeLimit / 60)}분</b>` : `라운드 시간 <b>${m.roundTime}초</b>`,
      `맵 <b>${m.mapPool.length}종</b>`,
      m.online ? '매치메이킹 <b>온라인</b>' : '상대 <b>AI 분대</b>',
    ];
    $('detailStats').innerHTML = stats.map((s) => `<span>${s}</span>`).join('');

    const sel = $('mapSelect');
    sel.innerHTML = `<option value="random">랜덤 (${m.mapPool.length}개 중)</option>` +
      m.mapPool.map((mid) => {
        const d = mapSummary(mid);
        return `<option value="${mid}">${escapeHtml(d.name)} · ${escapeHtml(d.en)}</option>`;
      }).join('');
    sel.disabled = !!m.online;

    $('diffSelect').value = this.settings.difficulty;
    $('diffSelect').disabled = !!(m.online && !m.botFill);

    const offline = m.online && this.onlineAvailable === false;
    $('playBtn').textContent = m.online ? '매치 찾기' : '배치';
    $('playBtn').classList.toggle('disabled', !!offline);
    $('playHint').textContent = offline
      ? '이 페이지에는 매치메이킹 서버가 없어 온라인 모드를 사용할 수 없습니다. 저장소를 내려받아 npm start 로 서버를 켜면 온라인 1vs1 · 12vs12 를 플레이할 수 있습니다. 나머지 4개 모드는 지금 바로 가능합니다.'
      : m.online
        ? '매치메이킹 서버가 상대를 찾습니다. 정원이 차지 않으면 AI 분대가 투입됩니다. 맵은 서버가 선택합니다.'
        : `AI ${m.teamSize * 2 - 1}명과 함께 즉시 전투를 시작합니다.`;
  }

  buildLoadouts() {
    const grid = $('loadoutGrid');
    grid.innerHTML = '';
    for (const lo of LOADOUTS) {
      const card = document.createElement('div');
      card.className = 'class-card';
      card.dataset.id = lo.id;
      card.innerHTML = `<div class="ic">${lo.icon}</div><h4>${escapeHtml(lo.name)}</h4><p>${escapeHtml(lo.desc)}</p>`;
      card.addEventListener('click', () => {
        audio.uiClick();
        this.settings.loadout = lo.id;
        saveSettings(this.settings);
        this.refreshLoadout();
      });
      grid.appendChild(card);
    }
    this.refreshLoadout();
  }

  refreshLoadout() {
    const id = this.settings.loadout;
    document.querySelectorAll('.class-card').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
    const lo = LOADOUTS.find((l) => l.id === id) || LOADOUTS[0];
    const gun = (wid, label) => {
      const w = getWeapon(wid);
      const bar = (name, v) => `
        <div class="stat-row"><span>${name}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`;
      return `
        <div class="gun-card">
          <h4>${label} — ${escapeHtml(w.name)}</h4>
          ${bar('피해량', Math.min(1, w.damage / 100))}
          ${bar('연사', Math.min(1, w.rpm / 1100))}
          ${bar('사거리', Math.min(1, w.farRange / 200))}
          ${bar('기동성', Math.max(0.1, 1 - w.adsTime / 0.5))}
          ${bar('정확도', Math.max(0.05, 1 - w.spread / 3.5))}
          <div class="stat-row"><span>탄창</span><div>${w.magazine} / ${w.reserve}</div></div>
        </div>`;
    };
    const perks = (lo.perks || []).map((p) => {
      const info = { lightweight: '경량화', stopping_power: '스토핑 파워', ghost: '고스트', steady_aim: '스테디 에임', scavenger: '스캐빈저', commando: '코만도' };
      return `<span class="tag">${info[p] || p}</span>`;
    }).join('');
    $('loadoutDetail').innerHTML = gun(lo.primary, '주무기') + gun(lo.secondary, '보조무기') + `
      <div class="gun-card">
        <h4>장비 &amp; 특성</h4>
        <div class="stat-row"><span>치명 장비</span><div>${lo.lethal === 'semtex' ? '점착 폭탄' : '파편 수류탄'}</div></div>
        <div class="stat-row"><span>전술 장비</span><div>${lo.tactical === 'smoke' ? '연막탄' : '섬광탄'}</div></div>
        <div class="tagrow">${perks}</div>
        <p style="margin-top:10px;font-size:12px;color:#8d9aab;line-height:1.5">${escapeHtml(lo.desc)}</p>
      </div>`;
  }

  buildMaps() {
    if (this.mapsRendered) return;
    this.mapsRendered = true;
    $('mapCount').textContent = `(${MAP_DEFS.length})`;
    const grid = $('mapGrid');
    grid.innerHTML = '';
    const sizeLabel = { small: '소형 · 1대1', medium: '중형 · 격돌', large: '대형 · 전장/12v12' };
    for (const def of MAP_DEFS) {
      const card = document.createElement('div');
      card.className = 'map-card';
      const modes = MODE_ORDER.filter((mid) => MODES[mid].mapPool.includes(def.id)).map((mid) => MODES[mid].name);
      card.innerHTML = `
        <canvas></canvas>
        <div class="mi">
          <h4>${escapeHtml(def.name)}</h4>
          <div class="sub">${escapeHtml(def.en)} · ${THEMES[def.theme].label}</div>
          <p>${escapeHtml(def.desc)}</p>
          <div class="tagrow"><span class="tag">${sizeLabel[def.size]}</span>${modes.slice(0, 3).map((m) => `<span class="tag">${escapeHtml(m)}</span>`).join('')}</div>
        </div>`;
      grid.appendChild(card);
      // build previews lazily so opening the tab stays snappy
      requestAnimationFrame(() => renderMapPreview(card.querySelector('canvas'), buildMap(def.id)));
    }
  }

  bindSettings() {
    const s = this.settings;
    const bindRange = (id, key, out, fmt = (v) => v) => {
      const el = $(id);
      el.value = s[key];
      $(out).textContent = fmt(s[key]);
      el.addEventListener('input', () => {
        s[key] = parseFloat(el.value);
        $(out).textContent = fmt(s[key]);
        saveSettings(s);
        if (key === 'volume') audio.setVolume(s.volume);
      });
    };
    bindRange('setSens', 'sensitivity', 'outSens');
    bindRange('setTouchSens', 'touchSensitivity', 'outTouchSens');
    bindRange('setFov', 'fov', 'outFov');
    bindRange('setShake', 'shake', 'outShake');
    bindRange('setVolume', 'volume', 'outVolume', (v) => Math.round(v * 100));

    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = !!s[key];
      el.addEventListener('change', () => { s[key] = el.checked; saveSettings(s); });
    };
    bindCheck('setInvert', 'invertY');
    bindCheck('setHoldAds', 'holdAds');
    bindCheck('setMinimap', 'minimap');
    bindCheck('setTouchUI', 'touchUI');

    const server = $('setServer');
    server.value = s.server || '';
    const applyServer = () => {
      s.server = server.value.trim();
      saveSettings(s);
      this.onServerChange?.(s.server);
    };
    server.addEventListener('change', applyServer);
    $('setServerApply').addEventListener('click', () => { audio.uiClick(); applyServer(); });

    const q = $('setQuality');
    q.value = s.quality;
    q.addEventListener('change', () => { s.quality = q.value; saveSettings(s); });
  }

  show() { $('menu').classList.remove('hidden'); }
  hide() { $('menu').classList.add('hidden'); }

  setNetStatus(connected, online, unavailable = false, waking = false) {
    this.onlineAvailable = connected;
    $('netDot').className = `dot ${connected ? 'on' : 'off'}`;
    $('netText').textContent = connected
      ? `온라인 · ${online}명 접속`
      : waking ? '서버를 깨우는 중…'
        : unavailable ? '오프라인 전용 (서버 없음)' : '서버 연결 중…';
    $('serverInfo').textContent = connected
      ? `매치메이킹 서버 연결됨 · 접속자 ${online}명 · 맵 ${MAP_DEFS.length}종 · 모드 ${MODE_ORDER.length}종`
      : waking
        ? '설정한 서버를 깨우는 중입니다. 무료 플랜은 첫 접속에 1분까지 걸릴 수 있습니다.'
        : unavailable
        ? `매치메이킹 서버가 없어 온라인 모드는 비활성화됩니다. 로컬에서 npm start 로 서버를 켜면 사용할 수 있습니다. · 맵 ${MAP_DEFS.length}종 · 모드 ${MODE_ORDER.length}종`
        : '서버에 연결하는 중입니다. 오프라인 모드는 지금 바로 플레이할 수 있습니다.';

    document.querySelectorAll('.mode-card').forEach((card) => {
      const mode = MODES[card.dataset.mode];
      card.classList.toggle('locked', !!mode?.online && unavailable);
    });
    if (MODES[this.selectedMode]?.online) this.selectMode(this.selectedMode);
  }

  // ------------------------------------------------------------ match flow
  showMatchmaking(modeId) {
    const m = MODES[modeId];
    $('matchmaking').classList.remove('hidden');
    $('mmTitle').textContent = m.teamSize === 1 ? '상대를 찾는 중…' : '분대를 편성하는 중…';
    $('mmSub').textContent = `${m.name} · 정원 ${m.teamSize * 2}명`;
    $('mmRoster').innerHTML = '';
    $('mmPlayers').textContent = '0';
    $('mmElapsed').textContent = '0s';
  }

  updateMatchmaking(msg) {
    $('mmPlayers').textContent = `${msg.waiting}/${msg.needed}`;
    $('mmElapsed').textContent = `${msg.elapsed}s`;
    $('mmOnline').textContent = msg.online ?? 0;
    if (msg.timeout && msg.elapsed >= msg.timeout - 3) {
      $('mmSub').textContent = 'AI 분대 투입을 준비합니다…';
    }
  }

  matchFound(msg) {
    $('mmTitle').textContent = '매치 성사!';
    $('mmSub').textContent = `${mapSummary(msg.map)?.name || msg.map} 에 배치됩니다` + (msg.withBots ? ' (AI 분대 포함)' : '');
    audio.uiConfirm();
  }

  hideMatchmaking() { $('matchmaking').classList.add('hidden'); }

  showResults(session, onAgain, onBack) {
    const winner = session.winner ?? -1;
    const won = winner === session.myTeam;
    const card = $('results');
    $('resultTitle').textContent = winner === -1 ? '무승부' : won ? '승리' : '패배';
    $('resultTitle').className = winner === -1 ? '' : won ? 'win' : 'lose';
    $('resultScore').textContent = `${session.scores[0]} — ${session.scores[1]}`;

    const rows = session.scoreboard();
    $('resultBoard').innerHTML = `
      <table>
        <thead><tr><th>병사</th><th>소속</th><th>점수</th><th>처치</th><th>사망</th><th>어시스트</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr>
            <td class="${r.team === 0 ? 'a' : 'b'}">${escapeHtml(r.name)}${r.bot ? ' <small>AI</small>' : ''}</td>
            <td>${TEAM_INFO[r.team]?.name || '-'}</td>
            <td>${r.score}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists || 0}</td>
          </tr>`).join('')}</tbody>
      </table>`;
    card.classList.remove('hidden');
    $('againBtn').onclick = () => { audio.uiConfirm(); card.classList.add('hidden'); onAgain(); };
    $('backBtn').onclick = () => { audio.uiClick(); card.classList.add('hidden'); onBack(); };
  }

  hideResults() { $('results').classList.add('hidden'); }
}
