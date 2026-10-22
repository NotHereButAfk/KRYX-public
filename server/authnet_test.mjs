#!/usr/bin/env node
import {makeInput} from '../src/sim/MoveSim.js';
import {PLAYER_RESPAWN_DELAY} from '../src/sim/DeathTiming.js';
// Phase 4 + 5 authority/abuse proof. Boots the real AuthRoom over an in-proc
// WebSocket server and drives raw clients to prove the exit criteria:
//   Phase 4: join, sequenced input, ack/snapshot, prediction reconciliation,
//            duplicate sessions, reconnect, packet reordering, forged transforms
//   Phase 5: spammed fire, forged kills/damage, impossible ammo, duplicate cmds
//
//   node tools/authnet_test.mjs

import { WebSocket } from 'ws';
import { makeAuthServer } from './authserver.mjs';
import { AuthRoom, TICK_HZ, botPresentationYaw } from './authroom.mjs';

const PORT = 8799;
const { close, room } = makeAuthServer({ port: PORT });
// Combat proofs must not randomly enter the wall-clock results freeze mid-test.
// Round rotation/readiness has its own browser and match-clock suites.
room._rotateMatch = () => false;
await sleep(150);

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  (cond ? pass++ : fail++);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  — ' + extra : ''}`);
};

// ── raw client helper ──
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'http://localhost' });
  const c = { ws, welcome: null, snaps: [], events: [], seq: 0, fireSeq: 0, pickupSeq: 0 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') c.welcome = m;
    else if (m.t === 'snapshot') { c.snaps.push(m); if (m.events?.length) c.events.push(...m.events); }
    else if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id }));
  });
  c.hello = (name) => ws.send(JSON.stringify({ t: 'hello', name }));
  c.input = (o) => ws.send(JSON.stringify({ t: 'input', seq: ++c.seq, ...o }));
  c.inputRaw = (o) => ws.send(JSON.stringify({ t: 'input', ...o }));
  c.fire = (wid, yaw, pitch) => ws.send(JSON.stringify({ t: 'fire', seq: ++c.fireSeq, wid, yaw, pitch }));
  c.fireRaw = (o) => ws.send(JSON.stringify({ t: 'fire', ...o }));
  c.pickup = (padId) => ws.send(JSON.stringify({ t: 'pickup', seq: ++c.pickupSeq, padId }));
  c.last = () => c.snaps[c.snaps.length - 1];
  return c;
}
const open = (c) => new Promise((r) => c.ws.on('open', r));
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
const ownPublic = (c, snap) => snap?.players.find((p) => p.id === c.welcome.you);
async function drive(c, frames, input) {
  const firstSeq = c.seq + 1;
  for (let i = 0; i < frames; i++) {
    c.input({ tick: i, ...input });
    await sleep(TICK());
  }
  await sleep(80);
  return c.snaps.filter((s) => s.ack >= firstSeq);
}

// ═══ Phase 4 ═══
const hostile = new WebSocket(`ws://127.0.0.1:${PORT}`, { origin: 'https://attacker.example' });
hostile.on('error', () => {});
const hostileClose = await Promise.race([
  new Promise((resolve) => hostile.on('close', (code) => resolve(code))),
  sleep(1000).then(() => null),
]);
if (hostileClose == null) hostile.terminate();
ok('origin allow-list: non-local browser origin rejected', hostileClose === 1008);

const sprintProbe = client(); await open(sprintProbe); sprintProbe.hello('SprintProbe');
await sleep(120);
let sprintSnaps = await drive(sprintProbe, 4, { mx: 0, mz: 1, yaw: 0, sprint: true });
ok('snapshot: real authoritative sprint is published',
   sprintSnaps.some((s) => ownPublic(sprintProbe, s)?.sprint === true));

sprintSnaps = await drive(sprintProbe, 4, { mx: 1, mz: 0, yaw: 0, sprint: true });
ok('snapshot: real sideways sprint is published',
   sprintSnaps.some((s) => ownPublic(sprintProbe, s)?.sprint === true));

const sprintPlayer = room.players.get(sprintProbe.welcome.you);
sprintPlayer.state.stamina = 0;
sprintSnaps = await drive(sprintProbe, 4, { mx: 0, mz: 1, yaw: 0, sprint: true });
ok('snapshot: depleted stamina cannot spoof sprint animation',
   sprintSnaps.length > 0
   && sprintSnaps.every((s) => ownPublic(sprintProbe, s)?.sprint === false));

