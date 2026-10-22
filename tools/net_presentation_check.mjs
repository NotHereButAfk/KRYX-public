#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { AuthClient, interpolateRemoteSample } from '../src/net/AuthClient.js';
import { nearestSpawnYaw } from '../src/net/AuthNetBridge.js';
import { chooseSafeSpawn } from '../server/authroom.mjs';

let passed = 0;
const ok = (name, condition) => {
  if (!condition) throw new Error(`FAIL ${name}`);
  passed++;
  console.log(`ok   ${name}`);
};

const samples = [
  { t: 1000, x: 0, y: 0, z: 0, yaw: Math.PI - 0.1, vx: 10, vy: 0, vz: 0, health: 100 },
  { t: 1050, x: 0.5, y: 0, z: 0, yaw: -Math.PI + 0.1, vx: 10, vy: 0, vz: 0, health: 80 },
];
const middle = interpolateRemoteSample(samples, 1025);
ok('server-time samples interpolate smoothly between 20Hz ticks', Math.abs(middle.x - 0.25) < 1e-9);
ok('yaw takes the short path across the pi seam', Math.abs(Math.abs(middle.yaw) - Math.PI) < 0.02);
const extrapolated = interpolateRemoteSample(samples, 1300);
for (let i=0;i<=100;i++) {
  const stopping=[{...samples[0],vx:14},{...samples[1],vx:0}];
  const s=interpolateRemoteSample(stopping,1000+i*.5);
  ok('smoothed stop stays within collision-checked endpoints',s.x>=0 && s.x<=.5);
}
ok('remote extrapolation is capped at 75ms', Math.abs(extrapolated.x - 1.25) < 1e-9);

const smoothClient = new AuthClient('ws://invalid');
smoothClient.sim = { px: 10, py: 2, pz: -4 };
smoothClient._visualOffset = { x: 0.3, y: -0.1, z: 0.2 };
const beforeSmooth = smoothClient.localPos();
smoothClient.advancePresentation(1 / 60);
const afterSmooth = smoothClient.localPos();
ok('local camera correction decays continuously instead of snapping at 20Hz',
  afterSmooth.x < beforeSmooth.x && afterSmooth.x > smoothClient.sim.px);
const sixtyHz = smoothClient._visualOffset.x;
smoothClient._visualOffset.x = 0.3;
smoothClient.advancePresentation(1 / 120);
smoothClient.advancePresentation(1 / 120);
ok('local correction smoothing is frame-rate independent',
  Math.abs(smoothClient._visualOffset.x - sixtyHz) < 1e-9);
smoothClient.sim.vx = 8;
smoothClient.sim.vy = 0;
smoothClient.sim.vz = -4;
smoothClient._previousSim={px:9.6,py:2,pz:-3.8};
const betweenTicks = smoothClient.localPos(0.025);
ok('local camera fills the render gap between 20Hz prediction ticks',
  Math.abs(betweenTicks.x - (smoothClient.sim.px - 0.2 + smoothClient._visualOffset.x)) < 1e-9
  && Math.abs(betweenTicks.z - (smoothClient.sim.pz + 0.1 + smoothClient._visualOffset.z)) < 1e-9);

smoothClient.resetPresentation();
const stopped=smoothClient.localPos(0.049);
ok('stopped camera never extrapolates beyond the collision-checked position',stopped.x===smoothClient.sim.px&&stopped.z===smoothClient.sim.pz);
// Render a moving/stopping sequence at 120 Hz. Reaching a wall must never
// overshoot and pull the camera backwards at the next prediction boundary.
let lastCamera = -Infinity;
let monotonic = true;
smoothClient._visualOffset = { x: 0, y: 0, z: 0 };
for (let tick=0; tick<8; tick++) {
  const previous = Math.min(tick * 0.4, 1.2);
  const current = Math.min((tick+1) * 0.4, 1.2);
  smoothClient._previousSim = {px:previous,py:0,pz:0};
  smoothClient.sim = {...smoothClient.sim,px:current,py:0,pz:0,vx:8};
  for (let frame=0; frame<6; frame++) {
    const x=smoothClient.localPos(frame/120).x;
    monotonic &&= x >= lastCamera - 1e-9 && x <= 1.2 + 1e-9;
    lastCamera=x;
  }
}
ok('camera advances monotonically and settles at a wall without overshoot',monotonic);
const safe = chooseSafeSpawn([[0, 0, 0], [12, 0, 0], [48, 0, 0]], [[1, 0, 0]], 0);
ok('spawn selection avoids occupied combat space', safe[0] === 48);
const authoredSpawns = [
  { x: 80, y: 3, z: 40, spawnYaw: -1.2 },
  { x: -12, y: 4, z: 9, spawnYaw: 0.65 },
];
ok('authoritative spawn adopts the matching authored camera direction',
  nearestSpawnYaw(authoredSpawns, -11.8, 4, 9.1, Math.PI) === 0.65);
