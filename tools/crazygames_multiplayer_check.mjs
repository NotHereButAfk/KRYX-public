import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { makeAuthServer } from '../server/authserver.mjs';
import { matchmakingUrlFor } from '../src/net/Matchmaker.js';
import { validCrazyRoom, platformMatchTargets, prepareCrazyGamesPlatform, installCrazyGamesPlatform } from '../src/core/CrazyGamesPlatform.js';
import { AudioManager } from '../src/core/AudioManager.js';

const code='cg-11111111-1111-4111-8111-111111111111';
assert.equal(validCrazyRoom(code),code);
assert.equal(validCrazyRoom('../anything'),null);
assert.equal(new URL(matchmakingUrlFor(`ws://localhost:8788/?cgroom=${code}&mode=survival`)).searchParams.get('cgroom'),code);
globalThis.location={pathname:'/crazygames.html',href:'https://kryx.live/crazygames.html'};
globalThis.history={replaceState(_a,_b,url){location.href=String(url);}};
const calls=[];
let tick,joinListener,settingsListener;
const sdk={init:async()=>{},game:{inviteParams:{roomName:code,mode:'deathmatch'},settings:{muteAudio:true},
  loadingStart(){calls.push('loadingStart');},loadingStop(){calls.push('loadingStop');},
  gameplayStart(){calls.push('gameplayStart');},gameplayStop(){calls.push('gameplayStop');},
  addSettingsChangeListener(fn){settingsListener=fn;},addJoinRoomListener(fn){joinListener=fn;},
  updateRoom(room){calls.push(room);},leftRoom(){calls.push('leftRoom');},inviteLink(){return 'https://www.crazygames.com/game/kryx';}}};
globalThis.window={top:{},self:{},CrazyGames:{SDK:sdk}};
assert.equal(await prepareCrazyGamesPlatform(),sdk);
assert.equal(new URL(platformMatchTargets(['wss://kryx.live'])[0]).searchParams.get('cgroom'),code);
const { preloadEvCharacter } = await import('../src/player/EvCharacter.js');
const { preloadViewmodelArms } = await import('../src/player/ViewmodelArms.js');
const { preloadAuthoredSkin } = await import('../src/player/AuthoredSkins.js');
const { preloadAuthoredWeaponSkin } = await import('../src/weapons/AuthoredWeaponSkins.js');
assert.equal(await preloadEvCharacter(),false);
let arms; preloadViewmodelArms(value=>{arms=value;}); assert.equal(arms,false);
assert.equal(await preloadAuthoredSkin({id:'imported',model:'/must-not-load.glb'}),null);
assert.equal(await preloadAuthoredWeaponSkin({id:'imported',model:'/must-not-load.glb'}),null);
const realInterval=globalThis.setInterval;
globalThis.setInterval=fn=>{tick=fn;return 1;};
globalThis.document={getElementById(){return null;},createElement(){return {style:{},append(){}};}};
const audio=new AudioManager();audio.master={gain:{value:0.7}};audio.ctx={};audio._volume=0.7;
let played=0;
const game={audio,state:'menu',_startupReadyPromise:Promise.resolve(),menu:{selectedModeId:'deathmatch',playBtn:{click(){played++;}}},_authNet:{ready:true,client:{connected:true,roster:[]}}};
installCrazyGamesPlatform(game,sdk);
await Promise.resolve();assert.equal(played,1);assert.equal(audio.master.gain.value,0);
audio.setVolume(0.9);assert.equal(audio.master.gain.value,0);
settingsListener({muteAudio:false});assert.equal(audio.master.gain.value,0.9);
tick();assert(calls.includes('loadingStop'));assert(calls.some(c=>c.roomId===`kryx:deathmatch:${code}`));
game.onPlatformGameplayChange(true);
game.onPlatformGameplayChange(false);
assert.deepEqual(calls.slice(-2), ['gameplayStart','gameplayStop'], 'brief gameplay transitions must not be lost between polls');
game.state='playing';tick();assert(calls.includes('gameplayStart'));
game._menuOpen=true;tick();assert(calls.includes('gameplayStop'));
await joinListener({roomName:'../../invalid'});
globalThis.setInterval=realInterval;

const server=makeAuthServer({port:0,accountService:null});
await new Promise(r=>server.http.listen(0,'127.0.0.1',r));
const port=server.http.address().port;
const sockets=[];
async function connect(name,room=code){
  const ws=new WebSocket(`ws://127.0.0.1:${port}/?cgroom=${room}`,{origin:'http://localhost'});sockets.push(ws);
  return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('welcome timeout')),5000);ws.on('open',()=>ws.send(JSON.stringify({t:'hello',name})));ws.on('message',raw=>{const m=JSON.parse(raw);if(m.t==='welcome'){clearTimeout(timer);resolve(m);}});ws.on('error',reject);});
}
try {
  await connect('FriendOne');await connect('FriendTwo');
  const entry=server.rooms.get('deathmatch:'+code);
  assert.deepEqual([...entry.room.players.values()].filter(p=>!p.isBot).map(p=>p.name).sort(),['FriendOne','FriendTwo']);
  assert.equal(entry.economy,null);
  assert.equal([...server.room.players.values()].filter(p=>!p.isBot).length,0);
  const result=await (await fetch(`http://127.0.0.1:${port}/api/matchmake?cgroom=${code}`)).json();
  assert.equal(result.humans,2);assert.equal(result.capacity,8);
  const ids=[...entry.room.players.values()].filter(p=>!p.isBot).map(p=>p.id);
  entry.room._rotateMatch(entry.room.matchStart+entry.room.matchDurationMs+1);
  entry.room._rotateMatch(entry.room._postMatchUntil+1);
  assert(ids.every(id=>entry.room.players.has(id)), 'friends lost during map rotation');
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/matchmake?cgroom=invalid`)).status,404);
} finally {for(const ws of sockets)ws.terminate();await server.close();}
console.log('PASS CrazyGames room isolation, two-player invitations, discovery, safe room IDs, automatic entry, lifecycle and enforced platform mute');