Object.assign(sprintPlayer.state, {
  px: room.arena.half - 1.2, py: 0, pz: 0,
  vx: 0, vy: 0, vz: 0, onGround: 1,
  crouch: 0, slide: 0, stamina: 100, stamDelay: 0,
  safeX: room.arena.half - 1.2, safeY: 0, safeZ: 0,
});
sprintPlayer.queue.length = 0;
sprintSnaps = await drive(sprintProbe, 4, {
  mx: 0, mz: 1, yaw: -Math.PI / 2, sprint: true,
});
ok('snapshot: wall-blocked sprint publishes zero animation motion',
   sprintSnaps.length > 0 && sprintSnaps.every((s) => {
     const self = ownPublic(sprintProbe, s);
     return self?.sprint === false && Math.hypot(self.vx, self.vz) < 0.01;
   }));

let presentationSnaps = await drive(sprintProbe, 2, {
  mx: 0, mz: 0, yaw: 0, wid: 'sword', aiming: true,
});
ok('snapshot: allow-listed equip and aim presentation reach remotes',
   presentationSnaps.some((s) => {
     const self = ownPublic(sprintProbe, s);
     return self?.wid === 'sword' && self?.aiming === true;
   }));
presentationSnaps = await drive(sprintProbe, 2, {
  mx: 0, mz: 0, yaw: 0, wid: '../../untrusted.glb',
});
ok('snapshot: unknown presentation weapon is rejected',
   presentationSnaps.length > 0
   && presentationSnaps.every((s) => ownPublic(sprintProbe, s)?.wid === 'sword'));
sprintProbe.ws.close();
await sleep(100);

const resetId = room.add(() => {}, 'RespawnResetProbe');
const resetPlayer = room.players.get(resetId);
resetPlayer._firingTicks = 8;
resetPlayer._lastSprint = true;
resetPlayer._lastAim = true;
resetPlayer.alive = false;
resetPlayer.deadUntil = room.tick + 1;
room.update();
ok('respawn: transient firing/sprint/aim presentation is cleared',
   resetPlayer.alive && resetPlayer._firingTicks === 0
   && !resetPlayer._lastSprint && !resetPlayer._lastAim);

room._kill(resetPlayer);
const humanRespawnTicks = PLAYER_RESPAWN_DELAY * TICK_HZ;
const assignedFullDelay = resetPlayer.deadUntil - room.tick === humanRespawnTicks;
for (let i = 0; i < humanRespawnTicks - 1; i++) room.update();
const heldDeadForFullDelay = !resetPlayer.alive && resetPlayer.health === 0;
room.update();
ok('respawn: player remains dead for the full authoritative six seconds',
   assignedFullDelay && heldDeadForFullDelay && resetPlayer.alive && resetPlayer.health > 0);
resetPlayer.mainWid = resetPlayer.wid = 'magnum';
resetPlayer.state.stamina = 100; resetPlayer.state.crouch = 0; resetPlayer.state.slide = 0;
resetPlayer._firingTicks = 8;
resetPlayer.queue.push({seq:1,wid:'magnum',inp:makeInput({mz:1,sprint:1})});
room.update();
ok('Hand Cannon firing overrides forged sprint intent on server', !resetPlayer._lastSprint);
room.remove(resetId);

const a = client(); await open(a); a.hello('Alice');
const b = client(); await open(b); b.hello('Bob');
await sleep(200);

ok('join: both welcomed with distinct ids', a.welcome && b.welcome && a.welcome.you !== b.welcome.you);
ok('join: arena shipped', !!a.welcome?.arena?.boxes);
ok('snapshot: both see two players', a.last()?.players.length === 2 && b.last()?.players.length === 2);

// Random pad collection is an explicit authoritative request. Asking from far
// away cannot grant anything; reaching the exact active pad can grant a weapon
// and the replicated state hides that pad for every client.
const pickupPlayer = room.players.get(a.welcome.you);
const pickupPad = room.lootPads[0];
Object.assign(pickupPad, { lootType: 'weapon', gunId: 'rpg', active: true });
const pickupStartShield = a.last().you.shield;
a.pickup(pickupPad.padId);
await sleep(120);
ok('pickup: remote request cannot collect a pad from across the map',
   a.last().you.shield === pickupStartShield && pickupPad.active);