ok('spawn-facing lookup does not turn a player who has already moved away',
  nearestSpawnYaw(authoredSpawns, 200, 4, 200, Math.PI) === Math.PI);

const rotationClient = new AuthClient('ws://invalid');
rotationClient.mapId = 'rook';
rotationClient.simWorld = { half: 100, killY: -25, noBaseFloor: false, platforms: [], boxes: [], gravLifts: [], teleporters: [] };
rotationClient.sim = { px: 0, py: 2, pz: 0, vx: 0, vy: 0, vz: 0, eye: 1.7, onGround: true };
rotationClient.pending = [{ seq: 41, inp: { f: 1, r: 0, jump: false, crouch: false, yaw: 0 } }];
rotationClient._acc = 0.04;
rotationClient._reconcile({
  tick: 100, ack: 40, mapId: 'winter-graveyard', mapName: 'Winter Graveyard',
  matchStart: Date.now(), matchDurationMs: 180000,
  arena: { id: 'winter-graveyard', half: 100, killY: -25, noBaseFloor: false, platforms: [], boxes: [] },
  you: { x: 24, y: 4, z: -12, vx: 0, vy: 0, vz: 0, health: 100, shield: 0, alive: true, mag: 30, reserve: 90, kills: 0, deaths: 0, score: 0 },
  players: [], smokes: [],
});
ok('map rotation discards movement predicted against the previous arena',
  rotationClient.pending.length === 0 && rotationClient._acc === 0
  && rotationClient.sim.px === 24 && rotationClient.sim.py === 4 && rotationClient.sim.pz === -12);

// Exercise the actual wire snapshot -> interpolation -> skinned avatar path.
const { default: assert } = await import('node:assert/strict');
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { installEvCharacter } = await import('../src/player/EvCharacter.js');
const { Avatar } = await import('../src/player/Avatar.js');
globalThis.ProgressEvent ??= class { constructor(type, data) { Object.assign(this, { type }, data); } };
const modelBytes = readFileSync(new URL('../public/ev-default.glb', import.meta.url));
installEvCharacter(await new GLTFLoader().parseAsync(modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength), ''));
const body = new Avatar(new THREE.Scene());
let frameTick = 200;
for (const contact of [1, 0, false, true, undefined]) {
  rotationClient._reconcile({ tick: frameTick++, ack: 40, mapId: 'winter-graveyard',
    you: { x: 24, y: 4, z: -12, health: 100, alive: true },
    players: [{ id: 'airborne', x: 0, y: 4, z: 0, yaw: 0, vx: 6, vy: contact === 0 ? 8 : -8,
      vz: 0, onGround: contact, sprint: true, alive: true, health: 100 }], events: [] });
  const buffer = rotationClient.remotes.get('airborne').buf;
  const sample = interpolateRemoteSample(buffer, buffer.at(-1).t);
  const grounded = contact == null ? true : !!contact;
  assert.equal(sample.grounded, grounded);
  for (let f = 0; f < 60; f++) body.update(1 / 60, {
    ...sample, position: new THREE.Vector3(f / 10, 4, 0), speed: 6, grounded: sample.grounded });
  const actions = body.group.userData.animationActions;
  assert(actions[grounded ? 1 : 12].getEffectiveWeight() > 0.99);
  assert.equal(body.group.position.y, 4, 'model must follow the physical capsule height');
  ok(`wire grounded=${contact} selects ${grounded ? 'walking cycle after landing' : 'airborne pose'}`, true);
}
body.dispose();

const bridge = readFileSync(new URL('../src/net/AuthNetBridge.js', import.meta.url), 'utf8');
ok('authoritative enemies render a health bar', /np-bar-fg/.test(bridge) && /healthFg\.style\.width/.test(bridge));
ok('multiplayer names have no BOT badge', !/botBadge|np-bot/.test(bridge));
ok('remote gunfire renders replicated bullet tracers',
  /e\.e === 'shot'[\s\S]*?showAuthoritativeTracer/.test(bridge));
