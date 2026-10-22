import { getCrazyGamesSDK, isCrazyGames } from './CrazyGamesAccount.js';

let roomCode = null;
export function validCrazyRoom(value) {
  return typeof value === 'string' && /^cg-[a-f0-9-]{36}$/.test(value) ? value : null;
}
export function platformMatchTargets(targets) {
  if (!isCrazyGames() || !roomCode) return targets;
  return targets.map(target => { const url = new URL(target, location.href); url.searchParams.set('cgroom', roomCode); return url.href; });
}
export async function prepareCrazyGamesPlatform() {
  if (!isCrazyGames()) return null;
  const sdk = await getCrazyGamesSDK();
  const invited = sdk.game.inviteParams;
  roomCode = validCrazyRoom(invited?.roomName);
  if (!roomCode && sdk.game.isInstantMultiplayer) roomCode = 'cg-' + crypto.randomUUID();
  if (invited?.mode || roomCode) {
    const url = new URL(location.href);
    url.searchParams.set('mode', invited?.mode === 'survival' ? 'survival' : 'deathmatch');
    history.replaceState(null, '', url);
  }
  sdk.game.loadingStart();
  return sdk;
}

export function installCrazyGamesPlatform(game, sdk) {
  if (!sdk) return;
  const applySettings = settings => game.audio.setPlatformMuted(settings.muteAudio === true);
  applySettings(sdk.game.settings || {});
  sdk.game.addSettingsChangeListener(applySettings);
  const join = async params => {
    const next = validCrazyRoom(params?.roomName);
    if (params?.roomName && !next) return;
    const mode = params?.mode === 'survival' ? 'survival' : 'deathmatch';
    await game._startupReadyPromise;
    game._openMenu();
    game._matchJoinAbort?.abort();
    await game._matchJoinPromise?.catch(() => {});
    game._authNet?.disconnect();
    game._authNet = undefined;
    roomCode = next;
    const url = new URL(location.href); url.searchParams.set('mode', mode); history.replaceState(null, '', url);
    game.menu.selectedModeId = mode;
    game.state = 'menu';
    await game._prepareAuthoritativeMatch(game.player.name, mode);
    game.menu.playBtn.click();
  };
  sdk.game.addJoinRoomListener(params => { void join(params).catch(() => game._showServerJoinError()); });
  let loading = true, playing = false, roomState = '', inviteUrl = '';
  game.onPlatformGameplayChange = active => {
    if (active === playing) return;
    playing = active;
    try { sdk.game[playing ? 'gameplayStart' : 'gameplayStop'](); }
    catch { console.warn('[CrazyGames] gameplay event unavailable'); }
  };
  const share = document.getElementById('share-game');
  if (share) {
    share.setAttribute('role', 'button'); share.tabIndex = 0;
    const copy = () => { if (inviteUrl) navigator.clipboard.writeText(inviteUrl).then(() => { share.textContent = 'Invite link copied'; }).catch(() => {}); };
    share.addEventListener('click', copy);
    share.addEventListener('keydown', e => { if (e.key === 'Enter') copy(); });
  }
  const timer = setInterval(() => {
    if (game._disposed) { clearInterval(timer); sdk.game.leftRoom(); return; }
    const client = game._authNet?.client;
    const isLoading = !game._authNet?.ready || game._authoritativeMapTransitioning === true;
    if (isLoading !== loading) { loading = isLoading; sdk.game[loading ? 'loadingStart' : 'loadingStop'](); }
    const active = !loading && game.state === 'playing' && !game._menuOpen;
    game.onPlatformGameplayChange(active);
    const mode = game.menu.selectedModeId === 'survival' ? 'survival' : 'deathmatch';
    const humans = (client?.roster || []).filter(p => !p.isBot).length;
    const capacity = game._selectedMatch?.capacity || 8;
    const nextState = client?.connected ? `${mode}:${roomCode || 'public'}:${humans < capacity}` : '';
    if (nextState !== roomState) {
      roomState = nextState;
      if (!roomState) { sdk.game.leftRoom(); inviteUrl = ''; return; }
      const inviteParams = { mode, ...(roomCode ? { roomName: roomCode } : {}) };
      sdk.game.updateRoom({ roomId: `kryx:${mode}:${roomCode || 'public'}`, isJoinable: humans < capacity, inviteParams });
      inviteUrl = sdk.game.inviteLink(inviteParams);
    }
  }, 150);
  const notice = document.createElement('small');
  notice.style.cssText = 'display:block;margin-top:18px;font-size:12px;letter-spacing:normal';
  notice.append('Your account name and progress are saved by KRYX. ');
  const privacy = document.createElement('a');
  privacy.href = '/privacy'; privacy.target = '_blank'; privacy.rel = 'noopener'; privacy.textContent = 'Privacy policy';
  notice.append(privacy);
  document.getElementById('center-play')?.append(notice);
  if (sdk.game.isInstantMultiplayer || validCrazyRoom(sdk.game.inviteParams?.roomName) || sdk.game.inviteParams?.mode) {
    void game._startupReadyPromise.then(() => game.menu.playBtn.click());
  }
}