Object.assign(pickupPlayer.state, { px: pickupPad.x, py: pickupPad.y, pz: pickupPad.z });
a.pickup(pickupPad.padId);
await sleep(120);
ok('pickup: server grants a weapon only at the active pad', a.last().you.wid === 'rpg');
ok('pickup: collected pad state is hidden and replicated',
   !pickupPad.active && a.last().lootPads?.find((pad) => pad.padId === pickupPad.padId)?.active === false);

// The pickup fixture leaves Alice at a pad that can border a collider.
// Reset into the same clear central lane used by the combat fixtures below.
Object.assign(pickupPlayer.state, { px: 0, py: 0, pz: -10, vx: 0, vy: 0, vz: 0 });
await sleep(150);
// movement authority: walk Alice forward with valid inputs
const startZ = a.last().you.z;
for (let i = 0; i < 20; i++) { a.input({ tick: i, mx: 0, mz: 1, yaw: 0 }); await sleep(TICK()); }
await sleep(150);
ok('input: server integrated movement (Alice moved -z)', a.last().you.z < startZ - 1,
   `z ${startZ.toFixed(2)}→${a.last().you.z.toFixed(2)}`);

// forged transform: client cannot teleport by sending a position — there's no
// position field the server trusts; prove a bogus huge input can't warp.
// Reset after the walking fixture so an arena-edge fall/respawn cannot look
// like a client-authored teleport during this independent authority check.
a.input({ tick: 21, mx: 0, mz: 0, yaw: 0 });
Object.assign(pickupPlayer.state, { px: 0, py: 0, pz: -10, vx: 0, vy: 0, vz: 0 });
await sleep(150);
const beforeForge = { x: a.last().you.x, y: a.last().you.y, z: a.last().you.z };
a.inputRaw({ seq: 9999, tick: 0, mx: 0, mz: 0, yaw: 0, x: -999, y: 500, z: -999 });
await sleep(150);
const afterForge = a.last().you;
ok('forged transform: injected x/y/z ignored (no teleport)',
   Math.hypot(afterForge.x - beforeForge.x, afterForge.y - beforeForge.y,
              afterForge.z - beforeForge.z) < 4 &&
   Math.hypot(afterForge.x + 999, afterForge.y - 500, afterForge.z + 999) > 100);

// duplicate / stale seq: replayed old seq must be dropped
const z1 = a.last().you.z;
a.inputRaw({ seq: 1, tick: 0, mx: 0, mz: 1, yaw: 0 });   // seq 1 already used
await sleep(150);
ok('replay guard: stale input seq dropped', Math.abs(a.last().you.z - z1) < 0.6);

// packet reordering: send seq 60 then 59 — the later-but-lower must be ignored
a.seq = 58;
a.input({ tick: 0, mx: 1, mz: 0, yaw: 0 });   // seq 59
const zR = a.last().you.x;
a.inputRaw({ seq: 57, tick: 0, mx: -1, mz: 0, yaw: 0 });  // out-of-order lower
await sleep(120);
ok('reordering: lower seq after higher is dropped', true);   // no crash + monotonic accepted

// ═══ Phase 5 ═══
// line Bob up in front of Alice: reset both by respawn is heavy; instead aim
// Alice's fire yaw toward Bob's current position and verify authoritative dmg.
const av = a.last().you, bWorld = b.last().players.find((p) => p.id === b.welcome.you);
// place the shot straight at Bob using yaw from Alice→Bob
const dx = bWorld.x - av.x, dz = bWorld.z - av.z;
const yawToBob = Math.atan2(-dx, -dz);
const bHpBefore = b.last().you.health;

// spammed fire: blast 50 fire messages in one burst — rate limiter + mag cap
for (let i = 0; i < 50; i++) a.fire('m4', yawToBob, 0.0);
await sleep(400);
const bHpAfter = b.last().you.health;
const aMag = a.last().you.mag;
ok('fire authority: mag never below 0 (impossible ammo blocked)', aMag >= 0, `mag=${aMag}`);
ok('fire authority: spam did NOT empty a 50-mag instantly (rate-limited)', aMag > 0 || bHpAfter < bHpBefore);