ok('remote rockets render replicated explosion effects',
  /e\.kind === 'rocket'[\s\S]*?showAuthoritativeExplosion/.test(bridge));

const avatar = readFileSync(new URL('../src/player/Avatar.js', import.meta.url), 'utf8');
ok('remote directional animation owns its scratch vector',
  /const _v = new THREE\.Vector3\(\)/.test(avatar) && /_v\.copy\(s\.position\)/.test(avatar));

const game = readFileSync(new URL('../src/core/Game.js', import.meta.url), 'utf8');
ok('authoritative join does not spawn a duplicate local roster', /if \(expectsAuth\)[\s\S]*?botManager\.clear\(\)[\s\S]*?serverSim\.stop\(\)/.test(game));
ok('authoritative map rotation loads immediately without a stale-map leaderboard',
  /while \(this\.world\.currentMapId !== this\._authoritativeMapTarget\)[\s\S]*?await this\._activateMap\(target(?:,|\))/.test(game));
ok('authoritative join waits for the arena-ready transition before releasing play',
  /await game\._finishServerJoining\?\.\(\);[\s\S]*?this\.ready = true;[\s\S]*?this\._resolveReady/.test(bridge));

console.log(`net presentation passed (${passed} checks)`);

{
const THREE = await import('three');
const {Avatar} = await import('../src/player/Avatar.js');
const {AuthNetBridge} = await import('../src/net/AuthNetBridge.js');
const {WEAPONS} = await import('../src/weapons/weaponDefs.js');
const {buildWeaponModel} = await import('../src/weapons/WeaponModels.js');
for (const def of WEAPONS.filter(w => w.kind !== 'melee')) {
  const avatar = Object.create(Avatar.prototype);
  avatar.group = new THREE.Group();
  const built = buildWeaponModel(def, {procedural: true});
  avatar.weapon = built.group; avatar.muzzle = built.muzzle; avatar.weaponId = def.id;
  avatar.group.add(avatar.weapon);
  avatar.group.position.set(7, 2, -3); avatar.group.rotation.y = .8;
  avatar.weapon.position.set(.3, 1.4, -.2); avatar.weapon.rotation.x = -.3;
  avatar.group.updateMatrixWorld(true);
  const expected = avatar.muzzle.getWorldPosition(new THREE.Vector3());
  let shot;
  const event = {e:'shot', by:2, wid:def.id, x:7,y:3.5,z:-3,tx:20,ty:2,tz:-30};
  AuthNetBridge.prototype._drainEvents.call({
    client:{you:1,drainEvents:()=>[event]}, remotes:new Map([[2,{avatar}]]),
    game:{weaponSystem:{showAuthoritativeTracer:(id,from,to)=>{shot={id,from,to};}}},
  });
  if (!shot || shot.from.distanceTo(expected) > 1e-6) throw Error('Tracer missed muzzle: ' + def.id);
  if (shot.to.distanceTo(new THREE.Vector3(20,2,-30)) > 1e-6) throw Error('Tracer changed hit endpoint');
}
console.log('Remote tracer origins follow every firearm muzzle through translated/rotated carry poses.');

}

{
 const c = new AuthClient('unused');
 c._serverClockOffset = performance.now();
 const hit = {e:'hit'}, shot = {e:'shot',_renderAt:1000};
 c.events=[shot,hit];
 if(c.drainEvents()[0] !== hit || c.events[0] !== shot) throw Error('hit confirmation must remain immediate while remote shot waits for pose');
 c._serverClockOffset = performance.now() - 2000;
 if(c.drainEvents()[0] !== shot || c.events.length) throw Error('shot must render once on its pose timeline');
 console.log('Remote shot timing matches interpolated poses; hit feedback stays immediate.');
}

// Missing/swapping/hidden weapons must never emit a chest-origin fallback.
for (const avatar of [undefined, {weaponId:'magnum',group:new (await import('three')).Group()},
 {weaponId:'m4',group:{visible:false}}, {weaponId:'m4',group:{visible:true},getMuzzleWorldPosition:()=>null}]) {
 const {AuthNetBridge}=await import('../src/net/AuthNetBridge.js');
 let count=0;
 AuthNetBridge.prototype._drainEvents.call({client:{you:1,drainEvents:()=>[{e:'shot',by:2,wid:'m4',x:0,y:1,z:0,tx:0,ty:1,tz:-10}]},remotes:new Map([[2,{avatar}]]),game:{weaponSystem:{showAuthoritativeTracer:()=>count++}}});
 if(count)throw Error('Body fallback tracer escaped');
}
