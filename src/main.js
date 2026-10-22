import { installFullscreen } from './ui/Fullscreen.js';
if (!isCrazyGames()) installFullscreen();
import './style.css';
import { installRoomChat } from './ui/RoomChat.js';
import { Game } from './core/Game.js';
import { UserAccount } from './core/UserAccount.js';
import { isCrazyGames, requestCrazyGamesLogin } from './core/CrazyGamesAccount.js';
import { prepareCrazyGamesPlatform, installCrazyGamesPlatform } from './core/CrazyGamesPlatform.js';

try { await UserAccount.restore(); }
catch (error) {
  if (!isCrazyGames()) throw error;
  document.getElementById('boot-status').textContent = 'Unable to connect your CrazyGames account';
  document.getElementById('boot-detail').textContent = error.message;
  const retry = document.getElementById('boot-retry');
  retry.classList.remove('hidden');
  retry.onclick = () => location.reload();
  // Do not start a match with an unverified or stale identity.
  await new Promise(() => {});
}

const platform = await prepareCrazyGamesPlatform();
if (platform) {
  document.title = 'KRYX';
  const brand = document.querySelector('.nav-brand');
  if (brand) { brand.textContent = 'KRYX'; brand.setAttribute('aria-label', 'KRYX'); }
}
const canvas = document.getElementById('game-canvas');
const game = new Game(canvas);
if (isCrazyGames()) {
  for (const el of document.querySelectorAll('[data-dd="store"], [data-panel="loadout"], [data-panel="shop"], [data-panel="battlepass"], [data-panel="party"], [data-panel="tournaments"], a[href^="/earnings"], a[href="/community.html"]')) el.remove();
  game.menu.onLoginRequest = () => requestCrazyGamesLogin().catch(() => {});
  game.menu.onLogout = () => {};
  const login = document.getElementById('nav-login-link');
  if (login) {
    login.textContent = 'Login with CrazyGames';
    login.removeAttribute('href');
    login.setAttribute('role', 'button');
    login.tabIndex = 0;
    login.addEventListener('click', event => { event.preventDefault(); game.menu.onLoginRequest(); });
    login.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); game.menu.onLoginRequest(); }
    });
  }
  document.getElementById('nav-register-link')?.remove();
  for (const id of ['nav-logout-btn', 'profile-logout-btn']) {
    const button = document.getElementById(id);
    if (button) button.style.display = 'none';
  }
}
if (!isCrazyGames()) installRoomChat(game);
installCrazyGamesPlatform(game, platform);
// Dev/diagnostic handle (also lets visual QA inspect live bot transforms).
// Production only exposes it when a deliberate local QA query is present.
const qaRequested = new URLSearchParams(location.search).has('qa');
if (import.meta.env?.DEV || qaRequested) {
  window.__game = game;
}
if (qaRequested) {
  // EffectComposer normally resets renderer.info after each pass, which leaves
  // only the final one-triangle output pass visible to QA. Accumulate the whole
  // frame so draw-call/triangle measurements describe the actual workload.
  game.renderer.info.autoReset = false;
  game._qaFrameStats = { elapsed: 0, frames: 0, maxMs: 0, slow20: 0, last: null };
  const qaState = document.createElement('output');
  qaState.id = 'qa-runtime';
  qaState.hidden = true;
  document.body.appendChild(qaState);
  const followBot = document.createElement('button');
  followBot.id = 'qa-follow-bot';
  followBot.textContent = 'FOLLOW BOT';
  followBot.style.cssText = 'position:fixed;left:12px;top:12px;z-index:20000;padding:8px;background:#111b;color:#fff;border:1px solid #7de';
  let qaFollowing = false;
  const followFirstBot = () => {
    if (game.state !== 'playing') return;
    let bot = null;
    let observer = null;
    for (const candidate of game.botManager.bots) {
      if (!candidate.alive) continue;
      for (let i = 0; i < 12; i++) {
        const angle = candidate.mesh.rotation.y + Math.PI * 0.35 + i * Math.PI / 6;
        const x = candidate.position.x + Math.sin(angle) * 5.5;
        const z = candidate.position.z + Math.cos(angle) * 5.5;
        const y = game.world.groundHeightAt(x, z, candidate.position.y + 1, candidate.position.y - 1);
        if (Number.isFinite(y) && y > game.world.killY && Math.abs(y - candidate.position.y) < 1.5) {
          bot = candidate;
          observer = new game.player.position.constructor(x, y, z);
          break;
        }
      }
      if (observer) break;
    }
    if (!observer) return;
    game.player.respawn(observer);
    const dx = bot.position.x - game.player.position.x;
    const dz = bot.position.z - game.player.position.z;
    game.player.yaw = Math.atan2(-dx, -dz);
    game.player.pitch = -0.04;
  };
  followBot.addEventListener('click', () => { qaFollowing = true; followFirstBot(); });
  document.body.appendChild(followBot);
  setInterval(() => {
    if (qaFollowing) followFirstBot();
    const snapshot = JSON.stringify({
      state: game.state,
      render: {
        calls: game.renderer.info.render.calls,
        triangles: game.renderer.info.render.triangles,
        geometries: game.renderer.info.memory.geometries,
        textures: game.renderer.info.memory.textures,
        pixelRatio: game.renderer.getPixelRatio(),
        bloom: !!game._bloomEnabled,
        runtimeQuality: game._runtimeQuality,
      },
      frame: game._qaFrameStats.last,
      spectator: {
        x: game.menuCamera.position.x,
        y: game.menuCamera.position.y,
        z: game.menuCamera.position.z,
        route: game._camRouteIndex,
        travelTime: game._camTravelTime,
      },
      match: {
        start: game._selectedMatch?.matchStart ?? game._authNet?.client?.matchStart ?? null,
        durationMs: game._selectedMatch?.matchDurationMs ?? game._authNet?.client?.matchDurationMs ?? null,
      },
      bots: game.botManager.bots.map((bot) => ({
        id: bot.id, name: bot.displayName, alive: bot.alive,
        armor: bot.armorTypeId, skin: bot.skin?.id,
        x: bot.position.x, y: bot.position.y, z: bot.position.z,
        pitch: bot.mesh.rotation.x, yaw: bot.mesh.rotation.y, roll: bot.mesh.rotation.z,
        speed: bot._animSpeed, engaged: bot._provoked,
        grounded: bot._onGround, verticalSpeed: bot._velY, stuck: bot._stuckT,
        roamX: bot.wanderTarget?.x, roamZ: bot.wanderTarget?.z,
      })),
    });
    qaState.value = snapshot;
    qaState.textContent = snapshot;
  }, 250);
}