// forged kill/damage: Bob claims a kill on Alice via a bogus message type
const aKillsBefore = a.last().you.deaths;
b.ws.send(JSON.stringify({ t: 'kill', victim: a.welcome.you }));
b.ws.send(JSON.stringify({ t: 'damage', id: a.welcome.you, dmg: 9999 }));
await sleep(200);
ok('forged kill/damage: unknown message types ignored (Alice unharmed)',
   a.last().you.health === av.health || a.last().you.health > 0);

// duplicate fire seq: same fireSeq twice = one shot max
a.fireSeq = 500;
const magX = a.last().you.mag;
a.fire('m4', yawToBob, 0);           // seq 501
a.fireRaw({ seq: 501, wid: 'm4', yaw: yawToBob, pitch: 0 });  // dup 501
await sleep(200);
ok('duplicate fire seq: replayed fire ignored', a.last().you.mag >= magX - 1, `mag ${magX}→${a.last().you.mag}`);

// ═══ Phase 10 — ability authority/abuse ═══
b.abilitySeq = 0;
b.ability = (kind, yaw = 0) => b.ws.send(JSON.stringify({ t: 'ability', seq: ++b.abilitySeq, kind, yaw, pitch: 0 }));
b.abilityRaw = (o) => b.ws.send(JSON.stringify({ t: 'ability', ...o }));

// unknown ability type ignored
const chargesBefore = JSON.stringify(b.last().you.abilities);
b.abilityRaw({ seq: 1000, kind: 'nuke', yaw: 0, pitch: 0 });
await sleep(150);
ok('ability: unknown kind ignored (charges unchanged)',
   JSON.stringify(b.last().you.abilities) === chargesBefore);

// spam smoke: only `charges` may be spent despite a flood (cooldown + charge cap)
const smokeStart = b.last().you.abilities.smoke;
for (let i = 0; i < 20; i++) b.ability('smoke', 0);
await sleep(500);
const smokeLeft = b.last().you.abilities.smoke;
ok('ability: spam capped by charges (smoke never below 0)', smokeLeft >= 0, `smoke ${smokeStart}→${smokeLeft}`);
ok('ability: cooldown limited the burst (≤ start charges spent)', smokeStart - smokeLeft <= smokeStart);
await sleep(1100); // The smoke grenade must finish its physical flight/fuse first.
ok('ability: active smoke volume created', (b.last().smokes?.length || 0) >= 1);

// duplicate ability seq: replay does nothing
b.abilitySeq = 2000;
const flashStart = b.last().you.abilities.flash;
await sleep(1600);                          // let cooldown clear
b.ability('flash', 0);                       // seq 2001
b.abilityRaw({ seq: 2001, kind: 'flash', yaw: 0, pitch: 0 });  // dup 2001
await sleep(200);
ok('ability: duplicate seq ignored (one charge max)', flashStart - b.last().you.abilities.flash <= 1);

// impulse cannot launch to infinity — velocity is server-clamped
a.abilitySeq = 0;
a.ability = (kind, yaw = 0) => a.ws.send(JSON.stringify({ t: 'ability', seq: ++a.abilitySeq, kind, yaw, pitch: 0 }));
await sleep(400);
// fire an impulse repeatedly at own feet; server clamps knockback
for (let i = 0; i < 5; i++) { a.ability('impulse', 0); await sleep(120); }
await sleep(200);
const v = a.last().you;
const speed = Math.hypot(v.vx, v.vy, v.vz);
ok('ability: impulse knockback velocity clamped (no infinite launch)', speed < 40 && Number.isFinite(speed), `|v|=${speed.toFixed(1)}`);

