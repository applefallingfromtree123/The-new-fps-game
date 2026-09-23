// Bootstrap: wires the menu, the network client and the game loop together.

import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { MenuUI, loadSettings, saveSettings } from './ui.js';
import { LocalSession } from './session_local.js';
import { NetSession } from './session_net.js';
import { net } from './net.js';
import { audio } from './audio.js';
import { MODES } from '/shared/modes.js';
import { buildMap, MAP_DEFS } from '/shared/maps.js';

const $ = (id) => document.getElementById(id);

const settings = loadSettings();
const hud = new Hud();
const canvas = $('view');
const input = new Input(canvas, settings, document.getElementById('game'));
const game = new Game({ canvas, hud, input, settings });
const menu = new MenuUI(settings);

let pendingStart = null;      // config for the queued/online match
let currentConfig = null;
let inMatch = false;

// a ?server=... query parameter wins over the saved setting
const serverParam = new URLSearchParams(location.search).get('server');
if (serverParam) settings.server = serverParam;
net.setServerUrl(settings.server);

menu.onServerChange = (value) => {
  net.setServerUrl(value);
  net.close();
  net.connect(settings.name || 'Soldier', true);
};

if (settings.touchUI) input.touch.setVisible(true);

// ------------------------------------------------------------------- boot
async function boot() {
  const steps = [
    ['전장 데이터 로딩 중…', () => buildMap(MAP_DEFS[0].id)],
    ['무기 프로파일 준비 중…', () => null],
    ['매치메이킹 서버 연결 중…', () => net.connect(settings.name || 'Soldier')],
  ];
  for (let i = 0; i < steps.length; i++) {
    $('bootMsg').textContent = steps[i][0];
    $('bootFill').style.width = `${((i + 1) / steps.length) * 100}%`;
    steps[i][1]();
    await new Promise((r) => setTimeout(r, 180));
  }
  $('boot').classList.add('hidden');
  menu.show();
  audio.setVolume(settings.volume);
}

// --------------------------------------------------------------- net glue
net.on('open', () => menu.setNetStatus(true, net.online));
net.on('close', () => {
  menu.setNetStatus(false, 0, net.gaveUp);
  if (pendingStart) { menu.hideMatchmaking(); pendingStart = null; }
});
net.on('unavailable', () => menu.setNetStatus(false, 0, true));
net.on('presence', (m) => menu.setNetStatus(true, m.online));
net.on('hello_ok', (m) => menu.setNetStatus(true, m.online));
net.on('queue', (m) => menu.updateMatchmaking({ ...m, online: net.online }));
net.on('match_found', (m) => menu.matchFound(m));
net.on('error', (m) => {
  menu.hideMatchmaking();
  pendingStart = null;
  alert(m.msg || '서버 오류가 발생했습니다.');
});

net.on('match_start', (m) => {
  menu.hideMatchmaking();
  menu.hide();
  const session = new NetSession(net, m, currentConfig?.loadoutId || settings.loadout);
  startSession(session);
});

net.on('match_end', () => {
  // the results screen is driven by the session's ended flag in the loop
});

// ------------------------------------------------------------ match start
menu.onPlay = (config) => {
  currentConfig = config;
  audio.init();
  audio.resume();
  if (config.online) {
    if (!net.connected) {
      // one more attempt, in case the server came up after we gave up
      net.connect(config.playerName, true);
      alert('온라인 모드는 매치메이킹 서버가 필요합니다.\n\n'
        + '이 페이지가 GitHub Pages 같은 정적 호스팅이라면 서버가 없어 사용할 수 없습니다.\n'
        + '저장소를 받아 "npm install && npm start" 로 실행한 뒤 http://localhost:8080 에서 접속하세요.\n\n'
        + '전장 · 격돌 · 12vs12 · 1대1 모드는 지금 바로 플레이할 수 있습니다.');
      return;
    }
    pendingStart = config;
    menu.showMatchmaking(config.modeId);
    net.send({ t: 'hello', name: config.playerName });
    net.send({ t: 'queue', mode: config.modeId, loadout: config.loadoutId });
    return;
  }
  menu.hide();
  const session = new LocalSession(config);
  startSession(session);
};

menu.onCancelQueue = () => {
  net.send({ t: 'cancel_queue' });
  pendingStart = null;
  menu.hideMatchmaking();
};

function startSession(session) {
  inMatch = true;
  $('game').classList.remove('hidden');
  menu.hideResults();
  game.begin(session);
  game.onMatchEnd = (s) => {
    input.exitLock();
    input.enabled = false;
    menu.showResults(s, restartMatch, backToMenu);
  };
  showClickToPlay();
}

function showClickToPlay() {
  const el = $('clickToPlay');
  el.querySelector('span').textContent = input.usePointerLock
    ? '클릭하여 조작 시작'
    : '화면을 탭하여 시작 — 왼쪽은 이동, 오른쪽은 시점';
  el.classList.remove('hidden');
  const go = () => {
    el.classList.add('hidden');
    input.enabled = true;
    input.requestLock();
    audio.init();
    audio.resume();
  };
  el.onclick = go;
  // capture needs a user gesture (pointer lock, and audio), so wait for the tap
}

function restartMatch() {
  if (!currentConfig) return backToMenu();
  game.stop();
  if (currentConfig.online) {
    $('game').classList.add('hidden');
    menu.show();
    menu.showMatchmaking(currentConfig.modeId);
    net.send({ t: 'queue', mode: currentConfig.modeId, loadout: currentConfig.loadoutId });
    return;
  }
  const session = new LocalSession({
    ...currentConfig,
    mapId: MODES[currentConfig.modeId].mapPool[Math.floor(Math.random() * MODES[currentConfig.modeId].mapPool.length)],
  });
  startSession(session);
}

function backToMenu() {
  inMatch = false;
  game.stop();
  input.enabled = false;
  input.exitLock();
  if (settings.touchUI) input.touch.setVisible(false);
  $('game').classList.add('hidden');
  $('pause').classList.add('hidden');
  menu.hideResults();
  menu.show();
}

// -------------------------------------------------------------- pause menu
input.onPause = () => {
  if (!inMatch || game.matchEnded) return;
  const online = currentConfig?.online;
  $('pause').classList.remove('hidden');
  input.exitLock();
  if (!online) game.setPaused(true);
};
input.onToggleScoreboard = (held) => game.setScoreboardHeld(held);

$('resumeBtn').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  game.setPaused(false);
  input.enabled = true;
  input.requestLock();
});
$('restartBtn').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  restartMatch();
});
$('quitBtn').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  backToMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && inMatch && !input.locked) {
    const pauseShown = !$('pause').classList.contains('hidden');
    if (pauseShown) {
      $('pause').classList.add('hidden');
      game.setPaused(false);
      input.requestLock();
    }
  }
});

canvas.addEventListener('click', () => {
  if (inMatch && !input.locked && $('pause').classList.contains('hidden') && $('results').classList.contains('hidden')) {
    input.enabled = true;
    input.requestLock();
    audio.resume();
  }
});

// keep the renderer sized correctly when iPadOS shows/hides its browser chrome
window.addEventListener('orientationchange', () => setTimeout(() => game.resize(), 250));

boot();

// expose a little debug surface for the browser console
window.BLACKOUT = { game, net, settings, menu, saveSettings };
