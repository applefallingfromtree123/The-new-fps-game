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
const input = new Input(canvas, settings);
const game = new Game({ canvas, hud, input, settings });
const menu = new MenuUI(settings);

let pendingStart = null;      // config for the queued/online match
let currentConfig = null;
let inMatch = false;

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
  menu.setNetStatus(false, 0);
  if (pendingStart) { menu.hideMatchmaking(); pendingStart = null; }
});
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
      alert('온라인 모드는 서버 연결이 필요합니다. 서버를 실행한 뒤 다시 시도하세요.\n(npm start)');
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
  el.classList.remove('hidden');
  const go = () => {
    el.classList.add('hidden');
    input.enabled = true;
    input.requestLock();
    audio.init();
    audio.resume();
  };
  el.onclick = go;
  // pointer lock needs a user gesture, so we wait for the click
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
  if (!online) game.setPaused(true);
};
input.onToggleScoreboard = (held) => game.setScoreboardHeld(held);

$('resumeBtn').addEventListener('click', () => {
  $('pause').classList.add('hidden');
  game.setPaused(false);
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

boot();

// expose a little debug surface for the browser console
window.BLACKOUT = { game, net, settings, menu, saveSettings };