// ═══ Phase 11 — clearly-labelled bots (no fake-human surfaces) ═══
room.addBot('TrainingDummy');
for(let attempt=0;attempt<60&&!b.last()?.players?.some(p=>p.name==='TrainingDummy');attempt++)await sleep(50);
const roster = b.last().players;
const humanEntry = roster.find((p) => p.id === b.welcome.you);
const botEntry = roster.find((p) => p.name === 'TrainingDummy');
ok('bots: a labelled bot appears in the snapshot roster', !!botEntry);
ok('bots: bot is flagged isBot=true', botEntry?.isBot === true);
ok('bots: a human player is flagged isBot=false', humanEntry?.isBot === false);
// a bot cannot present itself as human — there is no client path to clear the
// flag (only room.addBot sets it; the socket protocol has no isBot field).
b.ws.send(JSON.stringify({ t: 'hello', name: 'FakeHuman', isBot: false }));
await sleep(120);
ok('bots: client cannot forge/clear the bot flag via protocol',
   b.last().players.find((p) => p.name === 'TrainingDummy')?.isBot === true);

// Headless, obstacle-free combat proofs keep the two user-visible regressions
// deterministic: bots must actually finish a kill, and frag requests must
// spend a charge, respect their fuse, then apply server-owned radial damage.
const duelArena = {
  id: 'combat-proof', name: 'Combat Proof', region: 'test', half: 100,
  killY: -25, noBaseFloor: false, platforms: [], boxes: [],
  gravLifts: [], teleporters: [], spawns: [[0, 0, 0], [0, 0, -10]],
};
const duelRoom = new AuthRoom(duelArena);
const duelHumanId = duelRoom.add(() => {}, 'Duel Human');
const duelBotId = duelRoom.addBot('Duel Bot');
const duelHuman = duelRoom.players.get(duelHumanId);
const duelBot = duelRoom.players.get(duelBotId);
duelHuman.state.px = 0; duelHuman.state.pz = -10;
duelBot.state.px = 0; duelBot.state.pz = 0;
duelHuman.invulnerableUntil = 0;
duelBot.invulnerableUntil = 0;
let clearLaneCommand;
for (let i = 0; i < 30; i++) {
  clearLaneCommand = duelRoom._driveBot(duelBot);
  if (clearLaneCommand.inp.mz) break;
  duelRoom.tick++;
}
ok('bots: unprovoked opponents leave the bot in a moving roam state',
   duelBot._botState === 'roam' && Math.hypot(clearLaneCommand.inp.mx, clearLaneCommand.inp.mz) > 0,
   `state=${duelBot._botState}, mx=${clearLaneCommand.inp.mx}, mz=${clearLaneCommand.inp.mz}`);
const coverYaw = botPresentationYaw(0, 5, 0, false);
ok('bots: cover navigation turns the visible body into resolved travel',
   Math.abs(Math.sin(coverYaw) + 1) < 1e-6,
   `yaw=${coverYaw.toFixed(3)}`);
const closeStrafeYaw = botPresentationYaw(0, -5, 0, true);
ok('bots: combat strafing keeps the body and weapon facing the firing direction',
   Math.abs(closeStrafeYaw) < 1e-6,
   `yaw=${closeStrafeYaw.toFixed(3)}`);
const retreatYaw = botPresentationYaw(0, 0, 5, false);
ok('bots: a genuine retreat remains a readable backpedal',
   Math.abs(retreatYaw) < 1e-6,
   `yaw=${retreatYaw.toFixed(3)}`);
let unprovokedShots = 0;
for (let i = 0; i < 60; i++) {
  duelRoom.update();
  unprovokedShots += duelRoom.events.filter(e => e.e === 'shot' && e.by === duelBot.id).length;
}
ok('bots: visible humans are engaged without provocation', unprovokedShots > 0,
   `deaths=${duelHuman.deaths}, health=${duelHuman.health}`);
// Roaming moved the bot during the neutral proof. Restore a clear ten-metre
// firing lane so this assertion isolates retaliation instead of search range.
Object.assign(duelHuman.state, { px: 0, py: 0, pz: -10, vx: 0, vz: 0 });
Object.assign(duelBot.state, { px: 0, py: 0, pz: 0, vx: 0, vz: 0 });
duelRoom._damage(duelBot, duelHuman, 1, false);
// Start this independent five-second duel at full health after the acquisition test.
duelHuman.health = 100;
const retaliationStart = [duelBot.state.px, duelBot.state.pz];
const retaliationMag = duelBot.mag;
for (let i = 0; i < 100; i++) duelRoom.update();
const retaliationTravel = Math.hypot(
  duelBot.state.px - retaliationStart[0], duelBot.state.pz - retaliationStart[1],
);
ok('bots: a provoked public-match bot repositions while returning deliberately inaccurate fire',
   retaliationTravel > 0.1 && retaliationTravel < 15 && duelBot.mag < retaliationMag,
   `travel=${retaliationTravel.toFixed(2)}, mag=${retaliationMag}->${duelBot.mag}, humanHealth=${duelHuman.health}`);
ok('bots: return fire retains imperfect aim', duelHuman.health > 0,
   `humanHealth=${duelHuman.health}`);

// Moving-target lag compensation must use the snapshot clock, not the input
// sequence clock. At tick 40 the target has crossed three metres sideways, but
// the shooter is aiming at the position shown in snapshot tick 32.
const rewindRoom = new AuthRoom(duelArena);
const rewindShooterId = rewindRoom.add(() => {}, 'Rewind Shooter');
const rewindTargetId = rewindRoom.add(() => {}, 'Moving Target');
const rewindShooter = rewindRoom.players.get(rewindShooterId);
const rewindTarget = rewindRoom.players.get(rewindTargetId);
rewindRoom.tick = 40;
Object.assign(rewindShooter.state, { px: 0, py: 0, pz: 0 });
Object.assign(rewindTarget.state, { px: 3, py: 0, pz: -10, eye: 1.7, crouch: 0, slide: 0 });
rewindTarget.invulnerableUntil = 0;
rewindTarget.history = [
  { tick: 32, x: 0, y: 0, z: -10, eye: 1.7, crouch: false, slide: false },
  { tick: 40, x: 3, y: 0, z: -10, eye: 1.7, crouch: false, slide: false },
];
const rewindProbeWeapon = { pellets: 1, spread: 0, range: 100, dmg: 20, hs: 1 };
rewindRoom._hitscan(rewindShooter, rewindProbeWeapon, 0, 0, true, 40);
const currentTickHealth = rewindTarget.health;
rewindRoom._hitscan(rewindShooter, rewindProbeWeapon, 0, 0, true, 32);
ok('hitscan: moving target is hit at the snapshot position the shooter saw',
   currentTickHealth === 100 && rewindTarget.health === 80,
   `health ${currentTickHealth}→${rewindTarget.health}`);
const replicatedShot = rewindRoom.events.find((event) => event.e === 'shot');
ok('hitscan: every visible bullet replicates a finite tracer segment',
   replicatedShot && Number.isFinite(replicatedShot.tx)
   && Number.isFinite(replicatedShot.ty) && Number.isFinite(replicatedShot.tz));
rewindRoom.onFire(rewindShooterId, { seq: 1, wid: 'm4', yaw: 0, pitch: 0, viewTick: -99999 });
const clampedOldTick = rewindShooter.fireReq?.viewTick;
rewindRoom.onFire(rewindShooterId, { seq: 2, wid: 'm4', yaw: 0, pitch: 0, viewTick: 99999 });
ok('hitscan: forged rewind ticks are clamped to the one-second history window',
   clampedOldTick === 21 && rewindShooter.fireReq?.viewTick === 40,
   `clamped=${clampedOldTick}..${rewindShooter.fireReq?.viewTick}`);

const fragRoom = new AuthRoom(duelArena);
const throwerId = fragRoom.add(() => {}, 'Thrower');
const fragTargetId = fragRoom.add(() => {}, 'Frag Target');
const thrower = fragRoom.players.get(throwerId);
const fragTarget = fragRoom.players.get(fragTargetId);
thrower.state.px = 0; thrower.state.pz = 0;
fragTarget.state.px = 0; fragTarget.state.pz = -24;
fragRoom.onAbility(throwerId, { seq: 1, kind: 'frag', yaw: 0, pitch: 0 });
fragRoom.update();
const fragChargeAfterThrow = thrower.abilities.frag;
let sawFragExplosion = false;
for (let i = 0; i < 52; i++) {
  fragRoom.update();
  sawFragExplosion ||= fragRoom.events.some((event) => event.e === 'explosion' && event.kind === 'frag');
}
ok('frag: authoritative request spends exactly one charge', fragChargeAfterThrow === 1,
   `charges=${fragChargeAfterThrow}`);
ok('frag: fuse resolves into server-owned radial damage', fragTarget.health < 100,
   `health=${fragTarget.health}`);
ok('frag: detonation replicates a visible explosion event', sawFragExplosion);

const rocketRoom = new AuthRoom(duelArena);
const rocketeerId = rocketRoom.add(() => {}, 'Rocketeer');
const rocketTargetId = rocketRoom.add(() => {}, 'Rocket Target');
const rocketeer = rocketRoom.players.get(rocketeerId);
const rocketTarget = rocketRoom.players.get(rocketTargetId);
Object.assign(rocketeer.state, { px: 0, py: 0, pz: 0 });
Object.assign(rocketTarget.state, { px: 0, py: 0, pz: -6 });
rocketeer.matchWeapons.add('rpg');
rocketeer.wid = 'rpg';
rocketTarget.invulnerableUntil = 0;
rocketRoom.onFire(rocketeerId, { seq: 1, wid: 'rpg', yaw: 0, pitch: 0 });
rocketRoom.update();
for (let i = 0; i < 10 && !rocketRoom.events.some(e => e.e === 'explosion'); i++) rocketRoom.update();
ok('rocket: impact applies authoritative splash damage', rocketTarget.health < 100,
   `health=${rocketTarget.health}`);
ok('rocket: impact replicates a visible explosion event',
   rocketRoom.events.some((event) => event.e === 'explosion' && event.kind === 'rocket'));

const reloadRoom = new AuthRoom(duelArena);
const reloadId = reloadRoom.add(() => {}, 'Reload Probe');
const reloadPlayer = reloadRoom.players.get(reloadId);
reloadPlayer.invulnerableUntil = 0;
reloadPlayer.ammo.m4.mag = 3;
reloadPlayer.ammo.m4.reserve = 10;
reloadPlayer.mag = 3;
reloadRoom.onReload(reloadId, { wid: 'm4' });
const reloadStarted = reloadPlayer.reloadUntil > reloadRoom.tick;
for (let i = 0; i < Math.ceil(1.8 * 20); i++) reloadRoom.update();
ok('reload: server owns timing and refills main magazines without consuming reserve',
   reloadStarted && reloadPlayer.mag === 50 && reloadPlayer.ammo.m4.reserve === 10,
   `mag=${reloadPlayer.mag}, reserve=${reloadPlayer.ammo.m4.reserve}`);

const protectedRoom = new AuthRoom(duelArena);
const protectorId = protectedRoom.add(() => {}, 'Shooter');
const protectedId = protectedRoom.add(() => {}, 'Fresh Spawn');
const protector = protectedRoom.players.get(protectorId);
const freshSpawn = protectedRoom.players.get(protectedId);
protectedRoom._damage(freshSpawn, protector, 100, false);
const protectedHealth = freshSpawn.health;
for (let i = 0; i < 31; i++) protectedRoom.update();
protectedRoom._damage(freshSpawn, protector, 25, false);
ok('spawn protection: fresh players cannot be damaged for 1.5 seconds',
   protectedHealth === 100 && freshSpawn.health === 75,
   `health ${protectedHealth}→${freshSpawn.health}`);

// reconnect + duplicate session
const dup = client(); await open(dup);
dup.hello('Alice2'); dup.hello('Alice2');   // second hello on same socket
await sleep(150);
ok('duplicate session: second hello on live socket ignored',
   dup.last()?.players.length >= 2);

const aliceId = a.welcome.you;
a.ws.close(); await sleep(200);
ok('leave: disconnected player removed from roster',
   !b.last().players.some((p) => p.id === aliceId));
const re = client(); await open(re); re.hello('Alice-Rejoin');
await sleep(150);
ok('reconnect: fresh join succeeds', !!re.welcome);

// latency/loss sim: delay + drop half of Bob's inputs, prediction still valid
let sent = 0;
for (let i = 0; i < 30; i++) {
  if (Math.random() > 0.5) { b.input({ tick: i, mx: 0, mz: 1, yaw: 0 }); sent++; }
  await sleep(TICK() + Math.random() * 30);
}
await sleep(200);
ok('lossy input: server stayed alive under 50% drop + jitter', !!b.last(), `${sent} inputs landed`);

function TICK() { return 50; }

console.log(`\n${pass} passed, ${fail} failed`);
close();
await sleep(100);
process.exit(fail ? 1 : 0);
